import type { IsoDateTime, ScheduledPromptRecurrence } from "@t3tools/contracts";
import { ScheduledPromptError } from "@t3tools/contracts";
import * as Cron from "effect/Cron";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

const validationError = (message: string) =>
  new ScheduledPromptError({ reason: "validation", message });

const cronExpression = (recurrence: Exclude<ScheduledPromptRecurrence, { _tag: "once" }>) => {
  switch (recurrence._tag) {
    case "hourly":
      return `${recurrence.minute} * * * *`;
    case "daily":
      return `${recurrence.minute} ${recurrence.hour} * * *`;
    case "weekdays":
      return `${recurrence.minute} ${recurrence.hour} * * 1-5`;
    case "weekly":
      return `${recurrence.minute} ${recurrence.hour} * * ${recurrence.weekday}`;
    case "cron":
      return recurrence.expression;
  }
};

const parseInstant = (value: IsoDateTime) =>
  Option.match(DateTime.make(value), {
    onNone: () => Effect.fail(validationError(`Invalid date-time: ${value}`)),
    onSome: Effect.succeed,
  });

const parseRecurrence = (
  recurrence: Exclude<ScheduledPromptRecurrence, { _tag: "once" }>,
  timezone: string,
) => {
  const expression = cronExpression(recurrence);
  if (expression.trim().split(/\s+/).length !== 5) {
    return Effect.fail(validationError("Cron expressions must contain exactly five fields"));
  }
  const parsed = Cron.parse(expression, timezone);
  return Result.isFailure(parsed)
    ? Effect.fail(validationError(parsed.failure.message))
    : Effect.succeed(parsed.success);
};

const validateTimezone = (timezone: string) =>
  Option.isSome(DateTime.zoneFromString(timezone))
    ? Effect.void
    : Effect.fail(validationError(`Invalid time zone: ${timezone}`));

export const validateSchedule = (recurrence: ScheduledPromptRecurrence, timezone: string) =>
  Effect.gen(function* () {
    yield* validateTimezone(timezone);
    if (recurrence._tag === "once") {
      yield* parseInstant(recurrence.at);
      return;
    }
    yield* parseRecurrence(recurrence, timezone);
  });

export const nextOccurrence = (
  recurrence: ScheduledPromptRecurrence,
  timezone: string,
  afterExclusive: IsoDateTime,
) =>
  Effect.gen(function* () {
    yield* validateTimezone(timezone);
    const after = yield* parseInstant(afterExclusive);

    if (recurrence._tag === "once") {
      const at = yield* parseInstant(recurrence.at);
      return DateTime.toEpochMillis(at) > DateTime.toEpochMillis(after)
        ? Option.some(DateTime.formatIso(DateTime.toUtc(at)))
        : Option.none<IsoDateTime>();
    }

    const cron = yield* parseRecurrence(recurrence, timezone);
    return Option.some(Cron.next(cron, after).toISOString());
  });

export const nextAfterScheduled = (
  recurrence: ScheduledPromptRecurrence,
  timezone: string,
  scheduledAt: IsoDateTime,
) => nextOccurrence(recurrence, timezone, scheduledAt);

export const advancePastNow = (
  recurrence: ScheduledPromptRecurrence,
  timezone: string,
  nextRunAt: IsoDateTime,
  now: IsoDateTime,
) =>
  Effect.gen(function* () {
    const scheduled = yield* parseInstant(nextRunAt);
    const current = yield* parseInstant(now);
    if (DateTime.toEpochMillis(scheduled) > DateTime.toEpochMillis(current)) {
      return { missedAt: null, nextRunAt };
    }

    const next = yield* nextOccurrence(recurrence, timezone, now);
    return {
      missedAt: nextRunAt,
      nextRunAt: Option.getOrNull(next),
    };
  });
