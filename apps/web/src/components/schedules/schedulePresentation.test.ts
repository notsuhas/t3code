import { ProjectId, ProviderInstanceId, ScheduledPromptId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  duplicateScheduledPrompt,
  formatScheduleNextRun,
  requiresUnattendedAccessWarning,
  scheduleRunPresentation,
} from "./schedulePresentation";

const schedule = {
  id: ScheduledPromptId.make("schedule-1"),
  name: "Daily review",
  description: null,
  enabled: true,
  timezone: "UTC",
  recurrence: { _tag: "daily", hour: 9, minute: 0 },
  nextRunAt: "2026-01-02T09:00:00.000Z",
  activeRunId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectId: ProjectId.make("project-1"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  workspace: { _tag: "project" },
  lastRun: null,
} as const;

describe("schedule presentation", () => {
  it("formats disabled, overdue, and future occurrences", () => {
    expect(formatScheduleNextRun({ ...schedule, enabled: false })).toBe("Paused");
    expect(formatScheduleNextRun(schedule, Date.parse("2026-01-03T00:00:00.000Z"))).toBe("Due now");
    expect(formatScheduleNextRun(schedule, Date.parse("2026-01-01T00:00:00.000Z"))).toContain(
      "Jan 2",
    );
  });

  it("keeps every terminal outcome distinct", () => {
    expect(scheduleRunPresentation("succeeded").label).toBe("Completed");
    expect(scheduleRunPresentation("failed").tone).toBe("danger");
    expect(scheduleRunPresentation("skipped").label).toBe("Skipped");
    expect(scheduleRunPresentation("missed").label).toBe("Missed");
  });

  it("duplicates as a paused schedule and flags full access", () => {
    const duplicate = duplicateScheduledPrompt(schedule, "Continue the review");
    expect(duplicate.enabled).toBe(false);
    expect(duplicate.name).toBe("Daily review copy");
    expect(duplicate.action.prompt).toBe("Continue the review");
    expect(requiresUnattendedAccessWarning(duplicate.action.runtimeMode)).toBe(true);
  });
});
