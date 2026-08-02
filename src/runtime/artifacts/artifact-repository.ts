import type { ArtifactRef } from '../../shared/contracts/artifact.ts'

/** Artifact 索引持久化端口：SQLite 存索引，工作区文件原地不动（A05）。 */
export interface ArtifactRepository {
  /** 同 (sessionId, path) 覆盖更新（同路径产物只留最新） */
  save(artifact: ArtifactRef): void
  bySession(sessionId: string): ArtifactRef[]
  count(sessionId: string): number
  deleteSession(sessionId: string): void
}

export class MemoryArtifactRepository implements ArtifactRepository {
  readonly #rows = new Map<string, ArtifactRef[]>()

  save(artifact: ArtifactRef): void {
    const key = artifact.sessionId
    const existing = this.#rows.get(key) ?? []
    const index = existing.findIndex((item) => item.path === artifact.path)
    const next = index === -1 ? [...existing, artifact] : [...existing]
    if (index !== -1) next[index] = artifact
    this.#rows.set(key, next)
  }

  bySession(sessionId: string): ArtifactRef[] {
    return [...(this.#rows.get(sessionId) ?? [])]
  }

  count(sessionId: string): number {
    return this.#rows.get(sessionId)?.length ?? 0
  }

  deleteSession(sessionId: string): void {
    this.#rows.delete(sessionId)
  }
}
