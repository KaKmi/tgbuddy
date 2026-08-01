import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'

export interface DelegateHooks {
  /** 同步委派：运行 child run 并等待其 settled 摘要，返回给父 Agent。 */
  delegate(
    task: string,
    toolCallId: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; text: string }>
}

/** D02：单层 child 委派工具（child run 不加载此工具，保证深度 ≤1）。 */
export function buildDelegateTool(hooks: DelegateHooks): AgentTool {
  return {
    name: 'delegate_to_agent',
    label: '委派子智能体',
    description:
      '把独立子任务同步委派给子智能体执行，等待其完成后把摘要作为结果返回。'
      + '适合探索代码库、独立调研、可拆分的子任务；'
      + '简单任务直接自己做，不要委派。',
    parameters: Type.Object({
      task: Type.String({
        description: '子任务描述，包含要收集什么、返回什么格式',
      }),
    }),
    execute: async (toolCallId, params, signal) => {
      const { task } = params as { task: string }
      const result = await hooks.delegate(task, toolCallId, signal)
      if (!result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: result.text,
            },
          ],
          details: { action: 'read' },
        }
      }
      return {
        content: [{ type: 'text', text: result.text }],
        details: { action: 'execute', delegated: true },
      }
    },
  }
}
