import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  advancePastNow,
  nextAfterScheduled,
  nextOccurrence,
  validateSchedule,
} from "./Recurrence.ts";

describe("scheduled prompt recurrence", () => {
  it.effect("calculates preset recurrences in their configured timezone", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        Option.getOrNull(
          yield* nextOccurrence(
            { _tag: "hourly", minute: 15 },
            "Asia/Kolkata",
            "2026-09-09T05:00:00.000Z",
          ),
        ),
        "2026-09-09T05:45:00.000Z",
      );
      assert.strictEqual(
        Option.getOrNull(
          yield* nextOccurrence(
            { _tag: "weekdays", hour: 9, minute: 30 },
            "America/New_York",
            "2026-09-11T14:00:00.000Z",
          ),
        ),
        "2026-09-14T13:30:00.000Z",
      );
      assert.strictEqual(
        Option.getOrNull(
          yield* nextOccurrence(
            { _tag: "weekly", weekday: 0, hour: 8, minute: 0 },
            "UTC",
            "2026-09-12T10:00:00.000Z",
          ),
        ),
        "2026-09-13T08:00:00.000Z",
      );
    }),
  );

  it.effect("returns a one-time occurrence only while it is in the future", () =>
    Effect.gen(function* () {
      const recurrence = { _tag: "once", at: "2026-09-09T20:00:00.000Z" } as const;
      assert.strictEqual(
        Option.getOrNull(yield* nextOccurrence(recurrence, "UTC", "2026-09-09T19:59:59.999Z")),
        recurrence.at,
      );
      assert.isTrue(Option.isNone(yield* nextOccurrence(recurrence, "UTC", recurrence.at)));
    }),
  );

  it.effect("accepts five-field cron and rejects six-field cron and invalid zones", () =>
    Effect.gen(function* () {
      yield* validateSchedule({ _tag: "cron", expression: "*/10 9-17 * * 1-5" }, "UTC");

      const secondsError = yield* Effect.flip(
        validateSchedule({ _tag: "cron", expression: "0 */10 9-17 * * 1-5" }, "UTC"),
      );
      assert.strictEqual(secondsError.reason, "validation");

      const timezoneError = yield* Effect.flip(
        validateSchedule({ _tag: "daily", hour: 9, minute: 0 }, "Mars/Olympus_Mons"),
      );
      assert.strictEqual(timezoneError.reason, "validation");
    }),
  );

  it.effect("anchors ordinary advancement to the scheduled instant", () =>
    Effect.gen(function* () {
      const next = yield* nextAfterScheduled(
        { _tag: "hourly", minute: 15 },
        "UTC",
        "2026-09-09T10:15:00.000Z",
      );
      assert.strictEqual(Option.getOrNull(next), "2026-09-09T11:15:00.000Z");
    }),
  );

  it.effect("canonicalizes one-time occurrences to UTC", () =>
    Effect.gen(function* () {
      const next = yield* nextOccurrence(
        { _tag: "once", at: "2026-09-09T09:00:00.000+05:30" },
        "Asia/Kolkata",
        "2026-09-09T03:00:00.000Z",
      );
      assert.strictEqual(Option.getOrNull(next), "2026-09-09T03:30:00.000Z");
    }),
  );

  it.effect("skips missed occurrences during downtime", () =>
    Effect.gen(function* () {
      const recurring = yield* advancePastNow(
        { _tag: "hourly", minute: 15 },
        "UTC",
        "2026-09-09T10:15:00.000Z",
        "2026-09-09T12:20:00.000Z",
      );
      assert.deepEqual(recurring, {
        missedAt: "2026-09-09T10:15:00.000Z",
        nextRunAt: "2026-09-09T13:15:00.000Z",
      });

      const once = yield* advancePastNow(
        { _tag: "once", at: "2026-09-09T10:15:00.000Z" },
        "UTC",
        "2026-09-09T10:15:00.000Z",
        "2026-09-09T12:20:00.000Z",
      );
      assert.deepEqual(once, {
        missedAt: "2026-09-09T10:15:00.000Z",
        nextRunAt: null,
      });
    }),
  );

  it.effect("uses the first valid wall-clock instant across DST transitions", () =>
    Effect.gen(function* () {
      const spring = yield* nextOccurrence(
        { _tag: "cron", expression: "30 2 * * *" },
        "Europe/Berlin",
        "2024-03-30T02:00:00.000Z",
      );
      assert.strictEqual(Option.getOrNull(spring), "2024-03-31T01:30:00.000Z");

      const fall = yield* nextOccurrence(
        { _tag: "cron", expression: "30 2 * * *" },
        "Europe/Berlin",
        "2024-10-26T02:00:00.000Z",
      );
      assert.strictEqual(Option.getOrNull(fall), "2024-10-27T00:30:00.000Z");
    }),
  );
});
