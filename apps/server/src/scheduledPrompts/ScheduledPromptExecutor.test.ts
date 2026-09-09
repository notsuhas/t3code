import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ScheduledPromptId,
  ScheduledPromptRunId,
  ThreadId,
  type OrchestrationCommand,
  type ScheduledPrompt,
  type ServerProvider,
} from "@t3tools/contracts";
import { assert, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadTurnBootstrap } from "../orchestration/Services/ThreadTurnBootstrap.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { ScheduledPromptExecutor, ScheduledPromptExecutorLive } from "./ScheduledPromptExecutor.ts";
import type { ScheduledPromptRunRecord } from "./Persistence.ts";

const projectId = ProjectId.make("project-1");
const instanceId = ProviderInstanceId.make("codex-work");
const scheduleId = ScheduledPromptId.make("schedule-1");
const runId = ScheduledPromptRunId.make("run-1");
const modelSelection = { instanceId, model: "gpt-5.4" };
const action = {
  _tag: "prompt",
  projectId,
  prompt: "Review the open work and continue.",
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  workspace: { _tag: "project" },
} as const;
const schedule: ScheduledPrompt = {
  id: scheduleId,
  name: "Daily review",
  description: null,
  enabled: true,
  timezone: "UTC",
  recurrence: { _tag: "daily", hour: 9, minute: 0 },
  action,
  nextRunAt: "2026-01-02T09:00:00.000Z",
  activeRunId: runId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const run: ScheduledPromptRunRecord = {
  id: runId,
  scheduleId,
  state: "pending",
  trigger: "scheduled",
  scheduledAt: "2026-01-02T09:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  threadId: null,
  reason: null,
  scheduleName: schedule.name,
  action,
  worktreeBranch: null,
};

const provider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [{ slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
} as const satisfies ServerProvider;

const makeLayer = (
  dispatch: (command: OrchestrationCommand) => Effect.Effect<{ sequence: number }>,
  project = Option.some({
    id: projectId,
    title: "T3 Code",
    workspaceRoot: "/workspace/t3code",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
) =>
  ScheduledPromptExecutorLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
          getProjectShellById: () => Effect.succeed(project),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([provider]),
        }),
        Layer.mock(OrchestrationEngine.OrchestrationEngineService)({}),
        Layer.mock(ThreadTurnBootstrap)({ dispatch }),
      ),
    ),
  );

it.effect("dispatches a project-root run with deterministic identifiers", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationCommand> = [];
    const layer = makeLayer((command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: 42 };
      }),
    );

    const threadId = yield* Effect.gen(function* () {
      const executor = yield* ScheduledPromptExecutor;
      return yield* executor.execute(run, schedule);
    }).pipe(Effect.provide(layer));

    assert.strictEqual(threadId, "scheduled:run-1:thread");
    assert.lengthOf(commands, 1);
    assert.deepEqual(commands[0], {
      type: "thread.turn.start",
      commandId: CommandId.make("scheduled:run-1:turn-start"),
      threadId: ThreadId.make("scheduled:run-1:thread"),
      message: {
        messageId: MessageId.make("scheduled:run-1:message"),
        role: "user",
        text: action.prompt,
        attachments: [],
      },
      modelSelection,
      titleSeed: "Scheduled: Daily review",
      runtimeMode: "full-access",
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId,
          title: "Scheduled: Daily review",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: run.scheduledAt,
        },
        runSetupScript: false,
      },
      createdAt: run.scheduledAt,
    });
  }),
);

it.effect("uses the immutable claimed worktree settings", () =>
  Effect.gen(function* () {
    const dispatch = vi.fn((_: OrchestrationCommand) => Effect.succeed({ sequence: 1 }));
    const worktreeRun = {
      ...run,
      action: {
        ...action,
        workspace: {
          _tag: "worktree",
          baseBranch: "main",
          startFromOrigin: true,
          runSetupScript: true,
        },
      },
      worktreeBranch: "t3/schedule/schedule-1/run-1",
    } as const;

    yield* Effect.gen(function* () {
      const executor = yield* ScheduledPromptExecutor;
      return yield* executor.execute(worktreeRun, { ...schedule, name: "Changed later" });
    }).pipe(Effect.provide(makeLayer(dispatch)));

    const command = dispatch.mock.calls[0]?.[0];
    assert.isTrue(command?.type === "thread.turn.start");
    if (command?.type !== "thread.turn.start") return;
    assert.strictEqual(command.titleSeed, "Scheduled: Daily review");
    assert.deepEqual(command.bootstrap?.prepareWorktree, {
      projectCwd: "/workspace/t3code",
      baseBranch: "main",
      branch: "t3/schedule/schedule-1/run-1",
      startFromOrigin: true,
    });
    assert.isTrue(command.bootstrap?.runSetupScript);
  }),
);

it.effect("fails visibly when the pinned project is unavailable", () =>
  Effect.gen(function* () {
    const layer = makeLayer(() => Effect.succeed({ sequence: 1 }), Option.none());
    const error = yield* Effect.gen(function* () {
      const executor = yield* ScheduledPromptExecutor;
      return yield* executor.execute(run, schedule);
    }).pipe(Effect.flip, Effect.provide(layer));
    assert.strictEqual(error.reason, "unavailable");
  }),
);
