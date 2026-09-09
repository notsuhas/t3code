import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ScheduledPromptRepository, ScheduledPromptRepositoryLive } from "./Persistence.ts";
import {
  ScheduledPromptReactor,
  ScheduledPromptScheduler,
  ScheduledPromptSchedulerLive,
} from "./ScheduledPromptScheduler.ts";
import { ScheduledPromptExecutor } from "./ScheduledPromptExecutor.ts";

const createInput = {
  name: "Daily review",
  description: null,
  enabled: true,
  timezone: "UTC",
  recurrence: { _tag: "daily", hour: 9, minute: 0 },
  action: {
    _tag: "prompt",
    projectId: ProjectId.make("project-1"),
    prompt: "Review the open work",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    workspace: { _tag: "project" },
  },
} as const;

it.effect("creates schedules, runs immediately, and excludes overlap", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-01-01T00:00:00.000Z"));
      const executed = yield* Deferred.make<string>();
      let nextByte = 0;
      const dependencies = Layer.mergeAll(
        ScheduledPromptRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        Layer.mock(ScheduledPromptExecutor)({
          execute: (run) => Deferred.succeed(executed, run.id).pipe(Effect.as(run.threadId!)),
        }),
        Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
          subscribeDomainEvents: Effect.succeed(Stream.empty),
        }),
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size).fill(++nextByte),
            digest: () => Effect.die("unused"),
          }),
        ),
      );
      const context = yield* Layer.build(
        ScheduledPromptSchedulerLive.pipe(Layer.provideMerge(dependencies)),
      );

      const scheduler = yield* Effect.service(ScheduledPromptScheduler).pipe(
        Effect.provide(context),
      );
      const reactor = yield* Effect.service(ScheduledPromptReactor).pipe(Effect.provide(context));
      yield* reactor.start().pipe(Effect.provide(context));
      yield* reactor.activate;

      const schedule = yield* scheduler.create(createInput);
      assert.strictEqual(schedule.nextRunAt, "2026-01-01T09:00:00.000Z");
      const summary = (yield* scheduler.list).schedules[0]!;
      assert.strictEqual(summary.name, createInput.name);
      assert.notProperty(summary, "action");
      assert.notProperty(summary, "prompt");

      const first = yield* scheduler.runNow(schedule.id);
      assert.strictEqual(first.state, "pending");
      assert.strictEqual(yield* Deferred.await(executed), first.id);
      const second = yield* scheduler.runNow(schedule.id);
      assert.strictEqual(second.state, "skipped");
      assert.strictEqual((yield* scheduler.runs(schedule.id, 100)).runs.length, 2);

      const repository = yield* Effect.service(ScheduledPromptRepository).pipe(
        Effect.provide(context),
      );
      assert.strictEqual((yield* repository.listUnfinishedRuns).length, 1);
    }),
  ),
);

it.effect("claims a due occurrence and advances the next run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-01-01T00:00:00.000Z"));
      const executed = yield* Deferred.make<string>();
      let nextByte = 40;
      const dependencies = Layer.mergeAll(
        ScheduledPromptRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        Layer.mock(ScheduledPromptExecutor)({
          execute: (run) => Deferred.succeed(executed, run.id).pipe(Effect.as(run.threadId!)),
        }),
        Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
          subscribeDomainEvents: Effect.succeed(Stream.empty),
        }),
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size).fill(++nextByte),
            digest: () => Effect.die("unused"),
          }),
        ),
      );
      const context = yield* Layer.build(
        ScheduledPromptSchedulerLive.pipe(Layer.provideMerge(dependencies)),
      );
      const scheduler = yield* Effect.service(ScheduledPromptScheduler).pipe(
        Effect.provide(context),
      );
      const reactor = yield* Effect.service(ScheduledPromptReactor).pipe(Effect.provide(context));
      yield* reactor.start().pipe(Effect.provide(context));
      yield* reactor.activate;
      const schedule = yield* scheduler.create(createInput);
      const execution = yield* Deferred.await(executed).pipe(Effect.forkChild);

      yield* TestClock.adjust("9 hours");
      yield* Fiber.join(execution);

      const runs = (yield* scheduler.runs(schedule.id, 100)).runs;
      assert.lengthOf(runs, 1);
      assert.strictEqual(runs[0]?.state, "pending");
      assert.strictEqual((yield* scheduler.get(schedule.id)).nextRunAt, "2026-01-02T09:00:00.000Z");
    }),
  ),
);

it.effect("records one missed occurrence on startup and skips the backlog", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-01-01T00:00:00.000Z"));
      let nextByte = 60;
      const dependencies = Layer.mergeAll(
        ScheduledPromptRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        Layer.mock(ScheduledPromptExecutor)({ execute: (run) => Effect.succeed(run.threadId!) }),
        Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
          subscribeDomainEvents: Effect.succeed(Stream.empty),
        }),
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size).fill(++nextByte),
            digest: () => Effect.die("unused"),
          }),
        ),
      );
      const context = yield* Layer.build(
        ScheduledPromptSchedulerLive.pipe(Layer.provideMerge(dependencies)),
      );
      const scheduler = yield* Effect.service(ScheduledPromptScheduler).pipe(
        Effect.provide(context),
      );
      const reactor = yield* Effect.service(ScheduledPromptReactor).pipe(Effect.provide(context));
      yield* reactor.start().pipe(Effect.provide(context));
      const schedule = yield* scheduler.create(createInput);

      yield* TestClock.setTime(Date.parse("2026-01-03T10:00:00.000Z"));
      yield* reactor.activate;

      const runs = (yield* scheduler.runs(schedule.id, 100)).runs;
      assert.lengthOf(runs, 1);
      assert.strictEqual(runs[0]?.state, "missed");
      assert.strictEqual(runs[0]?.scheduledAt, "2026-01-01T09:00:00.000Z");
      assert.strictEqual((yield* scheduler.get(schedule.id)).nextRunAt, "2026-01-04T09:00:00.000Z");
    }),
  ),
);

const sessionEvent = (
  threadId: ThreadId,
  status: "ready" | "running",
  sequence: number,
): OrchestrationEvent => ({
  type: "thread.session-set",
  sequence,
  eventId: EventId.make(`event-${sequence}`),
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
  commandId: CommandId.make(`command-${sequence}`),
  causationEventId: null,
  correlationId: null,
  metadata: {},
  payload: {
    threadId,
    session: {
      threadId,
      status,
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "full-access",
      activeTurnId: status === "running" ? TurnId.make("turn-1") : null,
      lastError: null,
      updatedAt: `2026-01-01T00:00:0${sequence}.000Z`,
    },
  },
});

it.effect("ignores initial ready and finalizes after a real running transition", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-01-01T00:00:00.000Z"));
      const events = yield* PubSub.unbounded<OrchestrationEvent>();
      let nextByte = 20;
      const dependencies = Layer.mergeAll(
        ScheduledPromptRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
        Layer.mock(ScheduledPromptExecutor)({ execute: (run) => Effect.succeed(run.threadId!) }),
        Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
          subscribeDomainEvents: PubSub.subscribe(events).pipe(
            Effect.map((subscription) => Stream.fromSubscription(subscription)),
          ),
        }),
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size).fill(++nextByte),
            digest: () => Effect.die("unused"),
          }),
        ),
      );
      const context = yield* Layer.build(
        ScheduledPromptSchedulerLive.pipe(Layer.provideMerge(dependencies)),
      );
      const scheduler = yield* Effect.service(ScheduledPromptScheduler).pipe(
        Effect.provide(context),
      );
      const reactor = yield* Effect.service(ScheduledPromptReactor).pipe(Effect.provide(context));
      const repository = yield* Effect.service(ScheduledPromptRepository).pipe(
        Effect.provide(context),
      );
      yield* reactor.start().pipe(Effect.provide(context));
      yield* reactor.activate;
      const schedule = yield* scheduler.create(createInput);
      const run = yield* scheduler.runNow(schedule.id);
      const threadId = run.threadId!;

      yield* PubSub.publish(events, sessionEvent(threadId, "ready", 1));
      yield* Effect.yieldNow;
      assert.strictEqual(Option.getOrThrow(yield* repository.getRun(run.id)).state, "pending");

      yield* PubSub.publish(events, sessionEvent(threadId, "running", 2));
      yield* Effect.yieldNow;
      assert.strictEqual(Option.getOrThrow(yield* repository.getRun(run.id)).state, "running");

      yield* PubSub.publish(events, sessionEvent(threadId, "ready", 3));
      yield* Effect.yieldNow;
      assert.strictEqual(Option.getOrThrow(yield* repository.getRun(run.id)).state, "succeeded");
      assert.isNull(Option.getOrThrow(yield* repository.get(schedule.id)).activeRunId);
    }),
  ),
);
