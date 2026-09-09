import type { ScheduledPromptRecurrence } from "@t3tools/contracts";

import { Input } from "../ui/input";
import { formatScheduleOnceInput, parseScheduleOnceInput } from "./schedulePresentation";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20";

export function ScheduleRecurrenceFields({
  timezone,
  value,
  onChange,
}: {
  readonly timezone: string;
  readonly value: ScheduledPromptRecurrence;
  readonly onChange: (value: ScheduledPromptRecurrence) => void;
}) {
  const changeKind = (kind: ScheduledPromptRecurrence["_tag"]) => {
    switch (kind) {
      case "once":
        onChange({ _tag: "once", at: new Date(Date.now() + 3_600_000).toISOString() });
        break;
      case "hourly":
        onChange({ _tag: "hourly", minute: 0 });
        break;
      case "daily":
        onChange({ _tag: "daily", hour: 9, minute: 0 });
        break;
      case "weekdays":
        onChange({ _tag: "weekdays", hour: 9, minute: 0 });
        break;
      case "weekly":
        onChange({ _tag: "weekly", weekday: 1, hour: 9, minute: 0 });
        break;
      case "cron":
        onChange({ _tag: "cron", expression: "0 9 * * 1-5" });
        break;
    }
  };
  const time =
    "hour" in value
      ? `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`
      : "09:00";
  const setTime = (next: string) => {
    if (!("hour" in value)) return;
    const [hour, minute] = next.split(":").map(Number);
    onChange({ ...value, hour: hour ?? 0, minute: minute ?? 0 });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Repeats</span>
        <select
          className={selectClass}
          value={value._tag}
          onChange={(event) => changeKind(event.target.value as ScheduledPromptRecurrence["_tag"])}
        >
          <option value="once">Once</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekly">Weekly</option>
          <option value="cron">Cron expression</option>
        </select>
      </label>
      {value._tag === "once" ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Run at</span>
          <Input
            nativeInput
            type="datetime-local"
            value={formatScheduleOnceInput(value.at, timezone)}
            onChange={(event) => {
              const at = parseScheduleOnceInput(event.target.value, timezone);
              if (at !== null) onChange({ _tag: "once", at });
            }}
          />
        </label>
      ) : value._tag === "hourly" ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Minute</span>
          <Input
            nativeInput
            max={59}
            min={0}
            type="number"
            value={value.minute}
            onChange={(event) => onChange({ ...value, minute: Number(event.target.value) })}
          />
        </label>
      ) : value._tag === "cron" ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Five-field cron</span>
          <Input
            nativeInput
            value={value.expression}
            onChange={(event) => onChange({ ...value, expression: event.target.value })}
          />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {value._tag === "weekly" ? (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Day</span>
              <select
                className={selectClass}
                value={value.weekday}
                onChange={(event) => onChange({ ...value, weekday: Number(event.target.value) })}
              >
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Time</span>
            <Input
              nativeInput
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
