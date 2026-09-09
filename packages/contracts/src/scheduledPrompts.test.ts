import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ScheduledPrompt,
  ScheduledPromptCreateInput,
  ScheduledPromptListResult,
  ScheduledPromptRunListResult,
} from "./scheduledPrompts.ts";

const modelSelection = {
  instanceId: "instance-1",
  model: "gpt-5.6-sol",
  options: [{ id: "effort", value: "high" }],
};

const action = {
  _tag: "prompt" as const,
  projectId: "project-1",
  prompt: "Check the backups and fix anything broken.",
  modelSelection,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  workspace: {
    _tag: "worktree" as const,
    baseBranch: "main",
    startFromOrigin: true,
    runSetupScript: true,
  },
};

describe("ScheduledPrompt contracts", () => {
  it.each([
    { _tag: "once", at: "2026-09-10T04:30:00.000Z" },
    { _tag: "hourly", minute: 15 },
    { _tag: "daily", hour: 9, minute: 30 },
    { _tag: "weekdays", hour: 8, minute: 0 },
    { _tag: "weekly", weekday: 1, hour: 10, minute: 45 },
    { _tag: "cron", expression: "0 4 * * 1-5" },
  ])("decodes the $_tag recurrence", (recurrence) => {
    const decoded = Schema.decodeUnknownSync(ScheduledPromptCreateInput)({
      name: "Morning maintenance",
      description: null,
      enabled: true,
      timezone: "Asia/Kolkata",
      recurrence,
      action,
    });

    expect(decoded.recurrence).toEqual(recurrence);
    expect(decoded.action).toEqual(action);
  });

  it.each([
    { recurrence: { _tag: "hourly", minute: 60 } },
    { recurrence: { _tag: "daily", hour: 24, minute: 0 } },
    { recurrence: { _tag: "weekly", weekday: 7, hour: 9, minute: 0 } },
    { recurrence: { _tag: "unknown" } },
    { name: "   " },
    { action: { ...action, prompt: "   " } },
  ])("rejects malformed schedule input %#", (override) => {
    expect(() =>
      Schema.decodeUnknownSync(ScheduledPromptCreateInput)({
        name: "Maintenance",
        description: null,
        enabled: true,
        timezone: "UTC",
        recurrence: { _tag: "daily", hour: 9, minute: 0 },
        action,
        ...override,
      }),
    ).toThrow();
  });

  it("keeps the full prompt on the single-schedule detail", () => {
    const decoded = Schema.decodeUnknownSync(ScheduledPrompt)({
      id: "schedule-1",
      name: "Maintenance",
      description: null,
      enabled: true,
      timezone: "UTC",
      recurrence: { _tag: "daily", hour: 9, minute: 0 },
      action,
      nextRunAt: "2026-09-10T09:00:00.000Z",
      activeRunId: null,
      createdAt: "2026-09-09T09:00:00.000Z",
      updatedAt: "2026-09-09T09:00:00.000Z",
    });

    expect(decoded.action.prompt).toBe(action.prompt);
  });

  it("does not allow prompts or internal execution identifiers in list and history payloads", () => {
    const summary = {
      id: "schedule-1",
      name: "Maintenance",
      description: null,
      enabled: true,
      timezone: "UTC",
      recurrence: { _tag: "daily" as const, hour: 9, minute: 0 },
      nextRunAt: "2026-09-10T09:00:00.000Z",
      activeRunId: null,
      projectId: "project-1",
      modelSelection,
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      workspace: action.workspace,
      createdAt: "2026-09-09T09:00:00.000Z",
      updatedAt: "2026-09-09T09:00:00.000Z",
      lastRun: null,
    };
    const run = {
      id: "run-1",
      scheduleId: "schedule-1",
      trigger: "scheduled" as const,
      state: "succeeded" as const,
      scheduledAt: "2026-09-09T09:00:00.000Z",
      startedAt: "2026-09-09T09:00:01.000Z",
      finishedAt: "2026-09-09T09:02:00.000Z",
      threadId: "thread-1",
      reason: null,
    };

    const list = Schema.decodeUnknownSync(ScheduledPromptListResult)({ schedules: [summary] });
    const history = Schema.decodeUnknownSync(ScheduledPromptRunListResult)({
      runs: Array.from({ length: 100 }, (_, index) => ({ ...run, id: `run-${index}` })),
    });
    const wire = JSON.stringify({ list, history });

    expect(wire).not.toContain(action.prompt);
    expect(wire).not.toContain("commandId");
    expect(wire).not.toContain("messageId");
    expect(wire).not.toContain("worktreeBranch");
  });
});
