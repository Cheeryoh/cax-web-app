-- CAX Web App — Postgres Schema (for Supabase)
-- Run this in the Supabase SQL Editor to initialize the database.

CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'candidate' CHECK(role IN ('candidate', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS environments (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL,
  codespace_id TEXT,
  codespace_name TEXT,
  codespace_url TEXT,
  status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating', 'ready', 'active', 'stopped', 'deleted', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  destroyed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS attempts (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'mc_completed', 'lab_active', 'submitted', 'evaluated')),
  environment_id INTEGER REFERENCES environments(id),
  human_reviewed INTEGER NOT NULL DEFAULT 0,
  final_result TEXT
);

CREATE TABLE IF NOT EXISTS mc_answers (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  question_id TEXT NOT NULL,
  selected_answer TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lab_results (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  task_id TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS fluency_scores (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  delegation REAL,
  description REAL,
  discernment REAL,
  diligence REAL,
  raw_analysis TEXT,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_reviews (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  reviewer_id INTEGER NOT NULL REFERENCES candidates(id),
  dimension TEXT NOT NULL CHECK(dimension IN ('delegation','description','discernment','diligence')),
  original_score REAL NOT NULL,
  adjusted_score REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  comment TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attempt_id, dimension)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_events (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  event_type TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_json TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attempts_candidate ON attempts(candidate_id);
CREATE INDEX IF NOT EXISTS idx_mc_answers_attempt ON mc_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_attempt ON lab_results(attempt_id);
CREATE INDEX IF NOT EXISTS idx_fluency_scores_attempt ON fluency_scores(attempt_id);
CREATE INDEX IF NOT EXISTS idx_environments_attempt ON environments(attempt_id);
CREATE INDEX IF NOT EXISTS idx_admin_reviews_attempt ON admin_reviews(attempt_id);
CREATE INDEX IF NOT EXISTS idx_sessions_candidate ON sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_validation_events_attempt ON validation_events(attempt_id);
