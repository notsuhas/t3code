import type {
  ScheduledPromptCreateInput,
  ScheduledPromptRecurrence,
  ScheduledPromptRun,
  ScheduledPromptSummary,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const pad = (value: number) => String(value).padStart(2, "0");

export function formatScheduleOnceInput(at: string, timezone: string): string {
  return Option.match(DateTime.makeZoned(at, { timeZone: timezone }), {
    onNone: () => at.slice(0, 16),
    onSome: (zoned) => {
      const parts = DateTime.toParts(zoned);
      return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
    },
  });
}

export function parseScheduleOnceInput(value: string, timezone: string): string | null {
  return Option.match(
    DateTime.makeZoned(`${value}:00`, {
      timeZone: timezone,
      adjustForTimeZone: true,
      disambiguation: "compatible",
    }),
    {
      onNone: () => null,
      onSome: (zoned) => DateTime.formatIso(DateTime.toUtc(zoned)),
    },
  );
}

export function formatScheduleRecurrence(
  value: ScheduledPromptRecurrence,
  timezone?: string,
): string {
  const time =
    "hour" in value
      ? `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`
      : null;
  switch (value._tag) {
    case "once":
      return `Once · ${new Date(value.at).toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined)}`;
    case "hourly":
      return `Hourly · minute ${value.minute}`;
    case "daily":
      return `Daily · ${time}`;
    case "weekdays":
      return `Weekdays · ${time}`;
    case "weekly":
      return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][value.weekday]} · ${time}`;
    case "cron":
      return `Cron · ${value.expression}`;
  }
}

export function formatScheduleNextRun(
  schedule: Pick<ScheduledPromptSummary, "enabled" | "nextRunAt" | "timezone">,
  now = Date.now(),
): string {
  if (!schedule.enabled) return "Paused";
  if (schedule.nextRunAt === null) return "No next run";
  const timestamp = Date.parse(schedule.nextRunAt);
  if (timestamp <= now) return "Due now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: schedule.timezone,
    timeZoneName: "short",
  }).format(timestamp);
}

export const scheduleRunPresentation = (state: ScheduledPromptRun["state"]) => {
  switch (state) {
    case "succeeded":
      return { label: "Completed", tone: "success" } as const;
    case "failed":
      return { label: "Failed", tone: "danger" } as const;
    case "running":
      return { label: "Running", tone: "info" } as const;
    case "pending":
      return { label: "Starting", tone: "info" } as const;
    case "skipped":
      return { label: "Skipped", tone: "warning" } as const;
    case "missed":
      return { label: "Missed", tone: "neutral" } as const;
  }
};

export function duplicateScheduledPrompt(
  schedule: Pick<
    ScheduledPromptSummary,
    | "name"
    | "description"
    | "timezone"
    | "recurrence"
    | "projectId"
    | "modelSelection"
    | "runtimeMode"
    | "interactionMode"
    | "workspace"
  >,
  prompt: string,
): ScheduledPromptCreateInput {
  return {
    name: `${schedule.name} copy`,
    description: schedule.description,
    enabled: false,
    timezone: schedule.timezone,
    recurrence: schedule.recurrence,
    action: {
      _tag: "prompt",
      projectId: schedule.projectId,
      prompt,
      modelSelection: schedule.modelSelection,
      runtimeMode: schedule.runtimeMode,
      interactionMode: schedule.interactionMode,
      workspace: schedule.workspace,
    },
  };
}
