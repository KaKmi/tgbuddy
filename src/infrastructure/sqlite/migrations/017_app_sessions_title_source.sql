ALTER TABLE app_sessions
ADD COLUMN title_source TEXT NOT NULL DEFAULT 'default'
CHECK (title_source IN ('default', 'generated', 'user'));

UPDATE app_sessions
SET title_source = CASE
  WHEN title = '新会话' THEN 'default'
  ELSE 'user'
END;
