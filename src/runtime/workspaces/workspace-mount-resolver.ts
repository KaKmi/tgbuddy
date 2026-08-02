import type {
  WorkspaceMountResolution,
} from '../../shared/contracts/workspace.ts'

/**
 * 磁盘可用性端口。实现每次调用都重新 stat/access，
 * 调用方不得缓存"永远有效"的路径。
 */
export interface WorkspaceMountResolver {
  resolve(workspaceId: string, path: string): WorkspaceMountResolution
}

export function mountFailureMessage(
  resolution: Extract<WorkspaceMountResolution, { ok: false }>,
): string {
  switch (resolution.code) {
    case 'missing':
      return `工作区目录不存在：${resolution.path}。请恢复目录或重新选择文件夹`
    case 'not-directory':
      return `工作区路径不是文件夹：${resolution.path}。请重新选择文件夹`
    case 'unreadable':
      return `工作区目录不可访问：${resolution.path}。请检查权限或重新选择文件夹`
  }
}
