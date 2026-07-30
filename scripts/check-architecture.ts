import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import ts from 'typescript'

export interface ArchitectureCheckOptions {
  projectRoot: string
}

export interface ArchitectureViolation {
  source: string
  target: string
  rule: string
}

interface ImportReference {
  specifier: string
  typeOnly: boolean
  importedNames: string[]
}

interface AliasTarget {
  key: string
  target: string
}

type SourceLayer =
  | 'shared'
  | 'runtime'
  | 'kernel-pi'
  | 'infrastructure'
  | 'main-bootstrap'
  | 'main-ipc'
  | 'main'
  | 'preload'
  | 'renderer'

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

/**
 * 这些旧 owner 会在后续 Story 删除。豁免集中列出，避免 checker
 * 悄悄演变成允许 Main 长期直接调用 pi 的第二套规则。
 */
export const LEGACY_COMPATIBILITY = [
  { prefix: 'src/kernel/', deleteIn: 'Story 1C' },
  { prefix: 'src/main/orchestrator.ts', deleteIn: 'Story 1C' },
  { prefix: 'src/main/compaction-service.ts', deleteIn: 'Story 1C' },
  { prefix: 'src/main/tools/sandbox.ts', deleteIn: 'Story 2' },
  { prefix: 'src/main/tools/sandboxed-env.ts', deleteIn: 'Story 2' },
  { prefix: 'src/main/tools/index.ts', deleteIn: 'Story 4' },
  { prefix: 'src/main/tools/plan-mode.ts', deleteIn: 'Story 4' },
  { prefix: 'src/main/tools/ask-user.ts', deleteIn: 'Story 4' },
] as const

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function projectPath(projectRoot: string, absolutePath: string): string {
  return normalizePath(relative(projectRoot, absolutePath))
}

function listSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return []

  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry)
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(absolutePath))
      continue
    }
    if (
      SOURCE_EXTENSIONS.includes(extname(entry))
      && !entry.endsWith('.d.ts')
    ) {
      files.push(absolutePath)
    }
  }
  return files.sort()
}

function importIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) return false
  if (clause.isTypeOnly) return true
  if (clause.name) return false
  const bindings = clause.namedBindings
  if (!bindings || !ts.isNamedImports(bindings)) return false
  return bindings.elements.length > 0 && bindings.elements.every((item) => item.isTypeOnly)
}

function importedNames(node: ts.ImportDeclaration): string[] {
  const clause = node.importClause
  if (!clause) return []

  const names: string[] = []
  if (clause.name) names.push('default')
  const bindings = clause.namedBindings
  if (bindings && ts.isNamedImports(bindings)) {
    for (const item of bindings.elements) {
      names.push((item.propertyName ?? item.name).text)
    }
  } else if (bindings && ts.isNamespaceImport(bindings)) {
    names.push('*')
  }
  return names
}

function parseImports(filePath: string): ImportReference[] {
  const content = readFileSync(filePath, 'utf8')
  const source = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const imports: ImportReference[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: importIsTypeOnly(node),
        importedNames: importedNames(node),
      })
    } else if (
      ts.isExportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: node.isTypeOnly,
        importedNames: node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map((item) => (item.propertyName ?? item.name).text)
          : ['*'],
      })
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0]!)
    ) {
      imports.push({
        specifier: node.arguments[0].text,
        typeOnly: false,
        importedNames: ['*'],
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(source)

  return imports
}

function readTsconfigAliases(projectRoot: string): AliasTarget[] {
  const configPath = join(projectRoot, 'tsconfig.json')
  if (!existsSync(configPath)) return []

  const result = ts.readConfigFile(configPath, (path) => readFileSync(path, 'utf8'))
  if (result.error) return []

  const compilerOptions = result.config.compilerOptions as {
    baseUrl?: string
    paths?: Record<string, string[]>
  } | undefined
  const baseUrl = resolve(projectRoot, compilerOptions?.baseUrl ?? '.')
  const aliases: AliasTarget[] = []

  for (const [key, targets] of Object.entries(compilerOptions?.paths ?? {})) {
    const first = targets[0]
    if (!first) continue
    aliases.push({
      key: key.replace(/\/\*$/, ''),
      target: resolve(baseUrl, first.replace(/\/\*$/, '')),
    })
  }
  return aliases
}

function readViteAliases(projectRoot: string): AliasTarget[] {
  const configPath = join(projectRoot, 'vite.config.ts')
  if (!existsSync(configPath)) return []

  const content = readFileSync(configPath, 'utf8')
  const aliases: AliasTarget[] = []
  const resolvePattern =
    /(['"])([^'"]+)\1\s*:\s*resolve\(\s*(?:import\.meta\.dirname|__dirname)\s*,\s*(['"])([^'"]+)\3\s*\)/g

  for (const match of content.matchAll(resolvePattern)) {
    const key = match[2]
    const target = match[4]
    if (!key || !target) continue
    aliases.push({ key, target: resolve(projectRoot, target) })
  }
  return aliases
}

function samePath(left: string, right: string): boolean {
  return normalizePath(resolve(left)).toLowerCase() === normalizePath(resolve(right)).toLowerCase()
}

function aliasViolations(
  tsconfigAliases: AliasTarget[],
  viteAliases: AliasTarget[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = []
  for (const tsconfigAlias of tsconfigAliases) {
    const viteAlias = viteAliases.find((item) => item.key === tsconfigAlias.key)
    if (viteAlias && !samePath(tsconfigAlias.target, viteAlias.target)) {
      violations.push({
        source: `tsconfig.json#${tsconfigAlias.key}`,
        target: `vite.config.ts#${viteAlias.key}`,
        rule: 'alias 指向不一致',
      })
    }
  }
  return violations
}

function resolveSourceTarget(candidate: string): string {
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate

  if (!extname(candidate)) {
    for (const extension of SOURCE_EXTENSIONS) {
      const file = `${candidate}${extension}`
      if (existsSync(file)) return file
    }
  }

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    for (const extension of SOURCE_EXTENSIONS) {
      const indexFile = join(candidate, `index${extension}`)
      if (existsSync(indexFile)) return indexFile
    }
  }

  return candidate
}

function resolveImportTarget(
  filePath: string,
  specifier: string,
  aliases: AliasTarget[],
): string | undefined {
  if (specifier.startsWith('.')) {
    return resolveSourceTarget(resolve(dirname(filePath), specifier))
  }

  const alias = aliases
    .filter((item) => specifier === item.key || specifier.startsWith(`${item.key}/`))
    .sort((left, right) => right.key.length - left.key.length)[0]
  if (!alias) return undefined

  const suffix = specifier === alias.key ? '' : specifier.slice(alias.key.length + 1)
  return resolveSourceTarget(resolve(alias.target, suffix))
}

function classifySource(source: string): SourceLayer | undefined {
  if (source.startsWith('src/shared/')) return 'shared'
  if (source.startsWith('src/runtime/')) return 'runtime'
  if (source.startsWith('src/kernel/pi/')) return 'kernel-pi'
  if (source.startsWith('src/infrastructure/')) return 'infrastructure'
  if (source.startsWith('src/main/bootstrap/')) return 'main-bootstrap'
  if (source === 'src/main/ipc.ts') return 'main-ipc'
  if (source.startsWith('src/main/ipc/')) return 'main-ipc'
  if (source.startsWith('src/main/')) return 'main'
  if (source.startsWith('src/preload/')) return 'preload'
  if (source.startsWith('src/renderer/')) return 'renderer'
  return undefined
}

function isLegacyCompatibilitySource(source: string): boolean {
  if (source.startsWith('src/kernel/pi/')) return false
  return LEGACY_COMPATIBILITY.some((item) => source.startsWith(item.prefix))
}

function targetLayer(target: string): SourceLayer | 'kernel-legacy' | undefined {
  if (target.startsWith('src/kernel/') && !target.startsWith('src/kernel/pi/')) {
    return 'kernel-legacy'
  }
  return classifySource(target)
}

function isRuntimePort(target: string): boolean {
  if (!target.startsWith('src/runtime/')) return false
  if (target.includes('/ports/')) return true
  const filename = target.split('/').at(-1) ?? ''
  return /(?:repository|store|transport|resolver|engine|backend|loader)\.ts$/.test(filename)
}

function isFactoryTarget(target: string): boolean {
  const filename = target.split('/').at(-1) ?? ''
  return filename === 'index.ts' || filename.includes('factory') || filename.startsWith('create-')
}

function piTypeException(source: string, imported: ImportReference): boolean {
  if (!imported.typeOnly) return false
  if (!imported.specifier.startsWith('@earendil-works/pi-')) return false

  if (source === 'src/shared/contracts/message.ts') {
    return imported.specifier === '@earendil-works/pi-ai'
      || imported.specifier === '@earendil-works/pi-agent-core'
  }

  if (source === 'src/shared/contracts/events.ts') {
    return imported.specifier === '@earendil-works/pi-ai'
      && imported.importedNames.every((name) => name === 'StopReason' || name === 'Usage')
  }

  return false
}

function externalViolation(
  sourceLayer: SourceLayer,
  source: string,
  imported: ImportReference,
): string | undefined {
  const target = imported.specifier
  const isNode = target.startsWith('node:')
  const isPi = target.startsWith('@earendil-works/pi-')
  const isElectron = target === 'electron' || target.startsWith('electron/')
  const isReact = target === 'react' || target.startsWith('react/')

  switch (sourceLayer) {
    case 'shared':
      return piTypeException(source, imported)
        ? undefined
        : 'shared 只能依赖 shared；pi 仅允许指定 contract 的 type-only 例外'
    case 'runtime':
      return isNode || isPi || isElectron || isReact
        ? 'runtime 不得依赖 Node、pi、Electron 或 React runtime'
        : undefined
    case 'kernel-pi':
      return isElectron || isReact
        ? 'kernel/pi 不得依赖 Electron 或 React'
        : undefined
    case 'infrastructure':
      return isReact ? 'infrastructure 不得依赖 React' : undefined
    case 'main-bootstrap':
    case 'main-ipc':
    case 'main':
      return isReact ? 'main 不得依赖 React renderer runtime' : undefined
    case 'preload':
      return isElectron ? undefined : 'preload 外部依赖只允许 Electron context bridge'
    case 'renderer':
      return isNode || isPi || isElectron
        ? 'renderer 不得依赖 Node、pi 或 Electron'
        : undefined
  }
}

function internalViolation(
  sourceLayer: SourceLayer,
  target: string,
): string | undefined {
  const layer = targetLayer(target)

  switch (sourceLayer) {
    case 'shared':
      return layer === 'shared' ? undefined : 'shared 不得反向依赖其它层'
    case 'runtime':
      return layer === 'shared' || layer === 'runtime'
        ? undefined
        : 'runtime 只能依赖 shared 和 runtime'
    case 'kernel-pi':
      return layer === 'shared' || (layer === 'runtime' && isRuntimePort(target))
        ? undefined
        : 'kernel/pi 只能依赖 shared 与 runtime port contract'
    case 'infrastructure':
      return layer === 'shared' || (layer === 'runtime' && isRuntimePort(target))
        ? undefined
        : 'infrastructure 只能依赖 shared 与 runtime port contract'
    case 'main-bootstrap':
      if (layer === 'shared' || target.startsWith('src/main/')) return undefined
      if (target === 'src/runtime/index.ts') return undefined
      if ((layer === 'kernel-pi' || layer === 'infrastructure') && isFactoryTarget(target)) {
        return undefined
      }
      return 'main/bootstrap 只能装配公共 Runtime API 与 kernel/infrastructure factory'
    case 'main-ipc':
      if (layer === 'shared' || layer === 'main-ipc' || target === 'src/runtime/index.ts') {
        return undefined
      }
      return 'main/ipc 只能依赖 shared、Runtime 公共门面和纯 IPC helper'
    case 'main':
      if (layer === 'shared' || target.startsWith('src/main/') || target === 'src/runtime/index.ts') {
        return undefined
      }
      return 'main 非装配代码不得穿透 Runtime 公共门面'
    case 'preload':
      return layer === 'shared' ? undefined : 'preload 只能依赖 shared contract'
    case 'renderer':
      return layer === 'shared' || layer === 'renderer'
        ? undefined
        : 'renderer 只能依赖 shared contract 与 renderer 模块'
  }
}

export function formatArchitectureViolation(violation: ArchitectureViolation): string {
  return `${violation.source} -> ${violation.target} -> ${violation.rule}`
}

export function checkArchitecture(
  options: ArchitectureCheckOptions,
): ArchitectureViolation[] {
  const projectRoot = resolve(options.projectRoot)
  const tsconfigAliases = readTsconfigAliases(projectRoot)
  const viteAliases = readViteAliases(projectRoot)
  const aliases = [...tsconfigAliases]
  for (const viteAlias of viteAliases) {
    if (!aliases.some((item) => item.key === viteAlias.key)) aliases.push(viteAlias)
  }

  const violations = aliasViolations(tsconfigAliases, viteAliases)
  for (const filePath of listSourceFiles(join(projectRoot, 'src'))) {
    const source = projectPath(projectRoot, filePath)
    const sourceLayer = classifySource(source)
    if (!sourceLayer || isLegacyCompatibilitySource(source)) continue

    for (const imported of parseImports(filePath)) {
      const resolvedTarget = resolveImportTarget(filePath, imported.specifier, aliases)
      const target = resolvedTarget && isAbsolute(resolvedTarget)
        ? projectPath(projectRoot, resolvedTarget)
        : imported.specifier
      const rule = resolvedTarget
        ? internalViolation(sourceLayer, target)
        : externalViolation(sourceLayer, source, imported)

      if (rule) violations.push({ source, target, rule })
    }
  }

  return violations
}

function run(): void {
  const projectRoot = resolve(process.argv[2] ?? process.cwd())
  const violations = checkArchitecture({ projectRoot })
  for (const violation of violations) {
    console.error(formatArchitectureViolation(violation))
  }
  if (violations.length > 0) process.exitCode = 1
}

if (import.meta.main) run()
