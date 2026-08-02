CREATE TABLE IF NOT EXISTS app_blob_refs (
  blob_hash TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_key TEXT NOT NULL,
  PRIMARY KEY (blob_hash, ref_type, ref_key)
);
