/**
 * A07：把产物路径解析到工作区 mount 内（S04 路径逃逸防线）。
 * 纯字符串实现（不依赖 node:path），支持 Windows `C:\` 与 `/` 两种分隔。
 */

export function resolveArtifactInsideMount(
  mountPath: string,
  artifactPath: string,
): string | undefined {
  const mount = normalizePath(mountPath)
  if (isAbsolutePath(artifactPath)) {
    // 不同盘符/前缀的绝对路径直接拒绝
    if (!artifactPath.toLowerCase().startsWith(mount.toLowerCase())) {
      return undefined
    }
  }
  const target = normalizePath(joinPath(mount, artifactPath))
  const rel = relativeOf(mount, target)
  if (rel === undefined) return undefined
  if (rel === '') return mount
  return target
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\') || path.startsWith('/')
}

function joinPath(mount: string, path: string): string {
  if (isAbsolutePath(path)) return path
  const sep = mount.endsWith('\\') ? '' : '\\'
  return `${mount}${sep}${path}`
}

function normalizePath(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean)
  const drive = /^[A-Za-z]:$/.test(segments[0] ?? '') ? `${segments.shift()}\\` : ''
  const stack: string[] = []
  for (const segment of segments) {
    if (segment === '.') continue
    if (segment === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(segment)
  }
  return `${drive}${stack.join('\\')}`
}

function relativeOf(mount: string, target: string): string | undefined {
  if (target.toLowerCase() === mount.toLowerCase()) return ''
  if (target.toLowerCase().startsWith(`${mount.toLowerCase()}\\`)) {
    return target.slice(mount.length + 1)
  }
  return undefined
}
