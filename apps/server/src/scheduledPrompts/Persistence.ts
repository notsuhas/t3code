import {
  IsoDateTime,
  ScheduledPrompt,
  ScheduledPromptAction,
  ScheduledPromptId,
  ScheduledPromptRecurrence,
  ScheduledPromptRun,
  ScheduledPromptRunId,
  ScheduledPromptRunState,
  ScheduledPromptRunTrigger,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  type PersistenceDecodeError,
  type PersistenceSqlError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../persistence/Errors.ts";

type RepositoryError = PersistenceSqlError | PersistenceDecodeError;

export const ScheduledPromptRunRecord = Schema.Struct({
  id: ScheduledPromptRunId,
  scheduleId: ScheduledPromptId,
  state: ScheduledPromptRunState,
  trigger: ScheduledPromptRunTrigger,
  scheduledAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
  threadId: Schema.NullOr(ThreadId),
  reason: Schema.NullOr(Schema.String),
  scheduleName: Schema.String,
  action: ScheduledPromptAction,
  worktreeBranch: Schema.NullOr(Schema.String),
});
export type ScheduledPromptRunRecord = typeof ScheduledPromptRunRecord.Type;

export type ScheduledPromptClaimResult =
  | { readonly _tag: "claimed"; readonly run: ScheduledPromptRunRecord }
  | { readonly _tag: "skipped"; readonly run: ScheduledPromptRunRecord }
  | { readonly _tag: "stale" };

export interface ScheduledPromptRepositoryShape {
  readonly revision: Effect.Effect<number, RepositoryError>;
  readonly list: Effect.Effect<ReadonlyArray<ScheduledPrompt>, RepositoryError>;
  readonly get: (
    id: ScheduledPromptId,
  ) => Effect.Effect<Option.Option<ScheduledPrompt>, RepositoryError>;
  readonly upsert: (schedule: ScheduledPrompt) => Effect.Effect<void, RepositoryError>;
  readonly delete: (id: ScheduledPromptId) => Effect.Effect<void, RepositoryError>;
  readonly listDue: (now: IsoDateTime) => Effect.Effect<ReadonlyArray<ScheduledPrompt>, RepositoryError>;
  readonly claimScheduled: (input: {
    readonly scheduleId: ScheduledPromptId;
    readonly expectedNextRunAt: IsoDateTime;
    readonly runId: ScheduledPromptRunId;
    readonly nextRunAt: IsoDateTime | null;
  }) => Effect.Effect<ScheduledPromptClaimResult, RepositoryError>;
  readonly claimManual: (input: {
    readonly scheduleId: ScheduledPromptId;
    readonly runId: ScheduledPromptRunId;
    readonly scheduledAt: IsoDateTime;
  }) => Effect.Effect<ScheduledPromptClaimResult, RepositoryError>;
  readonly getRun: (
    id: ScheduledPromptRunId,
  ) => Effect.Effect<Option.Option<ScheduledPromptRunRecord>, RepositoryError>;
  readonly listRuns: (
    scheduleId: ScheduledPromptId,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<ScheduledPromptRunRecord>, RepositoryError>;
  readonly listUnfinishedRuns: Effect.Effect<ReadonlyArray<ScheduledPromptRunRecord>, RepositoryError>;
  readonly markRunning: (input: {
    readonly runId: ScheduledPromptRunId;
    readonly threadId: ThreadId;
    readonly startedAt: IsoDateTime;
  }) => Effect.Effect<void, RepositoryError>;
  readonly finish: (input: {
    readonly runId: ScheduledPromptRunId;
    readonly state: "succeeded" | "failed";
    readonly finishedAt: IsoDateTime;
    readonly reason: string | null;
  }) => Effect.Effect<void, RepositoryError>;
}

export class ScheduledPromptRepository extends Context.Service<
  ScheduledPromptRepository,
  ScheduledPromptRepositoryShape
>()("t3/scheduledPrompts/Persistence/ScheduledPromptRepository") {}

const ScheduleRow = Schema.Struct({
  id: ScheduledPromptId,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  enabled: Schema.Number,
  timezone: Schema.String,
  recurrence: Schema.fromJsonString(ScheduledPromptRecurrence),
  action: Schema.fromJsonString(ScheduledPromptAction),
  nextRunAt: Schema.NullOr(IsoDateTime),
  activeRunId: Schema.NullOr(ScheduledPromptRunId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
type ScheduleRow = typeof ScheduleRow.Type;

const RunRow = ScheduledPromptRunRecord.mapFields(
  Struct.assign({ action: Schema.fromJsonString(ScheduledPromptAction) }),
);

const toSchedule = (row: ScheduleRow): ScheduledPrompt => ({
  ...row,
  enabled: row.enabled === 1,
});

const toPublicRun = (run: ScheduledPromptRunRecord): ScheduledPromptRun => ({
  id: run.id,
  scheduleId: run.scheduleId,
  state: run.state,
  trigger: run.trigger,
  scheduledAt: run.scheduledAt,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  threadId: run.threadId,
  reason: run.reason,
});
void toPublicRun;

const mapRepositoryError = (operation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? toPersistenceDecodeError(`${operation}:decode`)(cause)
    : toPersistenceSqlError(`${operation}:query`)(cause);

const makeRun = (
  schedule: ScheduledPrompt,
  id: ScheduledPromptRunId,
  trigger: "scheduled" | "manual",
  scheduledAt: IsoDateTime,
  state: "pending" | "skipped",
): ScheduledPromptRunRecord => ({
  id,
  scheduleId: schedule.id,
  state,
  trigger,
  scheduledAt,
  startedAt: null,
  finishedAt: state === "skipped" ? scheduledAt : null,
  threadId: null,
  reason: state === "skipped" ? "Previous scheduled run is still active" : null,
  scheduleName: schedule.name,
  action: schedule.action,
  worktreeBranch:
    schedule.action.workspace._tag === "worktree"
      ? `t3/schedule/${schedule.id}/${id}`
      : null,
});

const makeScheduledPromptRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const selectSchedule = (where: "one" | "all" | "due", value?: string) => {
    const query =
      where === "one"
        ? sql`SELECT schedule_id AS "id", name, description, enabled, timezone,
            recurrence_json AS "recurrence", action_json AS "action",
            next_run_at AS "nextRunAt", active_run_id AS "activeRunId",
            created_at AS "createdAt", updated_at AS "updatedAt"
          FROM scheduled_prompts WHERE schedule_id = ${value}`
        : where === "due"
          ? sql`SELECT schedule_id AS "id", name, description, enabled, timezone,
              recurrence_json AS "recurrence", action_json AS "action",
              next_run_at AS "nextRunAt", active_run_id AS "activeRunId",
              created_at AS "createdAt", updated_at AS "updatedAt"
            FROM scheduled_prompts
            WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ${value}
            ORDER BY next_run_at ASC, schedule_id ASC`
          : sql`SELECT schedule_id AS "id", name, description, enabled, timezone,
              recurrence_json AS "recurrence", action_json AS "action",
              next_run_at AS "nextRunAt", active_run_id AS "activeRunId",
              created_at AS "createdAt", updated_at AS "updatedAt"
            FROM scheduled_prompts ORDER BY created_at ASC, schedule_id ASC`;
    return query;
  };

  const decodeScheduleRows = SqlSchema.findAll({
    Request: Schema.Struct({ where: Schema.Literals(["one", "all", "due"]), value: Schema.optional(Schema.String) }),
    Result: ScheduleRow,
    execute: ({ where, value }) => selectSchedule(where, value),
  });

  const get = (id: ScheduledPromptId) =>
    decodeScheduleRows({ where: "one", value: id }).pipe(
      Effect.map((rows) => Option.fromUndefinedOr(rows[0]).pipe(Option.map(toSchedule))),
      Effect.mapError(mapRepositoryError("ScheduledPromptRepository.get")),
    );

  const list = decodeScheduleRows({ where: "all" }).pipe(
    Effect.map((rows) => rows.map(toSchedule)),
    Effect.mapError(mapRepositoryError("ScheduledPromptRepository.list")),
  );

  const listDue = (now: IsoDateTime) =>
    decodeScheduleRows({ where: "due", value: now }).pipe(
      Effect.map((rows) => rows.map(toSchedule)),
      Effect.mapError(mapRepositoryError("ScheduledPromptRepository.listDue")),
    );

  const bumpRevision = sql`UPDATE scheduled_prompt_state SET revision = revision + 1 WHERE singleton = 1`;

  const upsert = (schedule: ScheduledPrompt) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO scheduled_prompts (
            schedule_id, name, description, enabled, timezone, recurrence_json,
            action_json, next_run_at, active_run_id, created_at, updated_at
          ) VALUES (
            ${schedule.id}, ${schedule.name}, ${schedule.description}, ${schedule.enabled ? 1 : 0},
            ${schedule.timezone}, ${JSON.stringify(schedule.recurrence)}, ${JSON.stringify(schedule.action)},
            ${schedule.nextRunAt}, ${schedule.activeRunId}, ${schedule.createdAt}, ${schedule.updatedAt}
          )
          ON CONFLICT (schedule_id) DO UPDATE SET
            name = excluded.name, description = excluded.description, enabled = excluded.enabled,
            timezone = excluded.timezone, recurrence_json = excluded.recurrence_json,
            action_json = excluded.action_json, next_run_at = excluded.next_run_at,
            active_run_id = excluded.active_run_id, updated_at = excluded.updated_at
        `;
        yield* bumpRevision;
      }),
    ).pipe(Effect.mapError(mapRepositoryError("ScheduledPromptRepository.upsert")));

  const deleteSchedule = (id: ScheduledPromptId) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM scheduled_prompts WHERE schedule_id = ${id}`;
        yield* bumpRevision;
      }),
    ).pipe(Effect.mapError(mapRepositoryError("ScheduledPromptRepository.delete")));

  const insertRun = (run: ScheduledPromptRunRecord) => sql`
    INSERT INTO scheduled_prompt_runs (
      run_id, schedule_id, state, trigger, scheduled_at, started_at, finished_at,
      thread_id, reason, schedule_name, action_json, worktree_branch
    ) VALUES (
      ${run.id}, ${run.scheduleId}, ${run.state}, ${run.trigger}, ${run.scheduledAt},
      ${run.startedAt}, ${run.finishedAt}, ${run.threadId}, ${run.reason},
      ${run.scheduleName}, ${JSON.stringify(run.action)}, ${run.worktreeBranch}
    )
  `;

  const claimScheduled: ScheduledPromptRepositoryShape["claimScheduled"] = (input) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const scheduleOption = yield* get(input.scheduleId);
        if (Option.isNone(scheduleOption)) return { _tag: "stale" } as const;
        const schedule = scheduleOption.value;
        if (!schedule.enabled || schedule.nextRunAt !== input.expectedNextRunAt) {
          return { _tag: "stale" } as const;
        }
        const skipped = schedule.activeRunId !== null;
        const run = makeRun(
          schedule,
          input.runId,
          "scheduled",
          input.expectedNextRunAt,
          skipped ? "skipped" : "pending",
        );
        yield* insertRun(run);
        yield* sql`
          UPDATE scheduled_prompts
          SET next_run_at = ${input.nextRunAt},
              active_run_id = ${skipped ? schedule.activeRunId : input.runId},
              updated_at = ${input.expectedNextRunAt}
          WHERE schedule_id = ${input.scheduleId}
            AND next_run_at = ${input.expectedNextRunAt}
        `;
        yield* bumpRevision;
        return skipped ? ({ _tag: "skipped", run } as const) : ({ _tag: "claimed", run } as const);
      }),
    ).pipe(Effect.mapError(mapRepositoryError("ScheduledPromptRepository.claimScheduled")));

  const claimManual: ScheduledPromptRepositoryShape["claimManual"] = (input) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const scheduleOption = yield* get(input.scheduleId);
        if (Option.isNone(scheduleOption)) return { _tag: "stale" } as const;
        const schedule = scheduleOption.value;
        const skipped = schedule.activeRunId !== null;
        const run = makeRun(
          schedule,
          input.runId,
          "manual",
          input.scheduledAt,
          skipped ? "skipped" : "pending",
        );
        yield* insertRun(run);
        if (!skipped) {
          yield* sql`
            UPDATE scheduled_prompts SET active_run_id = ${input.runId}, updated_at = ${input.scheduledAt}
            WHERE schedule_id = ${input.scheduleId} AND active_run_id IS NULL
          `;
        }
        yield* bumpRevision;
        return skipped ? ({ _tag: "skipped", run } as const) : ({ _tag: "claimed", run } as const);
      }),
    ).pipe(Effect.mapError(mapRepositoryError("ScheduledPromptRepository.claimManual")));

  const selectRun = (kind: "one" | "history" | "unfinished", value?: string, limit = 100) => {
    const columns = sql`run_id AS "id", schedule_id AS "scheduleId", state, trigger,
      scheduled_at AS "scheduledAt", started_at AS "startedAt", finished_at AS "finishedAt",
      thread_id AS "threadId", reason, schedule_name AS "scheduleName",
      action_json AS "action", worktree_branch AS "worktreeBranch"`;
    return kind === "one"
      ? sql`SELECT ${columns} FROM scheduled_prompt_runs WHERE run_id = ${value}`
      : kind === "history"
        ? sql`SELECT ${columns} FROM scheduled_prompt_runs WHERE schedule_id = ${value}
            ORDER BY scheduled_at DESC, run_id DESC LIMIT ${limit}`
        : sql`SELECT ${columns} FROM scheduled_prompt_runs
            WHERE state IN ('pending', 'running') ORDER BY scheduled_at ASC, run_id ASC`;
  };
  const decodeRunRows = SqlSchema.findAll({
    Request: Schema.Struct({ kind: Schema.Literals(["one", "history", "unfinished"]), value: Schema.optional(Schema.String), limit: Schema.optional(Schema.Number) }),
    Result: RunRow,
    execute: ({ kind, value, limit }) => selectRun(kind, value, limit),
  });
  const getRun = (id: ScheduledPromptRunId) =>
    decodeRunRows({ kind: "one", value: id }).pipe(
      Effect.map((rows) => Option.fromUndefinedOr(rows[0])),
      Effect.mapError(mapRepositoryError("ScheduledPromptRepository.getRun")),
    );
  const listRuns = (scheduleId: ScheduledPromptId, limit: number) =>
    decodeRunRows({ kind: "history", value: scheduleId, limit }).pipe(
      Effect.mapError(mapRepositoryError("ScheduledPromptRepository.listRuns")),
    );
  const listUnfinishedRuns = decodeRunRows({ kind: "unfinished" }).pipe(
    Effect.mapError(mapRepositoryError("ScheduledPromptRepository.listUnfinishedRuns")),
  );

  const markRunning: ScheduledPromptRepositoryShape["markRunning"] = (input) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`UPDATE scheduled_prompt_runs
          SET state = 'running', thread_id = ${input.threadId}, started_at = ${input.startedAt}
          WHERE run_id = ${input.runId} AND state = 'pending'`;
        yield* bumpRevision;
      }),
    ).pipe(Effect.mapError(mapRepositoryError("ScheduledPromptRepository.markRunning")));

  const finish: ScheduledPromptRepositoryShape["finish"] = (input) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly scheduleId: string }>`
          SELECT schedule_id AS "scheduleId" FROM scheduled_prompt_runs WHERE run_id = ${input.runId}
        `;
        yield* sql`UPDATE scheduled_prompt_runs
          SET state = ${input.state}, finished_at = ${input.finishedAt}, reason = ${input.reason}
          WHERE run_id = ${input.runId} AND state IN ('pending', 'running')`;
        const scheduleId = rows[0]?.scheduleId;
        if (scheduleId !== undefined) {
          yield* sql`UPDATE scheduled_prompts SET active_run_id = NULL, updated_at = ${input.finishedAt}
            WHERE schedule_id = ${scheduleId} AND active_run_id = ${input.runId}`;
        }
        yield* bumpRevision;
      }),
    ).pipe(Effect.mapError(mapRepositoryError("ScheduledPromptRepository.finish")));

  const revision = sql<{ readonly revision: number }>`
    SELECT revision FROM scheduled_prompt_state WHERE singleton = 1
  `.pipe(
    Effect.map((rows) => rows[0]?.revision ?? 0),
    Effect.mapError(mapRepositoryError("ScheduledPromptRepository.revision")),
  );

  return {
    revision,
    list,
    get,
    upsert,
    delete: deleteSchedule,
    listDue,
    claimScheduled,
    claimManual,
    getRun,
    listRuns,
    listUnfinishedRuns,
    markRunning,
    finish,
  } satisfies ScheduledPromptRepositoryShape;
});

export const ScheduledPromptRepositoryLive = Layer.effect(
  ScheduledPromptRepository,
  makeScheduledPromptRepository,
);
