-- Codeplus schema (PostgreSQL 14+). Applied by `npm run migrate`; idempotent.

CREATE TABLE IF NOT EXISTS problems (
  id            serial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  title         text NOT NULL,
  difficulty    text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  problem_type  text NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',
  statement     text NOT NULL,
  limits        jsonb NOT NULL,        -- {"timeMs":{"cpp":..,"c":..,"python":..},"memoryMb":..}
  starter_code  jsonb NOT NULL DEFAULT '{}',
  version       integer NOT NULL DEFAULT 1,  -- bumped on every re-upload; judge caches by it
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Two representations per test: `input` is the raw, newline-normalised stdin
-- the sandbox gets; `display_input` is what the problem page shows.
CREATE TABLE IF NOT EXISTS test_cases (
  id               serial PRIMARY KEY,
  problem_id       integer NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  ordinal          integer NOT NULL,
  input            text NOT NULL,
  display_input    text NOT NULL,
  expected_output  text NOT NULL,
  is_sample        boolean NOT NULL DEFAULT false,
  explanation      text,
  UNIQUE (problem_id, ordinal)
);

CREATE TABLE IF NOT EXISTS submissions (
  id           uuid PRIMARY KEY,
  problem_id   integer NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  client_id    text NOT NULL,
  language     text NOT NULL,
  code         text NOT NULL,
  mode         text NOT NULL CHECK (mode IN ('run', 'submit')),
  status       text NOT NULL DEFAULT 'queued',   -- queued | running | done
  verdict      text,
  passed       integer,
  total        integer,
  time_ms      double precision,
  memory_kb    integer,
  result       jsonb,                             -- the final "completed" event
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE INDEX IF NOT EXISTS submissions_client_problem
  ON submissions (client_id, problem_id, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_problem_verdict
  ON submissions (problem_id, mode, verdict);
