Story 1: "固定依赖并完成 legacy 纯解析与映射" — complete
  Commits: 2dc1639, 81b82b9, 86786dd, 78842df, 9f02324
  Files: package.json, bun.lock, scripts/sqlite-spike-import.ts, tests/sqlite-spike.test.ts, tests/fixtures/legacy-sessions.json, tests/fixtures/legacy-session.jsonl
  Produces: parseLegacySession(input: LegacyParseInput): LegacyParseResult; mapLegacyEntries(parsed: LegacyParseResult): LegacyMapResult; decideLegacyImport(existing, expected): LegacyImportDecision; legacyReplayMessageIds(parsed): string[]; canonicalJson(value: unknown): string
  Concerns: none

Story 2: "生成真正 packaged 的无窗口 Electron runtime" — complete
  Commits: 3da367c, 5f0b89d
  Files: package.json, scripts/sqlite-spike.ts, scripts/sqlite-spike-main.ts, scripts/sqlite-spike-runtime.ts, scripts/sqlite-spike-scenarios.ts, tests/sqlite-spike.test.ts
  Produces: packageAndRunSpike(options: SpikeLaunchOptions): Promise<SpikeLaunchResult>; assertPackagedRuntime(snapshot: RuntimeSnapshot): void; resolvePackagedExecutable(outputDir, platform): string; createSpikeRepo(databasePath, cwd): SpikeRepoContext; cleanupSession(session): Promise<void>; runRuntimeScenario(context): Promise<ScenarioResult>; runBootstrapScenario(context): Promise<ScenarioResult>
  Concerns: none

Story 3: "验证 SQLite 会话持久化、隔离、compaction、删除和 WAL 备份" — complete
  Commits: 4ae180f, deab4ce
  Files: scripts/sqlite-spike-main.ts, scripts/sqlite-spike-scenarios.ts, tests/sqlite-spike.test.ts
  Produces: assertContinuousPrefix(entries, expectedPrefix, minimum, maximum): void; validateCheckpointResult(row): void; checkpointAndBackup(sourcePath, backupPath): Promise<CheckpointResult>; runStorageScenarios(context): Promise<ScenarioResult[]>
  Concerns: none

Story 4: "验证 packaged child 强杀恢复" — complete
  Commits: b8ed16f
  Files: scripts/sqlite-spike-main.ts, scripts/sqlite-spike-scenarios.ts
  Produces: runCrashChild(options: CrashChildOptions): Promise<never>; runCrashRecoveryScenario(context: ScenarioContext): Promise<ScenarioResult>
  Concerns: none

Story 5: "验证 SQLite legacy 幂等导入" — complete
  Commits: 4137da1
  Files: scripts/sqlite-spike.ts, scripts/sqlite-spike-main.ts, scripts/sqlite-spike-scenarios.ts, scripts/sqlite-spike-import.ts
  Produces: importLegacySession(repo, parsed): Promise<LegacyImportOutcome>; legacySqliteSessionId(sessionId): string; runLegacyImportScenario(context): Promise<ScenarioResult>
  Concerns: none

Story 6: "汇总完整报告、证据和回归质量门" — complete
  Commits: 62f4213, fc8a3d1
  Files: scripts/sqlite-spike.ts, scripts/sqlite-spike-main.ts, scripts/sqlite-spike-runtime.ts, scripts/sqlite-spike-scenarios.ts, tests/sqlite-spike.test.ts, .ship/tasks/sqlite-packaged-electron-spike/evidence/README.md
  Produces: REQUIRED_SCENARIOS; assertCompleteSpikeReport(report): void; renderEvidence(report): string; full packaged scenario in strict execution order
  Concerns: none
