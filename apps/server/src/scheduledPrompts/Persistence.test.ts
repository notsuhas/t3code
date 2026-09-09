import {
  ProjectId,
  ProviderInstanceId,
  ScheduledPromptId,
  ScheduledPromptRunId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ScheduledPromptRepository, ScheduledPromptRepositoryLive } from "./Persistence.ts";

const repositoryLayer = it.layer(
  ScheduledPromptRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const schedule = (id: string, overrides: Record<string, unknown> = {}) => ({
  id: ScheduledPromptId.make(id),
  name: `Schedule ${id}`,
  description: null,
  enabled: true,
  timezone: "UTC",
  recurrence: { _tag: "hourly", minute: 15 } as const,
  nextRunAt: "2026-09-09T10:15:00.000Z",
  activeRunId: null,
  createdAt: "2026-09-09T09:00:00.000Z",
  updatedAt: "2026-09-09T09:00:00.000Z",
  action: {
    _tag: "prompt" as const,
    projectId: ProjectId.make("project-1"),
    prompt: "Check the backups",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    workspace: { _tag: "project" as const },
  },
  ...overrides,
});

repositoryLayer("ScheduledPromptRepository", (it) => {
  it.effect("stores schedules and publishes a monotonic revision", () =>
    Effect.gen(function* () {
      const repository = yield* ScheduledPromptRepository;
      assert.strictEqual(yield* repository.revision, 0);

      const value = schedule("schedule-crud");
      yield* repository.upsert(value);
      assert.deepEqual(Option.getOrNull(yield* repository.get(value.id)), value);
      assert.deepEqual(yield* repository.list, [value]);
      assert.strictEqual(yield* repository.revision, 1);

      yield* repository.delete(value.id);
      assert.isTrue(Option.isNone(yield* repository.get(value.id)));
      assert.strictEqual(yield* repository.revision, 2);
    }),
  );

  it.effect("claims due work atomically with an immutable execution snapshot", () =>
    Effect.gen(function* () {
      const repository = yield* ScheduledPromptRepository;
      const value = schedule("schedule-claim");
      yield* repository.upsert(value);

      const claim = yield* repository.claimScheduled({
        scheduleId: value.id,
        expectedNextRunAt: value.nextRunAt!,
        runId: ScheduledPromptRunId.make("run-claim"),
        nextRunAt: "2026-09-09T11:15:00.000Z",
      });
      assert.strictEqual(claim._tag, "claimed");
      if (claim._tag !== "claimed") return;
      assert.strictEqual(claim.run.scheduleName, value.name);
      assert.deepEqual(claim.run.action, value.action);

      yield* repository.upsert({
        ...value,
        name: "Edited later",
        action: { ...value.action, prompt: "A different prompt" },
        nextRunAt: "2026-09-09T11:15:00.000Z",
        activeRunId: claim.run.id,
        updatedAt: "2026-09-09T10:16:00.000Z",
      });
      const persisted = yield* repository.getRun(claim.run.id);
      assert.strictEqual(Option.getOrThrow(persisted).scheduleName, value.name);
      assert.strictEqual(Option.getOrThrow(persisted).action.prompt, "Check the backups");

      const stale = yield* repository.claimScheduled({
        scheduleId: value.id,
        expectedNextRunAt: value.nextRunAt!,
        runId: ScheduledPromptRunId.make("run-stale"),
        nextRunAt: "2026-09-09T12:15:00.000Z",
      });
      assert.strictEqual(stale._tag, "stale");
    }),
  );

  it.effect("records overlap skips without replacing the active run", () =>
    Effect.gen(function* () {
      const repository = yield* ScheduledPromptRepository;
      const value = schedule("schedule-overlap");
      yield* repository.upsert(value);
      const first = yield* repository.claimScheduled({
        scheduleId: value.id,
        expectedNextRunAt: value.nextRunAt!,
        runId: ScheduledPromptRunId.make("run-active"),
        nextRunAt: "2026-09-09T11:15:00.000Z",
      });
      assert.strictEqual(first._tag, "claimed");

      const second = yield* repository.claimScheduled({
        scheduleId: value.id,
        expectedNextRunAt: "2026-09-09T11:15:00.000Z",
        runId: ScheduledPromptRunId.make("run-skipped"),
        nextRunAt: "2026-09-09T12:15:00.000Z",
      });
      assert.strictEqual(second._tag, "skipped");
      assert.strictEqual(
        Option.getOrThrow(yield* repository.get(value.id)).activeRunId,
        ScheduledPromptRunId.make("run-active"),
      );
      assert.strictEqual(
        Option.getOrThrow(yield* repository.getRun(ScheduledPromptRunId.make("run-skipped"))).state,
        "skipped",
      );
    }),
  );

  it.effect("retains claimed work and history when its schedule is deleted", () =>
    Effect.gen(function* () {
      const repository = yield* ScheduledPromptRepository;
      const value = schedule("schedule-delete");
      yield* repository.upsert(value);
      const claim = yield* repository.claimManual({
        scheduleId: value.id,
        runId: ScheduledPromptRunId.make("run-delete"),
        scheduledAt: "2026-09-09T10:00:00.000Z",
      });
      assert.strictEqual(claim._tag, "claimed");

      yield* repository.delete(value.id);
      assert.strictEqual(
        Option.getOrThrow(yield* repository.getRun(ScheduledPromptRunId.make("run-delete"))).action
          .prompt,
        "Check the backups",
      );
      assert.strictEqual((yield* repository.listRuns(value.id, 100)).length, 1);
    }),
  );

  it.effect("recovers unfinished runs and finalizes linked threads idempotently", () =>
    Effect.gen(function* () {
      const repository = yield* ScheduledPromptRepository;
      const value = schedule("schedule-lifecycle");
      yield* repository.upsert(value);
      const claim = yield* repository.claimManual({
        scheduleId: value.id,
        runId: ScheduledPromptRunId.make("run-lifecycle"),
        scheduledAt: "2026-09-09T10:00:00.000Z",
      });
      assert.strictEqual(claim._tag, "claimed");
      if (claim._tag !== "claimed") return;

      const threadId = ThreadId.make("scheduled:run-lifecycle:thread");
      assert.isTrue(
        yield* repository.markRunning({
          runId: claim.run.id,
          threadId,
          startedAt: "2026-09-09T10:00:01.000Z",
        }),
      );
      assert.isFalse(
        yield* repository.markRunning({
          runId: claim.run.id,
          threadId,
          startedAt: "2026-09-09T10:00:02.000Z",
        }),
      );
      assert.isTrue(
        yield* repository.finishByThread({
          threadId,
          state: "succeeded",
          finishedAt: "2026-09-09T10:05:00.000Z",
          reason: null,
        }),
      );
      assert.isFalse(
        yield* repository.finishByThread({
          threadId,
          state: "failed",
          finishedAt: "2026-09-09T10:06:00.000Z",
          reason: "late duplicate",
        }),
      );
      assert.strictEqual(
        Option.getOrThrow(yield* repository.getRun(claim.run.id)).state,
        "succeeded",
      );
      assert.isNull(Option.getOrThrow(yield* repository.get(value.id)).activeRunId);
    }),
  );

  it.effect("marks process-orphaned runs failed on startup", () =>
    Effect.gen(function* () {
      const repository = yield* ScheduledPromptRepository;
      const value = schedule("schedule-recovery");
      yield* repository.upsert(value);
      const claim = yield* repository.claimManual({
        scheduleId: value.id,
        runId: ScheduledPromptRunId.make("run-recovery"),
        scheduledAt: "2026-09-09T10:00:00.000Z",
      });
      assert.strictEqual(claim._tag, "claimed");

      assert.isAtLeast(
        yield* repository.failUnfinished({
          finishedAt: "2026-09-09T10:01:00.000Z",
          reason: "Server restarted before the run completed",
        }),
        1,
      );
      assert.strictEqual(
        yield* repository.failUnfinished({
          finishedAt: "2026-09-09T10:02:00.000Z",
          reason: "Server restarted before the run completed",
        }),
        0,
      );
      assert.strictEqual(
        Option.getOrThrow(yield* repository.getRun(ScheduledPromptRunId.make("run-recovery")))
          .state,
        "failed",
      );
      assert.isNull(Option.getOrThrow(yield* repository.get(value.id)).activeRunId);
    }),
  );
});
