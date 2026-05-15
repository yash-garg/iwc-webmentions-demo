CREATE TABLE webmentions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL,
  target_path  TEXT NOT NULL,
  wm_property  TEXT,              -- like-of, in-reply-to, repost-of, bookmark-of, mention-of
  author_name  TEXT,
  author_photo TEXT,
  author_url   TEXT,
  content_html TEXT,
  content_text TEXT,
  published    TEXT,
  received_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, target_path)
);

CREATE INDEX idx_webmentions_target_path ON webmentions(target_path);
