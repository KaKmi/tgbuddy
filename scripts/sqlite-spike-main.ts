import { app } from 'electron'
import { DatabaseSync, backup } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertPackagedRuntime,
  REQUIRED_SCENARIOS,
  type RuntimeSnapshot,
  type ScenarioResult,
  type SpikeReport,
} from './sqlite-spike-runtime.ts'
import {
  runBootstrapScenario,
  runCrashChild,
  runCrashRecoveryScenario,
  runLegacyImportScenario,
  runRuntimeScenario,
  runStorageScenarios,
  type CrashChildOptions,
  type ScenarioContext,
} from './sqlite-spike-scenarios.ts'

interface MainArguments {
  spikeRoot: string
  reportPath: string
  scenario: 'runtime' | 'storage' | 'crash' | 'legacy' | 'full'
  childMode?: string
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function parseArguments(): MainArguments {
  const spikeRoot = argumentValue('--spike-root')
  const reportPath = argumentValue('--report')
  const scenario = argumentValue('--scenario') ?? 'full'
  if (!spikeRoot) throw new Error('缺少 --spike-root')
  if (!reportPath) throw new Error('缺少 --report')
  if (!['runtime', 'storage', 'crash', 'legacy', 'full'].includes(scenario)) {
    throw new Error(`未知 scenario: ${scenario}`)
  }
  return {
    spikeRoot,
    reportPath,
    scenario: scenario as MainArguments['scenario'],
    childMode: argumentValue('--child-mode'),
  }
}

function requiredArgument(name: string): string {
  const value = argumentValue(name)
  if (!value) throw new Error(`缺少 ${name}`)
  return value
}

function positiveIntegerArgument(name: string): number {
  const value = Number(requiredArgument(name))
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} 必须为正整数`)
  }
  return value
}

function parseCrashChildOptions(): CrashChildOptions {
  return {
    databasePath: requiredArgument('--database'),
    cwd: requiredArgument('--cwd'),
    sessionId: requiredArgument('--session-id'),
    markerPath: requiredArgument('--marker'),
    minimumCommitted: positiveIntegerArgument('--minimum-committed'),
    maximumPlanned: positiveIntegerArgument('--maximum-planned'),
  }
}

function setIsolatedAppPaths(root: string): void {
  const paths = {
    userData: join(root, 'electron', 'user-data'),
    sessionData: join(root, 'electron', 'session-data'),
    crashDumps: join(root, 'electron', 'crash-dumps'),
    logs: join(root, 'electron', 'logs'),
  }
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true })
  app.setPath('userData', paths.userData)
  app.setPath('sessionData', paths.sessionData)
  app.setPath('crashDumps', paths.crashDumps)
  app.setPath('logs', paths.logs)
}

function collectRuntimeSnapshot(): RuntimeSnapshot {
  const defaultApp = Boolean(
    (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp,
  )
  return {
    isPackaged: app.isPackaged,
    defaultApp,
    appPath: app.getAppPath(),
    electron: process.versions.electron ?? '',
    node: process.versions.node,
    sqlite: process.versions.sqlite ?? '',
    hasDatabaseSync: typeof DatabaseSync === 'function',
    hasBackup: typeof backup === 'function',
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE !== undefined,
  }
}

async function executeScenarios(
  args: MainArguments,
  context: ScenarioContext,
): Promise<ScenarioResult[]> {
  if (args.scenario === 'runtime') {
    return [await runRuntimeScenario(context), await runBootstrapScenario(context)]
  }
  if (args.scenario === 'storage') {
    return [
      await runRuntimeScenario(context),
      await runBootstrapScenario(context),
      ...(await runStorageScenarios(context)),
    ]
  }
  if (args.scenario === 'crash') {
    return [
      await runRuntimeScenario(context),
      await runBootstrapScenario(context),
      await runCrashRecoveryScenario(context),
    ]
  }
  if (args.scenario === 'legacy') {
    return [
      await runRuntimeScenario(context),
      await runBootstrapScenario(context),
      await runLegacyImportScenario(context),
    ]
  }
  if (args.scenario === 'full') {
    const runtime = await runRuntimeScenario(context)
    const bootstrap = await runBootstrapScenario(context)
    const storage = await runStorageScenarios(context)
    const crash = await runCrashRecoveryScenario(context)
    const legacy = await runLegacyImportScenario(context)
    const results = [runtime, bootstrap, ...storage, crash, legacy]
    const byName = new Map(results.map((result) => [result.name, result]))
    return REQUIRED_SCENARIOS.map((name) => {
      const result = byName.get(name)
      if (!result) throw new Error(`full scenario 缺少结果: ${name}`)
      return result
    })
  }
  throw new Error(`scenario 尚未实现: ${args.scenario}`)
}

function failedScenario(name: string, error: unknown): ScenarioResult {
  return {
    name,
    durationMs: 0,
    assertions: 0,
    entryCount: 0,
    databaseBytes: 0,
    walBytes: 0,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  }
}

async function run(): Promise<void> {
  const startedAt = new Date().toISOString()
  let args: MainArguments
  try {
    args = parseArguments()
  } catch (error) {
    console.error(error)
    app.exit(1)
    return
  }
  setIsolatedAppPaths(args.spikeRoot)

  await app.whenReady()
  const runtime = collectRuntimeSnapshot()
  let scenarios: ScenarioResult[] = []
  let status: SpikeReport['status'] = 'failed'
  try {
    assertPackagedRuntime(runtime)
    if (args.childMode === 'crash-writer') {
      await runCrashChild(parseCrashChildOptions())
    }
    if (args.childMode) throw new Error(`未知 child mode: ${args.childMode}`)
    scenarios = await executeScenarios(args, {
      rootDir: args.spikeRoot,
      executablePath: process.execPath,
    })
    status = scenarios.every((item) => item.status === 'passed') ? 'passed' : 'failed'
  } catch (error) {
    scenarios.push(failedScenario(args.scenario, error))
  }

  const report: SpikeReport = {
    runtime,
    scenarios,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
  }
  await writeFile(args.reportPath, JSON.stringify(report, null, 2), 'utf8')
  for (const scenario of scenarios) {
    console.log(`${scenario.name} ${scenario.status}`)
    if (scenario.error) console.error(scenario.error)
  }
  app.exit(status === 'passed' ? 0 : 1)
}

void run().catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
