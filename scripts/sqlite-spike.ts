import { packager } from '@electron/packager'
import { spawn } from 'node:child_process'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertPackagedRuntime,
  resolvePackagedExecutable,
  type SpikeReport,
} from './sqlite-spike-runtime.ts'

export interface SpikeLaunchOptions {
  repoRoot: string
  scenario: 'runtime' | 'storage' | 'crash' | 'legacy' | 'full'
  keepTempOnFailure?: boolean
}

export interface SpikeLaunchResult {
  executablePath: string
  reportPath: string
  exitCode: number
  stdout: string
  stderr: string
  report: SpikeReport
}

interface ElectronPackage {
  version: string
}

interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}

const STAGING_PACKAGE = {
  name: 'tgbuddy-sqlite-spike-fixture',
  version: '0.0.0',
  type: 'module',
  main: 'dist/sqlite-spike/sqlite-spike-main.js',
  dependencies: {
    '@earendil-works/pi-agent-core': '0.82.1',
    '@earendil-works/pi-ai': '0.82.1',
    '@earendil-works/pi-storage-sqlite-node': '0.82.1',
  },
}

function createSpikeIgnore(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  if (normalized === '' || normalized === '/package.json') return false
  if (normalized === '/dist' || normalized.startsWith('/dist/sqlite-spike')) return false
  if (normalized === '/node_modules') return false
  if (normalized.startsWith('/node_modules/.bin')) return true
  if (normalized.startsWith('/node_modules/electron')) return true
  if (normalized.startsWith('/node_modules/')) return false
  return true
}

async function stageRuntime(repoRoot: string, stagingRoot: string): Promise<void> {
  await mkdir(join(stagingRoot, 'dist'), { recursive: true })
  await cp(join(repoRoot, 'dist', 'sqlite-spike'), join(stagingRoot, 'dist', 'sqlite-spike'), {
    recursive: true,
  })
  await writeFile(
    join(stagingRoot, 'package.json'),
    JSON.stringify(STAGING_PACKAGE, null, 2),
    'utf8',
  )
  const sourceModules = join(repoRoot, 'node_modules')
  const stagedModules = join(stagingRoot, 'node_modules')
  try {
    await symlink(sourceModules, stagedModules, process.platform === 'win32' ? 'junction' : 'dir')
  } catch {
    // 某些受限 Windows 环境禁止创建链接；退回真实副本后仍由 Packager prune。
    await cp(sourceModules, stagedModules, { recursive: true })
  }
}

async function stageLegacyFixtures(repoRoot: string, spikeRoot: string): Promise<void> {
  const inputRoot = join(spikeRoot, 'legacy-input')
  const sessionsRoot = join(inputRoot, 'sessions')
  await mkdir(sessionsRoot, { recursive: true })
  await cp(
    join(repoRoot, 'tests', 'fixtures', 'legacy-sessions.json'),
    join(inputRoot, 'sessions.json'),
  )
  await cp(
    join(repoRoot, 'tests', 'fixtures', 'legacy-session.jsonl'),
    join(sessionsRoot, 'legacy-a.jsonl'),
  )
}

async function readElectronPackage(repoRoot: string): Promise<ElectronPackage> {
  return JSON.parse(
    await readFile(join(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8'),
  ) as ElectronPackage
}

async function spawnPackaged(
  executablePath: string,
  args: string[],
): Promise<SpawnResult> {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executablePath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      resolvePromise({ exitCode: code ?? -1, stdout, stderr })
    })
  })
}

async function createElectronZip(
  repoRoot: string,
  zipDirectory: string,
  version: string,
): Promise<void> {
  await mkdir(zipDirectory, { recursive: true })
  const zipPath = join(
    zipDirectory,
    `electron-v${version}-${process.platform}-${process.arch}.zip`,
  )
  try {
    if ((await stat(zipPath)).size > 1_000_000) return
  } catch {
    // 首次运行时创建缓存。
  }
  const source = join(repoRoot, 'node_modules', 'electron', 'dist')
  const command = process.platform === 'win32' ? 'tar.exe' : 'zip'
  const args =
    process.platform === 'win32'
      ? ['-a', '-c', '-f', zipPath, '-C', source, '.']
      : ['-q', '-r', zipPath, '.']
  const result = await new Promise<SpawnResult>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.platform === 'win32' ? repoRoot : source,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) =>
      resolvePromise({ exitCode: code ?? -1, stdout, stderr }),
    )
  })
  if (result.exitCode !== 0) {
    throw new Error(`创建本地 Electron ZIP 失败: ${result.stderr || result.stdout}`)
  }
}

export async function packageAndRunSpike(
  options: SpikeLaunchOptions,
): Promise<SpikeLaunchResult> {
  const repoRoot = resolve(options.repoRoot)
  const spikeRoot = await mkdtemp(join(tmpdir(), 'tgbuddy-sqlite-spike-'))
  const stagingRoot = join(spikeRoot, 'staging')
  const packageOutput = join(spikeRoot, 'package-output')
  const electronZipDir = join(tmpdir(), 'tgbuddy-electron-zip-cache')
  const reportPath = join(spikeRoot, 'spike-report.json')
  let succeeded = false

  try {
    console.log('[sqlite-spike] 准备最小 staging')
    await stageRuntime(repoRoot, stagingRoot)
    const electronPackage = await readElectronPackage(repoRoot)
    console.log('[sqlite-spike] 从已安装 Electron 生成本地 ZIP')
    await createElectronZip(repoRoot, electronZipDir, electronPackage.version)
    console.log('[sqlite-spike] 生成 ASAR packaged 产物')
    const outputPaths = await packager({
      dir: stagingRoot,
      name: 'TgBuddySQLiteSpike',
      executableName: 'TgBuddySQLiteSpike',
      out: packageOutput,
      overwrite: true,
      asar: true,
      prune: true,
      electronVersion: electronPackage.version,
      electronZipDir,
      ignore: createSpikeIgnore,
      afterCopy: [
        async ({ buildPath }) => {
          await writeFile(
            join(buildPath, 'package.json'),
            JSON.stringify(STAGING_PACKAGE, null, 2),
            'utf8',
          )
        },
      ],
    })
    if (outputPaths.length !== 1 || !outputPaths[0]) {
      throw new Error(`Packager 必须只生成一个产物，实际 ${outputPaths.length}`)
    }
    const executablePath = resolvePackagedExecutable(outputPaths[0], process.platform)
    if (options.scenario === 'legacy' || options.scenario === 'full') {
      await stageLegacyFixtures(repoRoot, spikeRoot)
    }
    console.log('[sqlite-spike] 启动 packaged Electron')
    const spawned = await spawnPackaged(executablePath, [
      '--spike-root',
      spikeRoot,
      '--report',
      reportPath,
      '--scenario',
      options.scenario,
    ])
    let report: SpikeReport
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8')) as SpikeReport
    } catch (error) {
      throw new Error(
        `packaged 进程未生成有效报告（temp=${spikeRoot}）: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    assertPackagedRuntime(report.runtime)
    if (spawned.exitCode !== 0 || report.status !== 'passed') {
      throw new Error(
        `packaged Spike 失败（temp=${spikeRoot}, exit=${spawned.exitCode}）\n${spawned.stdout}\n${spawned.stderr}`,
      )
    }
    succeeded = true
    return {
      executablePath,
      reportPath,
      ...spawned,
      report,
    }
  } finally {
    if (succeeded || options.keepTempOnFailure === false) {
      await rm(spikeRoot, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      })
    }
  }
}

function parseScenario(): SpikeLaunchOptions['scenario'] {
  const index = process.argv.indexOf('--scenario')
  const value = index === -1 ? 'full' : process.argv[index + 1]
  if (!value || !['runtime', 'storage', 'crash', 'legacy', 'full'].includes(value)) {
    throw new Error(`未知 scenario: ${value ?? '(missing)'}`)
  }
  return value as SpikeLaunchOptions['scenario']
}

async function main(): Promise<void> {
  const result = await packageAndRunSpike({
    repoRoot: process.cwd(),
    scenario: parseScenario(),
    keepTempOnFailure: true,
  })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  console.log(
    `packaged runtime: Electron ${result.report.runtime.electron}, Node ${result.report.runtime.node}, SQLite ${result.report.runtime.sqlite}`,
  )
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entryPath === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
