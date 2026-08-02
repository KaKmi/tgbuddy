/**
 * 计划模式提交工具（pi adapter）。
 *
 * pi 明确把 plan mode 列为 non-goal（`docs/usage.md:306`），所以完全自建。
 * 计划模式已 skill 化：进入由用户通过权限模式 chip 显式切换（对应 Codex
 * 的显式模态），规划方法论由内置「计划模式」技能承载；这里只保留一个宿主
 * 只读能力 `exit_plan_mode`（提交计划）——像 skill 工具一样始终注入、
 * 不进工具区、不参与权限设置。
 *
 * 判定规则在 `policy-engine.ts` 的 `mode === 'plan'` 分支：
 *   只读能力与 Explorer 放行；其余效果必须由批准计划生成 grant。
 */

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { PermissionMode } from '../../shared/contracts/permission.ts'

export interface PlanModeHooks {
  getMode: () => PermissionMode
  setMode: (mode: PermissionMode) => void
  /** 通知 UI 模式变了。source 区分是用户点的还是模型自己切的 */
  onModeChanged: (mode: PermissionMode, source: 'user' | 'tool') => void
  /**
   * 提交计划等待用户审批。复用 Runtime 的 PlanAskBroker 挂起机制。
   */
  requestApproval: (
    plan: string,
    signal?: AbortSignal,
  ) => Promise<{ approved: boolean; reason?: string }>
}

export function buildPlanModeTools(hooks: PlanModeHooks): AgentTool[] {
  return [exitPlanMode(hooks)]
}

function exitPlanMode(hooks: PlanModeHooks): AgentTool {
  return {
    name: 'exit_plan_mode',
    label: '提交计划',
    description:
      '调研完成后提交计划给用户审批。批准后自动退出计划模式，可以开始执行；' +
      '被拒绝时按用户的意见修改计划再提交。',
    parameters: Type.Object({
      plan: Type.String({
        description: '完整计划，markdown 格式。要具体到会改哪些文件、执行什么命令',
      }),
    }),
    execute: async (_id, params, signal) => {
      const { plan } = params as { plan: string }

      if (hooks.getMode() !== 'plan') {
        return {
          content: [{ type: 'text', text: '当前不在计划模式，无需提交计划，直接执行即可。' }],
          details: { action: 'read' },
        }
      }

      // ★ 挂起等用户审批。和权限确认同构：这个 Promise 由 IPC 回调 resolve
      const { approved, reason } = await hooks.requestApproval(plan, signal)

      if (!approved) {
        // 不退出计划模式 —— 用户拒绝意味着计划要改，不是可以开工了
        return {
          content: [
            {
              type: 'text',
              text: `用户没有批准这个计划${reason ? `：${reason}` : ''}。请据此修改后重新提交，不要直接执行。`,
            },
          ],
          details: { action: 'read' },
        }
      }

      return {
        content: [{ type: 'text', text: '计划已批准。保持计划模式，只执行批准的效果。' }],
        details: { action: 'read' },
      }
    },
  }
}
