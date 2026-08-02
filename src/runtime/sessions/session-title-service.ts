import type { SessionRepository } from './session-repository.ts'
import type { TitleGenerator } from './ports/title-generator.ts'

export interface SessionTitleRequest {
  sessionId: string
  userMessage: string
  channelId?: string
  modelId?: string
}

export interface SessionTitleService {
  request(input: SessionTitleRequest): Promise<void>
}

interface CreateSessionTitleServiceOptions {
  sessions: SessionRepository
  generator: TitleGenerator
  now(): number
  timeoutMs?: number
}

export type { TitleGenerator } from './ports/title-generator.ts'

const DEFAULT_TIMEOUT_MS = 8_000
const TIMEOUT = Symbol('title-timeout')

/** 首条消息标题的幂等、超时与竞争规则都由 Runtime 持有。 */
export function createSessionTitleService(
  options: CreateSessionTitleServiceOptions,
): SessionTitleService {
  const inFlight = new Set<string>()

  return {
    async request(input) {
      const session = options.sessions.get(input.sessionId)
      if (!session || titleSource(session.title, session.titleSource) !== 'default') return
      if (inFlight.has(input.sessionId)) return
      inFlight.add(input.sessionId)

      const controller = new AbortController()
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const generated = await Promise.race([
          options.generator.generate({
            userMessage: input.userMessage,
            ...(input.channelId ?? session.channelId
              ? { channelId: input.channelId ?? session.channelId }
              : {}),
            ...(input.modelId ?? session.modelId
              ? { modelId: input.modelId ?? session.modelId }
              : {}),
            signal: controller.signal,
          }).catch(() => null),
          new Promise<typeof TIMEOUT>((resolve) => {
            timer = setTimeout(() => resolve(TIMEOUT), timeoutMs)
          }),
        ])
        if (generated === TIMEOUT) controller.abort()
        const title = sanitizeTitle(
          generated === TIMEOUT ? null : generated,
          input.userMessage,
        )

        // 模型请求期间用户可能已经改名；落库前必须重新读取 canonical 状态。
        const latest = options.sessions.get(input.sessionId)
        if (!latest || titleSource(latest.title, latest.titleSource) !== 'default') return
        options.sessions.update({
          ...latest,
          title,
          titleSource: 'generated',
          updatedAt: options.now(),
        })
      } finally {
        if (timer) clearTimeout(timer)
        controller.abort()
        inFlight.delete(input.sessionId)
      }
    },
  }
}

function titleSource(
  title: string,
  source: 'default' | 'generated' | 'user' | undefined,
): 'default' | 'generated' | 'user' {
  return source ?? (title === '新会话' ? 'default' : 'user')
}

function sanitizeTitle(generated: string | null, fallback: string): string {
  const candidate = clean(generated ?? '') || clean(fallback) || '新任务'
  const limit = /[\u3400-\u9fff]/u.test(candidate) ? 24 : 60
  return Array.from(candidate).slice(0, limit).join('').trim()
}

function clean(value: string): string {
  return value
    .replace(/^\s*(?:标题|title)\s*[:：]\s*/iu, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
}
