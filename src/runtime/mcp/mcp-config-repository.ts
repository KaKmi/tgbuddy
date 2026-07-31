import type { McpServerConfig } from '../../shared/contracts/mcp.ts'

export interface McpConfigRepository {
  list(): McpServerConfig[]
  get(serverId: string): McpServerConfig | undefined
  save(config: McpServerConfig): McpServerConfig
  delete(serverId: string): void
}

export class MemoryMcpConfigRepository implements McpConfigRepository {
  readonly #configs = new Map<string, McpServerConfig>()

  list(): McpServerConfig[] {
    return [...this.#configs.values()]
  }

  get(serverId: string): McpServerConfig | undefined {
    return this.#configs.get(serverId)
  }

  save(config: McpServerConfig): McpServerConfig {
    this.#configs.set(config.id, config)
    return config
  }

  delete(serverId: string): void {
    this.#configs.delete(serverId)
  }
}
