import {
  IsoDateTime,
  ScheduledPromptError,
  ScheduledPromptId,
  ScheduledPromptRunId,
  type OrchestrationEvent,
  type ScheduledPrompt,
  type ScheduledPromptCreateInput,
  type ScheduledPromptListResult,
  type ScheduledPromptRevision,
  type ScheduledPromptRun,
  type ScheduledPromptRunListResult,
  type ScheduledPromptSummary,
  type ScheduledPromptUpdateInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import { subscribeBeforeSnapshotWithoutMutex } from "../utils/subscribeBeforeSnapshot.ts";
import {
  ScheduledPromptRepository,
  toScheduledPromptRun,
  type ScheduledPromptRunRecord,
} from "./Persistence.ts";
import {
  advancePastNow,
  nextAfterScheduled,
  nextOccurrence,
  validateSchedule,
} from "./Recurrence.ts";
import { ScheduledPromptExecutor } from "./ScheduledPromptExecutor.ts";

export interface ScheduledPromptSchedulerShape {
  readonly list: Effect.Effect<ScheduledPromptListResult, ScheduledPromptError>;
  readonly get: (id: ScheduledPromptId) => Effect.Effect<ScheduledPrompt, ScheduledPromptError>;
  readonly create: (
    input: ScheduledPromptCreateInput,
  ) => Effect.Effect<ScheduledPrompt, ScheduledPromptError>;
  readonly update: (
    input: ScheduledPromptUpdateInput,
  ) => Effect.Effect<ScheduledPrompt, ScheduledPromptError>;
  readonly delete: (id: ScheduledPromptId) => Effect.Effect<void, ScheduledPromptError>;
  readonly setEnabled: (
    id: ScheduledPromptId,
    enabled: boolean,
  ) => Effect.Effect<ScheduledPrompt, ScheduledPromptError>;
  readonly runNow: (
    id: ScheduledPromptId,
  ) => Effect.Effect<ScheduledPromptRun, ScheduledPromptError>;
  readonly runs: (
    id: ScheduledPromptId,
    limit: number,
  ) => Effect.Effect<ScheduledPromptRunListResult, ScheduledPromptError>;
  readonly subscribe: Effect.Effect<
    Stream.Stream<ScheduledPromptRevision, ScheduledPromptError>,
    ScheduledPromptError,
    Scope.Scope
  >;
}

export class ScheduledPromptScheduler extends Context.Service<
  ScheduledPromptScheduler,
  ScheduledPromptSchedulerShape
>()("t3/scheduledPrompts/ScheduledPromptScheduler") {}

export interface ScheduledPromptReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly activate: Effect.Effect<void>;
}

export class ScheduledPromptReactor extends Context.Service<
  ScheduledPromptReactor,
  ScheduledPromptReactorShape
>()("t3/scheduledPrompts/ScheduledPromptScheduler/ScheduledPromptReactor") {}

const scheduledError = (reason: ScheduledPromptError["reason"], message: string) =>
  new ScheduledPromptError({ reason, message });

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const epochMillis = (value: IsoDateTime) => DateTime.toEpochMillis(DateTime.makeUnsafe(value));

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const repository = yield* ScheduledPromptRepository;
  const executor = yield* ScheduledPromptExecutor;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const revisions = yield* PubSub.unbounded<ScheduledPromptRevision>();
  const revisionWakeups = yield* PubSub.subscribe(revisions);
  const lifecycleEvents = yield* engine.subscribeDomainEvents;
  const executionQueue = yield* Queue.unbounded<ScheduledPromptRunRecord>();
  const activation = yield* Deferred.make<void>();

  const mapRepositoryError = (message: string) => () => scheduledError("persistence", message);
  const publishRevision = repository.revision.pipe(
    Effect.flatMap((revision) => PubSub.publish(revisions, { revision })),
    Effect.asVoid,
    Effect.mapError(mapRepositoryError("Failed to publish the schedule update.")),
  );
  const publishRevisionIgnoringFailure = publishRevision.pipe(Effect.ignoreCause({ log: true }));

  const randomUuid = crypto.randomUUIDv4.pipe(
    Effect.mapError(() => scheduledError("unavailable", "Failed to allocate an identifier.")),
  );
  const newScheduleId = randomUuid.pipe(
    Effect.map((uuid) => ScheduledPromptId.make(`schedule:${uuid}`)),
  );
  const newRunId = randomUuid.pipe(Effect.map((uuid) => ScheduledPromptRunId.make(`run:${uuid}`)));

  const requireSchedule = (id: ScheduledPromptId) =>
    repository.get(id).pipe(
      Effect.mapError(mapRepositoryError("Failed to load the schedule.")),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(scheduledError("not-found", "Scheduled prompt not found.")),
          onSome: Effect.succeed,
        }),
      ),
    );

  const computeNextRunAt = (
    input: Pick<ScheduledPrompt, "recurrence" | "timezone" | "enabled">,
    now: IsoDateTime,
  ) =>
    Effect.gen(function* () {
      yield* validateSchedule(input.recurrence, input.timezone);
      const next = yield* nextOccurrence(input.recurrence, input.timezone, now);
      if (input.enabled && Option.isNone(next)) {
        return yield* Effect.fail(
          scheduledError("validation", "An enabled one-time schedule must be in the future."),
        );
      }
      return Option.getOrNull(next);
    });

  const lastRunSummary = (run: ScheduledPromptRunRecord) => ({
    id: run.id,
    state: run.state,
    scheduledAt: run.scheduledAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    threadId: run.threadId,
    reason: run.reason,
  });
  const toSummary = Effect.fn("ScheduledPromptScheduler.toSummary")(function* (
    schedule: ScheduledPrompt,
  ) {
    const last = yield* repository.listRuns(schedule.id, 1);
    return {
      id: schedule.id,
      name: schedule.name,
      description: schedule.description,
      enabled: schedule.enabled,
      timezone: schedule.timezone,
      recurrence: schedule.recurrence,
      nextRunAt: schedule.nextRunAt,
      activeRunId: schedule.activeRunId,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      projectId: schedule.action.projectId,
      modelSelection: schedule.action.modelSelection,
      runtimeMode: schedule.action.runtimeMode,
      interactionMode: schedule.action.interactionMode,
      workspace: schedule.action.workspace,
      lastRun: last[0] ? lastRunSummary(last[0]) : null,
    } satisfies ScheduledPromptSummary;
  });

  const list = repository.list.pipe(
    Effect.flatMap((schedules) => Effect.forEach(schedules, toSummary)),
    Effect.map((schedules) => ({ schedules })),
    Effect.mapError(mapRepositoryError("Failed to list scheduled prompts.")),
  );

  const get: ScheduledPromptSchedulerShape["get"] = requireSchedule;

  const create: ScheduledPromptSchedulerShape["create"] = (input) =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      const id = yield* newScheduleId;
      const nextRunAt = yield* computeNextRunAt(input, now);
      const schedule = {
        ...input,
        id,
        nextRunAt,
        activeRunId: null,
        createdAt: now,
        updatedAt: now,
      } satisfies ScheduledPrompt;
      yield* repository
        .upsert(schedule)
        .pipe(Effect.mapError(mapRepositoryError("Failed to create the schedule.")));
      yield* publishRevision;
      return schedule;
    });

  const update: ScheduledPromptSchedulerShape["update"] = (input) =>
    Effect.gen(function* () {
      const current = yield* requireSchedule(input.id);
      const now = yield* nowIso;
      const nextRunAt = yield* computeNextRunAt(input, now);
      const schedule = {
        ...input,
        nextRunAt,
        activeRunId: current.activeRunId,
        createdAt: current.createdAt,
        updatedAt: now,
      } satisfies ScheduledPrompt;
      yield* repository
        .upsert(schedule)
        .pipe(Effect.mapError(mapRepositoryError("Failed to update the schedule.")));
      yield* publishRevision;
      return schedule;
    });

  const deleteSchedule: ScheduledPromptSchedulerShape["delete"] = (id) =>
    Effect.gen(function* () {
      yield* requireSchedule(id);
      yield* repository
        .delete(id)
        .pipe(Effect.mapError(mapRepositoryError("Failed to delete the schedule.")));
      yield* publishRevision;
    });

  const setEnabled: ScheduledPromptSchedulerShape["setEnabled"] = (id, enabled) =>
    Effect.gen(function* () {
      const current = yield* requireSchedule(id);
      if (current.enabled === enabled) return current;
      const now = yield* nowIso;
      const nextRunAt = enabled
        ? yield* computeNextRunAt({ ...current, enabled }, now)
        : current.nextRunAt;
      const schedule = { ...current, enabled, nextRunAt, updatedAt: now };
      yield* repository
        .upsert(schedule)
        .pipe(Effect.mapError(mapRepositoryError("Failed to change the schedule state.")));
      yield* publishRevision;
      return schedule;
    });

  const enqueueClaim = (run: ScheduledPromptRunRecord) =>
    Queue.offer(executionQueue, run).pipe(Effect.asVoid);

  const runNow: ScheduledPromptSchedulerShape["runNow"] = (id) =>
    Effect.gen(function* () {
      yield* requireSchedule(id);
      const scheduledAt = yield* nowIso;
      const runId = yield* newRunId;
      const result = yield* repository
        .claimManual({ scheduleId: id, runId, scheduledAt })
        .pipe(Effect.mapError(mapRepositoryError("Failed to claim the manual run.")));
      if (result._tag === "stale") {
        return yield* Effect.fail(scheduledError("not-found", "Scheduled prompt not found."));
      }
      yield* publishRevision;
      if (result._tag === "claimed") yield* enqueueClaim(result.run);
      return toScheduledPromptRun(result.run);
    });

  const runs: ScheduledPromptSchedulerShape["runs"] = (id, limit) =>
    Effect.gen(function* () {
      yield* requireSchedule(id);
      const rows = yield* repository
        .listRuns(id, limit)
        .pipe(Effect.mapError(mapRepositoryError("Failed to load schedule history.")));
      return { runs: rows.map(toScheduledPromptRun) };
    });

  const subscribe = subscribeBeforeSnapshotWithoutMutex(
    revisions,
    repository.revision.pipe(
      Effect.map((revision) => ({ revision })),
      Effect.mapError(mapRepositoryError("Failed to subscribe to schedule changes.")),
    ),
  ).pipe(Effect.map(({ latest, changes }) => Stream.concat(Stream.succeed(latest), changes)));

  const executeRun = (run: ScheduledPromptRunRecord) =>
    repository.get(run.scheduleId).pipe(
      Effect.mapError(mapRepositoryError("Failed to load the claimed schedule.")),
      Effect.flatMap((scheduleOption) =>
        executor.execute(
          run,
          Option.getOrElse(scheduleOption, () => ({
            id: run.scheduleId,
            name: run.scheduleName,
            description: null,
            enabled: false,
            timezone: "UTC",
            recurrence: { _tag: "once", at: run.scheduledAt },
            action: run.action,
            nextRunAt: null,
            activeRunId: run.id,
            createdAt: run.scheduledAt,
            updatedAt: run.scheduledAt,
          })),
        ),
      ),
      Effect.catch((cause) =>
        nowIso.pipe(
          Effect.flatMap((finishedAt) =>
            repository.finish({
              runId: run.id,
              state: "failed",
              finishedAt,
              reason: cause.message,
            }),
          ),
          Effect.flatMap((changed) => (changed ? publishRevisionIgnoringFailure : Effect.void)),
          Effect.ignoreCause({ log: true }),
        ),
      ),
      Effect.asVoid,
    );

  const processDue = (now: IsoDateTime) =>
    repository.listDue(now).pipe(
      Effect.flatMap((due) =>
        Effect.forEach(
          due,
          (schedule) =>
            Effect.gen(function* () {
              const next = yield* nextAfterScheduled(
                schedule.recurrence,
                schedule.timezone,
                schedule.nextRunAt!,
              );
              const result = yield* repository.claimScheduled({
                scheduleId: schedule.id,
                expectedNextRunAt: schedule.nextRunAt!,
                runId: yield* newRunId,
                nextRunAt: Option.getOrNull(next),
              });
              if (result._tag === "claimed") yield* enqueueClaim(result.run);
              if (result._tag !== "stale") yield* publishRevision;
            }).pipe(
              Effect.catch((cause) =>
                Effect.logError("Failed to process a due scheduled prompt", {
                  scheduleId: schedule.id,
                  cause,
                }),
              ),
            ),
          { discard: true },
        ),
      ),
      Effect.ignoreCause({ log: true }),
    );

  const recover = Effect.gen(function* () {
    const now = yield* nowIso;
    const recovered = yield* repository.failUnfinished({
      finishedAt: now,
      reason: "Server restarted before the scheduled run completed",
    });
    if (recovered > 0) yield* publishRevision;
    const due = yield* repository.listDue(now);
    yield* Effect.forEach(
      due,
      (schedule) =>
        Effect.gen(function* () {
          const advanced = yield* advancePastNow(
            schedule.recurrence,
            schedule.timezone,
            schedule.nextRunAt!,
            now,
          );
          if (advanced.missedAt === null) return;
          const result = yield* repository.recordMissed({
            scheduleId: schedule.id,
            expectedNextRunAt: schedule.nextRunAt!,
            runId: yield* newRunId,
            nextRunAt: advanced.nextRunAt,
            recordedAt: now,
            disable: schedule.recurrence._tag === "once",
          });
          if (result._tag === "recorded") yield* publishRevision;
        }).pipe(Effect.ignoreCause({ log: true })),
      { discard: true },
    );
  });

  const nextWake = repository.list.pipe(
    Effect.map(
      (schedules) =>
        schedules
          .filter((schedule) => schedule.enabled && schedule.nextRunAt !== null)
          .map((schedule) => schedule.nextRunAt!)
          .toSorted((left, right) => epochMillis(left) - epochMillis(right))[0] ?? null,
    ),
  );

  const wakeLoop: Effect.Effect<void, never> = Effect.gen(function* () {
    const now = yield* nowIso;
    yield* processDue(now);
    const wakeAt = yield* nextWake;
    if (wakeAt === null) {
      yield* PubSub.take(revisionWakeups);
    } else {
      const delay = Math.max(0, epochMillis(wakeAt) - epochMillis(yield* nowIso));
      yield* Effect.raceFirst(Effect.sleep(Duration.millis(delay)), PubSub.take(revisionWakeups));
    }
  }).pipe(Effect.ignoreCause({ log: true }), Effect.forever);

  const observeLifecycle = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      let changed = false;
      if (event.type === "thread.session-set") {
        const { threadId, session } = event.payload;
        if (session.status === "running") {
          changed = yield* repository.markRunningByThread({
            threadId,
            startedAt: session.updatedAt,
          });
        } else if (
          session.status === "error" ||
          session.status === "interrupted" ||
          session.status === "stopped"
        ) {
          changed = yield* repository.finishByThread({
            threadId,
            state: "failed",
            finishedAt: session.updatedAt,
            reason: session.lastError ?? `Provider session ${session.status}`,
          });
        } else if (session.status === "idle" || session.status === "ready") {
          changed = yield* repository.finishByThread({
            threadId,
            state: "succeeded",
            finishedAt: session.updatedAt,
            reason: null,
            onlyIfRunning: true,
          });
        }
      } else if (event.type === "thread.settled") {
        changed = yield* repository.finishByThread({
          threadId: event.payload.threadId,
          state: "succeeded",
          finishedAt: event.payload.settledAt,
          reason: null,
        });
      } else if (event.type === "thread.deleted") {
        changed = yield* repository.finishByThread({
          threadId: event.payload.threadId,
          state: "failed",
          finishedAt: event.payload.deletedAt,
          reason: "The scheduled thread was deleted before completion",
        });
      }
      if (changed) yield* publishRevision;
    }).pipe(Effect.ignoreCause({ log: true }));

  const start = () =>
    Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(lifecycleEvents, observeLifecycle).pipe(
          Effect.ignoreCause({ log: true }),
        ),
      );
      yield* Effect.forkScoped(
        Effect.forever(Queue.take(executionQueue).pipe(Effect.flatMap(executeRun))),
      );
      yield* Effect.forkScoped(Deferred.await(activation).pipe(Effect.andThen(wakeLoop)));
    });
  const activate = recover.pipe(
    Effect.orDie,
    Effect.andThen(Deferred.succeed(activation, undefined)),
    Effect.asVoid,
  );

  return {
    scheduler: {
      list,
      get,
      create,
      update,
      delete: deleteSchedule,
      setEnabled,
      runNow,
      runs,
      subscribe,
    } satisfies ScheduledPromptSchedulerShape,
    reactor: { start, activate } satisfies ScheduledPromptReactorShape,
  };
});

export const ScheduledPromptSchedulerLive = Layer.effectContext(
  make.pipe(
    Effect.map(({ scheduler, reactor }) =>
      Context.make(ScheduledPromptScheduler, scheduler).pipe(
        Context.add(ScheduledPromptReactor, reactor),
      ),
    ),
  ),
);
