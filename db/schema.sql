CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  attempt INTEGER NOT NULL DEFAULT 1,
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  workflow_run_id BIGINT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  current_phase TEXT NOT NULL,
  current_agent TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  summary TEXT,
  branch_name TEXT,
  pr_url TEXT,
  diff_summary TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_specs (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS task_graphs (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_assignments (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS diff_candidates (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  patch TEXT NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_gates (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eval_results (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  phase TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);
CREATE INDEX IF NOT EXISTS audit_events_job_id_idx ON audit_events(job_id, created_at DESC);
