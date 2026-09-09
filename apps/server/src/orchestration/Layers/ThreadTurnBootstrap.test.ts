import {
  CommandId,
  EventId,
  MessageId,
  OrchestrationDispatchCommandError,
  type OrchestrationCommand,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../../project/ProjectSetupScriptRunner.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { ThreadTurnBootstrap } from "../Services/ThreadTurnBootstrap.ts";
import { ThreadTurnBootstrapLive } from "./ThreadTurnBootstrap.ts";

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
};

const command = {
  type: "thread.turn.start",
  commandId: CommandId.make("turn-start"),
  threadId: ThreadId.make("thread-bootstrap"),
  message: {
    messageId: MessageId.make("message-bootstrap"),
    role: "user",
    text: "hello",
    attachments: [],
  },
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  bootstrap: {
    createThread: {
      projectId: ProjectId.make("project-1"),
      title: "Bootstrap Thread",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    runSetupScript: false,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
} as const satisfies Extract<OrchestrationCommand, { type: "thread.turn.start" }>;

it.effect("dispatches a fresh thread and turn through the shared bootstrap service", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationCommand> = [];
    const drainThrough = vi.fn((_: number) => Effect.void);
    const layer = ThreadTurnBootstrapLive.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.mock(GitWorkflowService.GitWorkflowService)({}),
          Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
          Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({}),
          Layer.mock(ThreadDeletionReactor)({ drainThrough }),
        ),
      ),
    );

    const result = yield* Effect.gen(function* () {
      const bootstrap = yield* ThreadTurnBootstrap;
      return yield* bootstrap.dispatch(command, {
        dispatch: (next) =>
          Effect.sync(() => {
            dispatched.push(next);
            return { sequence: dispatched.length };
          }),
        commandId: (tag) => Effect.succeed(CommandId.make(`test:${tag}`)),
        eventId: Effect.succeed(EventId.make("event-1")),
      });
    }).pipe(Effect.provide(layer));

    assert.deepEqual(
      dispatched.map((item) => item.type),
      ["thread.create", "thread.turn.start"],
    );
    assert.strictEqual(dispatched[0]?.commandId, CommandId.make("test:bootstrap-thread-create"));
    assert.strictEqual(drainThrough.mock.calls[0]?.[0], 1);
    assert.strictEqual(result.sequence, 2);
    const final = dispatched[1];
    assert.isTrue(final?.type === "thread.turn.start");
    if (final?.type === "thread.turn.start") assert.isUndefined(final.bootstrap);
  }),
);

it.effect("deletes a newly created thread when later bootstrap work fails", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationCommand> = [];
    const layer = ThreadTurnBootstrapLive.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.mock(GitWorkflowService.GitWorkflowService)({
            createWorktree: () => Effect.die(new Error("worktree exploded")),
          }),
          Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
          Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({}),
          Layer.mock(ThreadDeletionReactor)({ drainThrough: () => Effect.void }),
        ),
      ),
    );
    const worktreeCommand = {
      ...command,
      bootstrap: {
        ...command.bootstrap,
        prepareWorktree: {
          projectCwd: "/tmp/project",
          baseBranch: "main",
          branch: "t3/scheduled/run-1",
        },
      },
    };

    const result = yield* Effect.gen(function* () {
      const bootstrap = yield* ThreadTurnBootstrap;
      return yield* bootstrap
        .dispatch(worktreeCommand, {
          dispatch: (next) =>
            Effect.sync(() => {
              dispatched.push(next);
              return { sequence: dispatched.length };
            }),
          commandId: (tag) => Effect.succeed(CommandId.make(`test:${tag}`)),
          eventId: Effect.succeed(EventId.make("event-1")),
        })
        .pipe(Effect.result);
    }).pipe(Effect.provide(layer));

    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.instanceOf(result.failure, OrchestrationDispatchCommandError);
      assert.strictEqual(result.failure.bootstrapThreadDisposition, "deleted");
    }
    assert.deepEqual(
      dispatched.map((item) => item.type),
      ["thread.create", "thread.delete"],
    );
  }),
);
