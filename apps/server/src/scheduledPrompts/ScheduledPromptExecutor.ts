import {
  CommandId,
  EventId,
  isProviderAvailable,
  MessageId,
  ScheduledPromptError,
  ThreadId,
  type OrchestrationCommand,
  type ScheduledPrompt,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadTurnBootstrap } from "../orchestration/Services/ThreadTurnBootstrap.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import type { ScheduledPromptRunRecord } from "./Persistence.ts";

export interface ScheduledPromptExecutorShape {
  readonly execute: (
    run: ScheduledPromptRunRecord,
    schedule: ScheduledPrompt,
  ) => Effect.Effect<ThreadId, ScheduledPromptError>;
}

export class ScheduledPromptExecutor extends Context.Service<
  ScheduledPromptExecutor,
  ScheduledPromptExecutorShape
>()("t3/scheduledPrompts/ScheduledPromptExecutor") {}

const error = (reason: ScheduledPromptError["reason"], message: string) =>
  new ScheduledPromptError({ reason, message });

const identifier = (runId: string, suffix: string) => `scheduled:${runId}:${suffix}`;

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const bootstrap = yield* ThreadTurnBootstrap;

  const execute: ScheduledPromptExecutorShape["execute"] = Effect.fn(
    "ScheduledPromptExecutor.execute",
  )(function* (run, schedule) {
    if (run.scheduleId !== schedule.id) {
      return yield* Effect.fail(error("validation", "Scheduled run does not match its schedule."));
    }

    const action = run.action;
    const projectOption = yield* projection
      .getProjectShellById(action.projectId)
      .pipe(Effect.mapError(() => error("persistence", "Failed to load the scheduled project.")));
    if (Option.isNone(projectOption)) {
      return yield* Effect.fail(
        error("unavailable", "The project pinned to this schedule is no longer available."),
      );
    }
    const project = projectOption.value;

    const snapshots = yield* providers.getProviders;
    const provider = snapshots.find(
      (candidate) => candidate.instanceId === action.modelSelection.instanceId,
    );
    const providerReady =
      provider !== undefined &&
      provider.enabled &&
      provider.installed &&
      provider.status !== "disabled" &&
      provider.status !== "error" &&
      isProviderAvailable(provider);
    if (!providerReady) {
      return yield* Effect.fail(
        error("unavailable", "The provider pinned to this schedule is not available."),
      );
    }
    if (!provider.models.some((model) => model.slug === action.modelSelection.model)) {
      return yield* Effect.fail(
        error("unavailable", "The model pinned to this schedule is not available."),
      );
    }

    if (action.workspace._tag === "worktree" && run.worktreeBranch === null) {
      return yield* Effect.fail(
        error("validation", "The scheduled worktree run is missing its claimed branch."),
      );
    }

    const threadId = ThreadId.make(identifier(run.id, "thread"));
    const title = `Scheduled: ${run.scheduleName}`;
    const prepareWorktree =
      action.workspace._tag === "worktree"
        ? {
            projectCwd: project.workspaceRoot,
            baseBranch: action.workspace.baseBranch,
            branch: run.worktreeBranch!,
            ...(action.workspace.startFromOrigin ? { startFromOrigin: true } : {}),
          }
        : undefined;
    const command = {
      type: "thread.turn.start",
      commandId: CommandId.make(identifier(run.id, "turn-start")),
      threadId,
      message: {
        messageId: MessageId.make(identifier(run.id, "message")),
        role: "user",
        text: action.prompt,
        attachments: [],
      },
      modelSelection: action.modelSelection,
      titleSeed: title,
      runtimeMode: action.runtimeMode,
      interactionMode: action.interactionMode,
      bootstrap: {
        createThread: {
          projectId: action.projectId,
          title,
          modelSelection: action.modelSelection,
          runtimeMode: action.runtimeMode,
          interactionMode: action.interactionMode,
          branch: null,
          worktreePath: null,
          createdAt: run.scheduledAt,
        },
        ...(prepareWorktree ? { prepareWorktree } : {}),
        runSetupScript: action.workspace._tag === "worktree" && action.workspace.runSetupScript,
      },
      createdAt: run.scheduledAt,
    } as const satisfies Extract<OrchestrationCommand, { type: "thread.turn.start" }>;

    let eventIndex = 0;
    const eventId = Effect.sync(() => {
      eventIndex += 1;
      return EventId.make(identifier(run.id, `event-${eventIndex}`));
    });
    yield* bootstrap
      .dispatch(command, {
        dispatch: (next) => engine.dispatch(next),
        commandId: (tag) => Effect.succeed(CommandId.make(identifier(run.id, `bootstrap-${tag}`))),
        eventId,
      })
      .pipe(
        Effect.mapError((cause) =>
          error("dispatch", cause.message || "Failed to start the scheduled prompt."),
        ),
      );
    return threadId;
  });

  return { execute } satisfies ScheduledPromptExecutorShape;
});

export const ScheduledPromptExecutorLive = Layer.effect(ScheduledPromptExecutor, make);
