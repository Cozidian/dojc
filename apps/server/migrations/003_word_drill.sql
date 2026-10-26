CREATE TABLE sessions_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  language_id TEXT NOT NULL REFERENCES languages(id),
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  geometry_id TEXT NOT NULL REFERENCES geometries(id),
  mode TEXT NOT NULL CHECK (mode IN ('words', 'time', 'drill')),
  mode_value INTEGER NOT NULL,
  drill_kind TEXT CHECK (drill_kind IN ('bigram', 'finger', 'letter', 'word')),
  drill_target TEXT,
  correction_policy TEXT NOT NULL CHECK (correction_policy IN ('must_fix')),
  seed TEXT NOT NULL,
  wordlist_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  target_text TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  wpm REAL NOT NULL,
  raw_wpm REAL NOT NULL,
  accuracy REAL NOT NULL,
  consistency REAL,
  correct_chars INTEGER NOT NULL,
  incorrect_chars INTEGER NOT NULL,
  extra_chars INTEGER NOT NULL,
  backspaces INTEGER NOT NULL,
  CHECK (
    (mode = 'drill' AND drill_kind IS NOT NULL AND drill_target IS NOT NULL)
    OR (mode <> 'drill' AND drill_kind IS NULL AND drill_target IS NULL)
  )
);

INSERT INTO sessions_next SELECT * FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_next RENAME TO sessions;

CREATE INDEX sessions_coaching
  ON sessions (user_id, layout_id, language_id, completed, started_at);
