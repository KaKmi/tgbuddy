import {
  decideLegacyImport,
  loadLegacySessionCandidates,
  type LegacyDiagnostic,
  type LegacyLoadFailure,
} from '../../infrastructure/sqlite/index.ts'
import {
  createPiLegacySessionImporter,
  type PiLegacyImportOutcome,
} from '../../kernel/pi/index.ts'
import type { SessionRepository } from '../../runtime/index.ts'

export interface ImportLegacySessionsOptions {
  legacyDataDir: string
  databasePath: string
  repository: SessionRepository
}

export interface LegacyMigrationReport {
  found: boolean
  outcomes: PiLegacyImportOutcome[]
  diagnostics: LegacyDiagnostic[]
  failures: LegacyLoadFailure[]
}

/**
 * 启动期一次性兼容导入。每个 Session 独立提交和诊断；
 * 某个坏文件或冲突不能阻塞其它会话，也不能阻塞应用启动。
 */
export async function importLegacySessions(
  options: ImportLegacySessionsOptions,
): Promise<LegacyMigrationReport> {
  const loaded = await loadLegacySessionCandidates(options.legacyDataDir)
  const report: LegacyMigrationReport = {
    found: loaded.found,
    outcomes: [],
    diagnostics: loaded.candidates.flatMap(
      (candidate) => candidate.mapped.diagnostics,
    ),
    failures: [...loaded.failures],
  }
  if (loaded.candidates.length === 0) return report

  let importer: ReturnType<typeof createPiLegacySessionImporter> | undefined
  try {
    importer = createPiLegacySessionImporter({
      databasePath: options.databasePath,
      cwd: options.legacyDataDir,
    })
    for (const candidate of loaded.candidates) {
      try {
        const existingCatalogSession = options.repository.get(candidate.meta.id)
        // title/status 可能已由 K03 bridge 更新；ID + 原始创建时间才是不会漂移的身份。
        if (
          existingCatalogSession
          && (
            existingCatalogSession.createdAt !== candidate.meta.createdAt
            || candidate.meta.createdAt !== candidate.parsed.header.createdAt
          )
        ) {
          report.failures.push({
            sessionId: candidate.meta.id,
            relativePath: candidate.parsed.relativePath,
            line: 0,
            category: 'conflict',
            code: 'CATALOG_ID_CONFLICT',
            reason: '同 ID catalog Session 的创建时间与 legacy 身份不一致',
          })
          continue
        }
        const outcome = await importer.importSession(
          {
            targetSessionId: candidate.meta.id,
            legacySessionId: candidate.meta.id,
            cwd: candidate.parsed.header.cwd,
            fingerprint: candidate.parsed.fingerprint,
            entryDigest: candidate.mapped.entryDigest,
            entries: candidate.mapped.entries,
            activeMessageIds: candidate.mapped.activeMessageIds,
          },
          decideLegacyImport,
        )
        if (!existingCatalogSession) {
          options.repository.create(candidate.meta)
        }
        report.outcomes.push(outcome)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const conflict =
          reason.includes('不属于本 importer')
          || reason.includes('拒绝覆盖')
        report.failures.push({
          sessionId: candidate.meta.id,
          relativePath: candidate.parsed.relativePath,
          line: 0,
          category: conflict ? 'conflict' : 'runtime',
          code: conflict ? 'HISTORY_ID_CONFLICT' : 'IMPORT_SESSION_FAILED',
          reason,
        })
      }
    }
  } catch (error) {
    report.failures.push({
      relativePath: 'sessions.json',
      line: 0,
      category: 'runtime',
      code: 'IMPORTER_INIT_FAILED',
      reason: `legacy importer 初始化失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  } finally {
    await importer?.dispose().catch((error: unknown) => {
      report.failures.push({
        relativePath: 'sessions.json',
        line: 0,
        category: 'runtime',
        code: 'IMPORTER_DISPOSE_FAILED',
        reason: `legacy importer 清理失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    })
  }
  return report
}
