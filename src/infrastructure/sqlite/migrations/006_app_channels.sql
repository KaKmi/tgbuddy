CREATE TABLE IF NOT EXISTS app_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic')),
  base_url TEXT NOT NULL,
  -- 密钥只存引用，明文在 SecretStore（safeStorage 加密 blob）
  secret_ref TEXT NOT NULL DEFAULT '',
  -- 模型列表以 JSON 序列化，字段结构与 ChannelModel 契约一致
  models_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
