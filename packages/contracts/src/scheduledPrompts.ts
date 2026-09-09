import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  ModelSelection,
  ProviderInteractionMode,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  RuntimeMode,
} from "./orchestration.ts";

const boundedTrimmedString = (maxLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maxLength));

export const ScheduledPromptId = TrimmedNonEmptyString.pipe(Schema.brand("ScheduledPromptId"));
export type ScheduledPromptId = typeof ScheduledPromptId.Type;

export const ScheduledPromptRunId = TrimmedNonEmptyString.pipe(
  Schema.brand("ScheduledPromptRunId"),
);
export type ScheduledPromptRunId = typeof ScheduledPromptRunId.Type;

const HourOfDay = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 23 }));
const MinuteOfHour = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 59 }));
const Weekday = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }));

export const ScheduledPromptRecurrence = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("once"), at: IsoDateTime }),
  Schema.Struct({ _tag: Schema.Literal("hourly"), minute: MinuteOfHour }),
  Schema.Struct({ _tag: Schema.Literal("daily"), hour: HourOfDay, minute: MinuteOfHour }),
  Schema.Struct({ _tag: Schema.Literal("weekdays"), hour: HourOfDay, minute: MinuteOfHour }),
  Schema.Struct({
    _tag: Schema.Literal("weekly"),
    weekday: Weekday,
    hour: HourOfDay,
    minute: MinuteOfHour,
  }),
  Schema.Struct({
    _tag: Schema.Literal("cron"),
    expression: boundedTrimmedString(200),
  }),
]);
export type ScheduledPromptRecurrence = typeof ScheduledPromptRecurrence.Type;

export const ScheduledPromptWorkspace = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("project") }),
  Schema.Struct({
    _tag: Schema.Literal("worktree"),
    baseBranch: boundedTrimmedString(500),
    startFromOrigin: Schema.Boolean,
    runSetupScript: Schema.Boolean,
  }),
]);
export type ScheduledPromptWorkspace = typeof ScheduledPromptWorkspace.Type;

export const ScheduledPromptAction = Schema.Struct({
  _tag: Schema.Literal("prompt"),
  projectId: ProjectId,
  prompt: boundedTrimmedString(PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspace: ScheduledPromptWorkspace,
});
export type ScheduledPromptAction = typeof ScheduledPromptAction.Type;

export const ScheduledPromptRunState = Schema.Literals([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "missed",
]);
export type ScheduledPromptRunState = typeof ScheduledPromptRunState.Type;

export const ScheduledPromptRunTrigger = Schema.Literals(["scheduled", "manual"]);
export type ScheduledPromptRunTrigger = typeof ScheduledPromptRunTrigger.Type;

export const SCHEDULED_PROMPT_RUN_REASON_MAX_LENGTH = 2_000;

const ScheduledPromptRunSummaryFields = {
  id: ScheduledPromptRunId,
  state: ScheduledPromptRunState,
  scheduledAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
  threadId: Schema.NullOr(ThreadId),
  reason: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(SCHEDULED_PROMPT_RUN_REASON_MAX_LENGTH)),
  ),
} as const;

export const ScheduledPromptLastRunSummary = Schema.Struct(ScheduledPromptRunSummaryFields);
export type ScheduledPromptLastRunSummary = typeof ScheduledPromptLastRunSummary.Type;

export const ScheduledPromptRun = Schema.Struct({
  ...ScheduledPromptRunSummaryFields,
  scheduleId: ScheduledPromptId,
  trigger: ScheduledPromptRunTrigger,
});
export type ScheduledPromptRun = typeof ScheduledPromptRun.Type;

const ScheduledPromptBaseFields = {
  id: ScheduledPromptId,
  name: boundedTrimmedString(200),
  description: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000))),
  enabled: Schema.Boolean,
  timezone: boundedTrimmedString(100),
  recurrence: ScheduledPromptRecurrence,
  nextRunAt: Schema.NullOr(IsoDateTime),
  activeRunId: Schema.NullOr(ScheduledPromptRunId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
} as const;

export const ScheduledPrompt = Schema.Struct({
  ...ScheduledPromptBaseFields,
  action: ScheduledPromptAction,
});
export type ScheduledPrompt = typeof ScheduledPrompt.Type;

export const ScheduledPromptSummary = Schema.Struct({
  ...ScheduledPromptBaseFields,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspace: ScheduledPromptWorkspace,
  lastRun: Schema.NullOr(ScheduledPromptLastRunSummary),
});
export type ScheduledPromptSummary = typeof ScheduledPromptSummary.Type;

const ScheduledPromptEditableFields = {
  name: boundedTrimmedString(200),
  description: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000))),
  enabled: Schema.Boolean,
  timezone: boundedTrimmedString(100),
  recurrence: ScheduledPromptRecurrence,
  action: ScheduledPromptAction,
} as const;

export const ScheduledPromptCreateInput = Schema.Struct(ScheduledPromptEditableFields);
export type ScheduledPromptCreateInput = typeof ScheduledPromptCreateInput.Type;

export const ScheduledPromptUpdateInput = Schema.Struct({
  id: ScheduledPromptId,
  ...ScheduledPromptEditableFields,
});
export type ScheduledPromptUpdateInput = typeof ScheduledPromptUpdateInput.Type;

export const ScheduledPromptGetInput = Schema.Struct({ id: ScheduledPromptId });
export const ScheduledPromptDeleteInput = ScheduledPromptGetInput;
export const ScheduledPromptRunNowInput = ScheduledPromptGetInput;
export const ScheduledPromptSetEnabledInput = Schema.Struct({
  id: ScheduledPromptId,
  enabled: Schema.Boolean,
});
export const ScheduledPromptRunsInput = Schema.Struct({
  id: ScheduledPromptId,
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(100)),
  ),
});

export const ScheduledPromptListResult = Schema.Struct({
  schedules: Schema.Array(ScheduledPromptSummary),
});
export type ScheduledPromptListResult = typeof ScheduledPromptListResult.Type;

export const ScheduledPromptRunListResult = Schema.Struct({
  runs: Schema.Array(ScheduledPromptRun),
});
export type ScheduledPromptRunListResult = typeof ScheduledPromptRunListResult.Type;

export const ScheduledPromptRevision = Schema.Struct({ revision: NonNegativeInt });
export type ScheduledPromptRevision = typeof ScheduledPromptRevision.Type;

export class ScheduledPromptError extends Schema.TaggedError<ScheduledPromptError>()(
  "ScheduledPromptError",
  {
    reason: Schema.Literals([
      "validation",
      "not-found",
      "conflict",
      "unavailable",
      "persistence",
      "dispatch",
    ]),
    message: boundedTrimmedString(2_000),
  },
) {}
