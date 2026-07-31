CREATE TABLE IF NOT EXISTS app_attachments (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  blob_hash TEXT NOT NULL,
  blob_size INTEGER NOT NULL,
  blob_mime TEXT,
  PRIMARY KEY (session_id, message_id, attachment_id)
);
