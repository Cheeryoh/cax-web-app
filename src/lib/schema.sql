-- CAX Web App Database Schema

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'candidate' CHECK(role IN ('candidate', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'mc_completed', 'lab_active', 'submitted', 'evaluated')),
  environment_id INTEGER REFERENCES environments(id)
);

CREATE TABLE IF NOT EXISTS mc_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  question_id TEXT NOT NULL,
  selected_answer TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lab_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  task_id TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS fluency_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  delegation REAL,
  description REAL,
  discernment REAL,
  diligence REAL,
  raw_analysis TEXT,
  scored_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS environments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  codespace_id TEXT,
  codespace_url TEXT,
  status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating', 'ready', 'active', 'stopped', 'deleted', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  destroyed_at TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attempts_candidate ON attempts(candidate_id);
CREATE INDEX IF NOT EXISTS idx_mc_answers_attempt ON mc_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_attempt ON lab_results(attempt_id);
CREATE INDEX IF NOT EXISTS idx_fluency_scores_attempt ON fluency_scores(attempt_id);
CREATE INDEX IF NOT EXISTS idx_environments_attempt ON environments(attempt_id);

CREATE TABLE IF NOT EXISTS admin_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  reviewer_id INTEGER NOT NULL REFERENCES candidates(id),
  dimension TEXT NOT NULL CHECK(dimension IN ('delegation','description','discernment','diligence')),
  original_score REAL NOT NULL,
  adjusted_score REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  comment TEXT,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(attempt_id, dimension)
);
CREATE INDEX IF NOT EXISTS idx_admin_reviews_attempt ON admin_reviews(attempt_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_candidate ON sessions(candidate_id);
