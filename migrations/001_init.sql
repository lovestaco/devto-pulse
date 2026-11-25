CREATE TABLE IF NOT EXISTS sync_runs (
  id             BIGSERIAL PRIMARY KEY,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'running',  -- running | ok | error
  articles_count INT,
  error          TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  id           BIGINT PRIMARY KEY,               -- dev.to article id
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  tags         TEXT[] NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per article per successful sync: this is the history dev.to's API doesn't keep.
CREATE TABLE IF NOT EXISTS article_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  sync_run_id BIGINT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  views       INT NOT NULL,
  reactions   INT NOT NULL,
  comments    INT NOT NULL
);

CREATE INDEX IF NOT EXISTS article_snapshots_article_taken_idx
  ON article_snapshots (article_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS article_snapshots_run_idx
  ON article_snapshots (sync_run_id);
