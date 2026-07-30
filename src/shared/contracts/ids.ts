/**
 * 跨进程 ID 使用语义别名，序列化形状仍保持 string。
 * 后续 Repository 可逐步收紧创建入口，不在 compatibility 阶段引入运行时包装。
 */
export type WorkspaceId = string
export type SessionId = string
export type RootRunId = string
export type AgentRunId = string
export type ArtifactId = string
export type CapabilityId = string
