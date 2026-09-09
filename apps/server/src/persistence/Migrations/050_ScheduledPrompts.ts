import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_prompts (
      schedule_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL,
      timezone TEXT NOT NULL,
      recurrence_json TEXT NOT NULL,
      action_json TEXT NOT NULL,
      next_run_at TEXT,
      active_run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS scheduled_prompts_due_idx
    ON scheduled_prompts (enabled, next_run_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_prompt_runs (
      run_id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      state TEXT NOT NULL,
      trigger TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      thread_id TEXT,
      reason TEXT,
      schedule_name TEXT NOT NULL,
      action_json TEXT NOT NULL,
      worktree_branch TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS scheduled_prompt_runs_history_idx
    ON scheduled_prompt_runs (schedule_id, scheduled_at DESC, run_id DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS scheduled_prompt_runs_state_idx
    ON scheduled_prompt_runs (state)
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS scheduled_prompt_runs_thread_idx
    ON scheduled_prompt_runs (thread_id) WHERE thread_id IS NOT NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_prompt_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL
    )
  `;
  yield* sql`
    INSERT OR IGNORE INTO scheduled_prompt_state (singleton, revision)
    VALUES (1, 0)
  `;
});
