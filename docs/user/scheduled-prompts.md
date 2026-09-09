# Scheduled prompts

Scheduled prompts start recurring agent work without requiring an open client. Open **Scheduled prompts** from the web or desktop sidebar, or search for it in the command palette. Choose the environment and create a schedule with its project, provider, model, access mode, prompt, timezone, and recurrence pinned explicitly.

Each occurrence creates a fresh thread. A schedule can run in the project root or in a fresh worktree based on a chosen branch. Worktree schedules can fetch from the remote and run the project setup script before sending the prompt.

## Running unattended

The environment’s T3 Code server owns the timer and must be running when an occurrence is due. An occurrence missed while the server is offline is recorded as missed and skipped; T3 Code does not replay a backlog. If the previous run is still active, the next occurrence is recorded as skipped. Failed runs are recorded without automatic retries.

Full access lets the agent change files and run commands without pausing for approval. Review the prompt, project, branch, and provider before enabling it.

Use **Run now** to test the pinned configuration. Pause a schedule to keep it without future executions. Run history keeps the latest 100 outcomes and links to threads created by the schedule.

On mobile, open **Settings → Scheduled Prompts** to review schedules, run one immediately, pause or enable it, open its latest thread, or delete it. Create and edit schedules on web or desktop.
