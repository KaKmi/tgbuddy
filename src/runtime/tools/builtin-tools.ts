import type { ToolDescriptor } from '../../shared/contracts/tool.ts'
import { createToolRegistry, type ToolRegistry } from './tool-registry.ts'

/**
 * 内置工具的统一描述符（settings/tools 的展示与默认权限来源）。
 * 名称必须与 pi 工具实际构造名一致：read/write/edit/bash 来自
 * pi agent-core，delete/glob 是自建，ask_user 是 kernel adapter。
 * 计划模式已 skill 化：enter/exit_plan_mode 不再作为工具区条目，
 * 提交计划是宿主只读能力（始终注入，不进设置列表）。
 */
export const BUILTIN_TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  {
    id: 'read',
    name: 'read',
    label: '读取文件',
    description: '读取文件内容，支持文本与图片，长文件按行分段读取',
    category: 'builtin',
    source: '内置',
    defaultPermission: 'allow',
    enabled: true,
  },
  {
    id: 'glob',
    name: 'glob',
    label: '查找文件',
    description: '按文件名模式递归查找文件，只读操作',
    category: 'builtin',
    source: '内置',
    defaultPermission: 'allow',
    enabled: true,
  },
  {
    id: 'write',
    name: 'write',
    label: '写入文件',
    description: '创建或整文件覆写文件内容',
    category: 'builtin',
    source: '内置',
    defaultPermission: 'ask',
    enabled: true,
  },
  {
    id: 'edit',
    name: 'edit',
    label: '编辑文件片段',
    description: '按 diff 片段编辑文件，自动串行化同文件修改',
    category: 'builtin',
    source: '内置',
    defaultPermission: 'ask',
    enabled: true,
  },
  {
    id: 'bash',
    name: 'bash',
    label: '执行命令',
    description: '在工作区执行 shell 命令，支持后台执行',
    category: 'builtin',
    source: '内置',
    defaultPermission: 'ask',
    enabled: true,
    note: '含 rm / sudo / 重定向的命令始终会询问，不受这里的「允许」影响',
  },
  {
    id: 'delete',
    name: 'delete',
    label: '删除文件',
    description: '删除文件或目录，默认移入系统回收站',
    category: 'builtin',
    source: '内置',
    defaultPermission: 'ask',
    enabled: true,
  },
  {
    id: 'ask_user',
    name: 'ask_user',
    label: '向用户提问',
    description: '向用户提出 1–3 个结构化问题',
    category: 'builtin',
    source: '内置',
    defaultPermission: 'ask',
    enabled: true,
  },
]

export function createBuiltinToolRegistry(): ToolRegistry {
  return createToolRegistry({
    descriptors: [...BUILTIN_TOOL_DESCRIPTORS],
  })
}
