import type {
  EnvironmentId,
  ScheduledPrompt,
  ScheduledPromptCreateInput,
  ScheduledPromptId,
  ScheduledPromptSummary,
} from "@t3tools/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  CalendarClockIcon,
  Clock3Icon,
  CopyIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { ScheduleEditor, createScheduleDraft } from "../components/schedules/ScheduleEditor";
import {
  duplicateScheduledPrompt,
  formatScheduleNextRun,
  formatScheduleRecurrence,
  scheduleRunPresentation,
} from "../components/schedules/schedulePresentation";
import { Badge } from "../components/ui/badge";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { useProjects } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { scheduledPromptEnvironment } from "../state/scheduledPrompts";
import { useAtomCommand } from "../state/use-atom-command";

export const Route = createFileRoute("/_chat/schedules")({
  component: SchedulesRoute,
});

type EditorState = {
  readonly id: ScheduledPromptId | null;
  readonly initial: ScheduledPromptCreateInput;
};

function SchedulesRoute() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const supported = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      environment.serverConfig?.environment.capabilities.scheduledPrompts === true,
  );
  const [chosenEnvironmentId, setChosenEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId =
    supported.find((entry) => entry.environmentId === chosenEnvironmentId)?.environmentId ??
    supported.find((entry) => entry.environmentId === primaryEnvironmentId)?.environmentId ??
    supported[0]?.environmentId ??
    null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="justify-between border-b border-border">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarClockIcon className="size-4 text-muted-foreground" />
            <span className="truncate text-sm font-medium">Scheduled prompts</span>
          </div>
          {supported.length > 1 ? (
            <select
              aria-label="Environment"
              className="h-8 max-w-52 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={environmentId ?? ""}
              onChange={(event) => setChosenEnvironmentId(event.target.value as EnvironmentId)}
            >
              {supported.map((environment) => (
                <option key={environment.environmentId} value={environment.environmentId}>
                  {environment.label}
                </option>
              ))}
            </select>
          ) : null}
        </WorkspacePageHeader>
        {environmentId === null ? (
          <UnsupportedState />
        ) : (
          <SchedulesWorkspace key={environmentId} environmentId={environmentId} />
        )}
      </div>
    </SidebarInset>
  );
}

function UnsupportedState() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>Schedules aren’t available</EmptyTitle>
        <EmptyDescription>
          Connect to an updated T3 Code environment to create and run scheduled prompts.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function SchedulesWorkspace({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const { environments } = useEnvironments();
  const providerEntries = deriveProviderInstanceEntries(
    environments.find((entry) => entry.environmentId === environmentId)?.serverConfig?.providers ??
      [],
  );
  const listQuery = useEnvironmentQuery(
    scheduledPromptEnvironment.list({ environmentId, input: {} }),
  );
  const schedules = listQuery.data?.schedules ?? [];
  const [selectedId, setSelectedId] = useState<ScheduledPromptId | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const selected = schedules.find((entry) => entry.id === selectedId) ?? schedules[0] ?? null;
  const create = useAtomCommand(scheduledPromptEnvironment.create);
  const update = useAtomCommand(scheduledPromptEnvironment.update);

  const beginCreate = () => {
    const initial = createScheduleDraft(projects, providerEntries);
    if (initial) setEditor({ id: null, initial });
  };
  const save = async (input: ScheduledPromptCreateInput) => {
    setSaving(true);
    const result = editor?.id
      ? await update({ environmentId, input: { id: editor.id, ...input } })
      : await create({ environmentId, input });
    setSaving(false);
    if (AsyncResult.isSuccess(result)) {
      setSelectedId(result.value.id);
      setEditor(null);
    }
  };

  if (editor) {
    return (
      <ScheduleEditor
        initialValue={editor.initial}
        projects={projects}
        providers={providerEntries}
        saving={saving}
        onCancel={() => setEditor(null)}
        onSave={(input) => void save(input)}
      />
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col border-b border-border md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="font-semibold tracking-tight">Schedules</h1>
            <p className="text-xs text-muted-foreground">{schedules.length} configured</p>
          </div>
          <Button
            disabled={projects.length === 0 || providerEntries.length === 0}
            size="sm"
            onClick={beginCreate}
          >
            <PlusIcon /> New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {listQuery.error ? (
            <div className="m-2 rounded-xl bg-destructive/8 p-4 text-sm text-destructive-foreground">
              <p>{listQuery.error}</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={listQuery.refresh}>
                <RefreshCwIcon /> Retry
              </Button>
            </div>
          ) : listQuery.isPending && schedules.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Loading schedules…
            </p>
          ) : schedules.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Clock3Icon className="mx-auto mb-3 size-6 text-muted-foreground" />
              <p className="font-medium">No scheduled prompts</p>
              <p className="mx-auto mt-1 max-w-64 text-sm leading-relaxed text-muted-foreground">
                Create one to start a fresh agent thread automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {schedules.map((schedule) => (
                <button
                  key={schedule.id}
                  className="w-full rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-accent"
                  data-selected={schedule.id === selected?.id}
                  onClick={() => setSelectedId(schedule.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{schedule.name}</span>
                    {schedule.activeRunId ? <Badge variant="info">Running</Badge> : null}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {formatScheduleNextRun(schedule)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="min-h-0 overflow-y-auto">
        {selected ? (
          <ScheduleDetail
            environmentId={environmentId}
            projectTitle={
              projects.find((project) => project.id === selected.projectId)?.title ??
              "Unknown project"
            }
            schedule={selected}
            onDeleted={() => setSelectedId(null)}
            onDuplicated={setSelectedId}
            onEdit={(detail) => {
              const initial = createScheduleDraft(projects, providerEntries, detail);
              if (initial) setEditor({ id: detail.id, initial });
            }}
          />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyTitle>Select a schedule</EmptyTitle>
              <EmptyDescription>
                Its pinned configuration and recent runs will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  );
}

function ScheduleDetail({
  environmentId,
  projectTitle,
  schedule,
  onDeleted,
  onDuplicated,
  onEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectTitle: string;
  readonly schedule: ScheduledPromptSummary;
  readonly onDeleted: () => void;
  readonly onDuplicated: (id: ScheduledPromptId) => void;
  readonly onEdit: (detail: ScheduledPrompt) => void;
}) {
  const detailQuery = useEnvironmentQuery(
    scheduledPromptEnvironment.get({ environmentId, input: { id: schedule.id } }),
  );
  const runsQuery = useEnvironmentQuery(
    scheduledPromptEnvironment.runs({ environmentId, input: { id: schedule.id, limit: 100 } }),
  );
  const runNow = useAtomCommand(scheduledPromptEnvironment.runNow);
  const setEnabled = useAtomCommand(scheduledPromptEnvironment.setEnabled);
  const deleteSchedule = useAtomCommand(scheduledPromptEnvironment.delete);
  const create = useAtomCommand(scheduledPromptEnvironment.create);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight">{schedule.name}</h2>
            <Badge variant={schedule.enabled ? "success" : "secondary"}>
              {schedule.enabled ? "Enabled" : "Paused"}
            </Badge>
          </div>
          {schedule.description ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {schedule.description}
            </p>
          ) : null}
        </div>
        <Menu>
          <MenuTrigger
            render={
              <Button aria-label="Schedule actions" size="icon" variant="ghost">
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <MenuPopup align="end">
            <MenuItem
              disabled={!detailQuery.data}
              onClick={() => detailQuery.data && onEdit(detailQuery.data)}
            >
              Edit
            </MenuItem>
            <MenuItem
              onClick={() =>
                void act(async () => {
                  if (!detailQuery.data) return;
                  const result = await create({
                    environmentId,
                    input: duplicateScheduledPrompt(schedule, detailQuery.data.action.prompt),
                  });
                  if (AsyncResult.isSuccess(result)) onDuplicated(result.value.id);
                })
              }
            >
              <CopyIcon /> Duplicate paused
            </MenuItem>
            <MenuItem className="text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2Icon /> Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{schedule.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the schedule. Its existing run history and threads are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              disabled={busy}
              variant="destructive"
              onClick={() =>
                void act(async () => {
                  const result = await deleteSchedule({
                    environmentId,
                    input: { id: schedule.id },
                  });
                  if (AsyncResult.isSuccess(result)) {
                    setDeleteOpen(false);
                    onDeleted();
                  }
                })
              }
            >
              Delete schedule
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          disabled={busy || schedule.activeRunId !== null}
          size="sm"
          onClick={() => void act(() => runNow({ environmentId, input: { id: schedule.id } }))}
        >
          <PlayIcon /> Run now
        </Button>
        <Button
          disabled={busy}
          size="sm"
          variant="outline"
          onClick={() =>
            void act(() =>
              setEnabled({ environmentId, input: { id: schedule.id, enabled: !schedule.enabled } }),
            )
          }
        >
          {schedule.enabled ? <PauseIcon /> : <PlayIcon />}
          {schedule.enabled ? "Pause" : "Enable"}
        </Button>
      </div>

      <dl className="mt-8 grid gap-x-8 gap-y-5 border-y border-border py-5 sm:grid-cols-2">
        <Datum label="Next run" value={formatScheduleNextRun(schedule)} />
        <Datum
          label="Recurrence"
          value={formatScheduleRecurrence(schedule.recurrence, schedule.timezone)}
        />
        <Datum label="Project" value={projectTitle} />
        <Datum label="Timezone" value={schedule.timezone} />
        <Datum
          label="Model"
          value={`${schedule.modelSelection.instanceId} · ${schedule.modelSelection.model}`}
        />
        <Datum
          label="Workspace"
          value={
            schedule.workspace._tag === "project"
              ? "Project root"
              : `Fresh worktree · ${schedule.workspace.baseBranch}`
          }
        />
        <Datum label="Access" value={schedule.runtimeMode.replaceAll("-", " ")} />
        <Datum label="Interaction" value={schedule.interactionMode} />
      </dl>

      {detailQuery.data ? (
        <section className="mt-7">
          <h3 className="text-sm font-semibold">Prompt</h3>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/55 p-4 font-sans text-sm leading-relaxed">
            {detailQuery.data.action.prompt}
          </pre>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">Run history</h3>
          <span className="text-xs text-muted-foreground">Latest 100</span>
        </div>
        <div className="mt-3 divide-y divide-border border-y border-border">
          {(runsQuery.data?.runs ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            (runsQuery.data?.runs ?? []).map((run) => {
              const presentation = scheduleRunPresentation(run.state);
              return (
                <div key={run.id} className="flex items-center gap-3 py-3 text-sm">
                  <span
                    className="size-2 shrink-0 rounded-full bg-current text-muted-foreground data-[tone=success]:text-success data-[tone=danger]:text-destructive data-[tone=info]:text-info data-[tone=warning]:text-warning"
                    data-tone={presentation.tone}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-medium">{presentation.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(run.scheduledAt).toLocaleString()}
                      </span>
                    </div>
                    {run.reason ? (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{run.reason}</p>
                    ) : null}
                  </div>
                  {run.threadId ? (
                    <Button
                      render={
                        <Link
                          to="/$environmentId/$threadId"
                          params={{ environmentId, threadId: run.threadId }}
                        />
                      }
                      size="sm"
                      variant="ghost"
                    >
                      Open thread
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function Datum({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm capitalize">{value}</dd>
    </div>
  );
}
