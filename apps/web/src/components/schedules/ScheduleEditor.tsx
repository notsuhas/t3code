import type {
  ProviderInteractionMode,
  RuntimeMode,
  ScheduledPrompt,
  ScheduledPromptCreateInput,
} from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";
import { AlertTriangleIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { ScheduleRecurrenceFields } from "./ScheduleRecurrenceFields";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20";

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function createScheduleDraft(
  projects: ReadonlyArray<EnvironmentProject>,
  providers: ReadonlyArray<ProviderInstanceEntry>,
  schedule?: ScheduledPrompt,
): ScheduledPromptCreateInput | null {
  if (schedule) {
    return {
      name: schedule.name,
      description: schedule.description,
      enabled: schedule.enabled,
      timezone: schedule.timezone,
      recurrence: schedule.recurrence,
      action: schedule.action,
    };
  }
  const project = projects[0];
  const provider = providers.find((entry) => entry.enabled && entry.models.length > 0);
  const model = provider?.models.find((entry) => entry.isDefault) ?? provider?.models[0];
  const modelSelection =
    project?.defaultModelSelection ??
    (provider && model ? { instanceId: provider.instanceId, model: model.slug } : null);
  if (!project || !modelSelection) return null;
  return {
    name: "",
    description: null,
    enabled: true,
    timezone: localTimezone,
    recurrence: { _tag: "daily", hour: 9, minute: 0 },
    action: {
      _tag: "prompt",
      projectId: project.id,
      prompt: "",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      workspace: { _tag: "project" },
    },
  };
}

export function ScheduleEditor({
  initialValue,
  projects,
  providers,
  saving,
  onCancel,
  onSave,
}: {
  readonly initialValue: ScheduledPromptCreateInput;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly providers: ReadonlyArray<ProviderInstanceEntry>;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onSave: (input: ScheduledPromptCreateInput) => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  const activeProvider = providers.find(
    (entry) => entry.instanceId === draft.action.modelSelection.instanceId,
  );
  const timezones = useMemo(() => {
    const values =
      "supportedValuesOf" in Intl ? Intl.supportedValuesOf("timeZone") : ["UTC", localTimezone];
    return Array.from(new Set([draft.timezone, localTimezone, "UTC", ...values]));
  }, [draft.timezone]);
  const valid =
    draft.name.trim().length > 0 &&
    draft.action.prompt.trim().length > 0 &&
    draft.action.modelSelection.model.trim().length > 0;
  const worktree = draft.action.workspace._tag === "worktree" ? draft.action.workspace : null;

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave(draft);
      }}
    >
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-7">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Schedule details</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every occurrence starts a fresh thread in the pinned project and environment.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              nativeInput
              autoFocus
              maxLength={200}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Timezone">
            <select
              className={selectClass}
              value={draft.timezone}
              onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
            >
              {timezones.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Description" optional>
          <Input
            nativeInput
            maxLength={2_000}
            value={draft.description ?? ""}
            onChange={(event) => setDraft({ ...draft, description: event.target.value || null })}
          />
        </Field>

        <ScheduleRecurrenceFields
          value={draft.recurrence}
          onChange={(recurrence) => setDraft({ ...draft, recurrence })}
        />

        <Field label="Prompt">
          <Textarea
            required
            className="min-h-36"
            placeholder="Describe the work this schedule should perform…"
            value={draft.action.prompt}
            onChange={(event) =>
              setDraft({ ...draft, action: { ...draft.action, prompt: event.target.value } })
            }
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project">
            <select
              className={selectClass}
              value={draft.action.projectId}
              onChange={(event) => {
                const project = projects.find((entry) => entry.id === event.target.value);
                setDraft({
                  ...draft,
                  action: {
                    ...draft.action,
                    projectId: project?.id ?? draft.action.projectId,
                    modelSelection: project?.defaultModelSelection ?? draft.action.modelSelection,
                  },
                });
              }}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Provider">
            <select
              className={selectClass}
              value={draft.action.modelSelection.instanceId}
              onChange={(event) => {
                const provider = providers.find((entry) => entry.instanceId === event.target.value);
                const model =
                  provider?.models.find((entry) => entry.isDefault) ?? provider?.models[0];
                if (!provider || !model) return;
                setDraft({
                  ...draft,
                  action: {
                    ...draft.action,
                    modelSelection: {
                      instanceId: ProviderInstanceId.make(provider.instanceId),
                      model: model.slug,
                    },
                  },
                });
              }}
            >
              {providers
                .filter((entry) => entry.enabled)
                .map((provider) => (
                  <option key={provider.instanceId} value={provider.instanceId}>
                    {provider.displayName}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Model">
            <select
              className={selectClass}
              value={draft.action.modelSelection.model}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  action: {
                    ...draft.action,
                    modelSelection: {
                      instanceId: draft.action.modelSelection.instanceId,
                      model: event.target.value,
                    },
                  },
                })
              }
            >
              {activeProvider?.models.map((model) => (
                <option key={model.slug} value={model.slug}>
                  {model.name}
                </option>
              ))}
              {!activeProvider?.models.some(
                (model) => model.slug === draft.action.modelSelection.model,
              ) ? (
                <option value={draft.action.modelSelection.model}>
                  {draft.action.modelSelection.model}
                </option>
              ) : null}
            </select>
          </Field>
          <Field label="Interaction">
            <select
              className={selectClass}
              value={draft.action.interactionMode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  action: {
                    ...draft.action,
                    interactionMode: event.target.value as ProviderInteractionMode,
                  },
                })
              }
            >
              <option value="default">Default</option>
              <option value="plan">Plan</option>
            </select>
          </Field>
          <Field label="Access">
            <select
              className={selectClass}
              value={draft.action.runtimeMode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  action: { ...draft.action, runtimeMode: event.target.value as RuntimeMode },
                })
              }
            >
              <option value="approval-required">Require approval</option>
              <option value="auto-accept-edits">Auto-accept edits</option>
              <option value="auto">Automatic</option>
              <option value="full-access">Full access</option>
            </select>
          </Field>
          <Field label="Workspace">
            <select
              className={selectClass}
              value={draft.action.workspace._tag}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  action: {
                    ...draft.action,
                    workspace:
                      event.target.value === "worktree"
                        ? {
                            _tag: "worktree",
                            baseBranch: "main",
                            startFromOrigin: true,
                            runSetupScript: true,
                          }
                        : { _tag: "project" },
                  },
                })
              }
            >
              <option value="project">Project root</option>
              <option value="worktree">Fresh worktree</option>
            </select>
          </Field>
        </div>

        {worktree ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base branch">
              <Input
                nativeInput
                value={worktree.baseBranch}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    action: {
                      ...draft.action,
                      workspace: { ...worktree, baseBranch: event.target.value },
                    },
                  })
                }
              />
            </Field>
            <div className="space-y-3 pt-1 sm:pt-6">
              <Toggle
                label="Start from origin"
                checked={worktree.startFromOrigin}
                onChange={(startFromOrigin) =>
                  setDraft({
                    ...draft,
                    action: { ...draft.action, workspace: { ...worktree, startFromOrigin } },
                  })
                }
              />
              <Toggle
                label="Run setup script"
                checked={worktree.runSetupScript}
                onChange={(runSetupScript) =>
                  setDraft({
                    ...draft,
                    action: { ...draft.action, workspace: { ...worktree, runSetupScript } },
                  })
                }
              />
            </div>
          </div>
        ) : null}

        {draft.action.runtimeMode === "full-access" ? (
          <div className="flex gap-3 rounded-xl bg-warning/10 px-4 py-3 text-warning-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <p className="text-sm leading-relaxed">
              Full access runs unattended and can change files or execute commands without asking
              for approval. Review the prompt and pinned workspace carefully.
            </p>
          </div>
        ) : null}

        <Toggle
          label="Enabled"
          checked={draft.enabled}
          onChange={(enabled) => setDraft({ ...draft, enabled })}
        />
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3 sm:px-7">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!valid || saving} type="submit">
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  optional,
  children,
}: {
  readonly label: string;
  readonly optional?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">
        {label}
        {optional ? <span className="ml-1 font-normal text-muted-foreground">optional</span> : null}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
