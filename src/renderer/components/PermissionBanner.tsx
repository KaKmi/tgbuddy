/**
 * 授权确认卡片。
 *
 * 按 docs/06-设计决策.md 决定 3：
 *   - **inline 为默认**（模态会把 Agent 会话的心流切碎）
 *   - 「总是允许」是**组合粒度**：用户从候选里选一个范围 + 一个有效期
 *   - 破坏性命令（rm/sudo/重定向）**不显示「总是允许」** —— 不是点了才发现没保存
 *
 * ⚠️ 这层 UI 是临时的，等设计稿落地会替换。逻辑别写进组件。
 */

import { useState } from 'react'
import type { PermissionRequest, RuleScope } from '../../shared/types/permission.ts'

const SCOPE_LABELS: Record<RuleScope, string> = {
  session: '本会话',
  project: '本项目',
  global: '全局',
}

const RISK_STYLE = {
  low: 'border-border bg-card',
  medium: 'border-amber-800/60 bg-amber-950/20',
  high: 'border-red-800/60 bg-red-950/25',
} as const

export function PermissionBanner({ request }: { request: PermissionRequest }) {
  const [grantIndex, setGrantIndex] = useState<number | null>(null)
  const [scope, setScope] = useState<RuleScope>('project')
  const [busy, setBusy] = useState(false)

  async function respond(allowed: boolean) {
    setBusy(true)
    const grant =
      allowed && grantIndex !== null && request.suggestedGrants[grantIndex]
        ? {
            match: request.suggestedGrants[grantIndex]!.match,
            pattern: request.suggestedGrants[grantIndex]!.pattern,
            scope,
          }
        : undefined

    await window.tgbuddy.permission.respond({
      requestId: request.requestId,
      allowed,
      ...(grant ? { grant } : {}),
      ...(allowed ? {} : { reason: '用户拒绝了该操作，请换一种方式或询问用户' }),
    })
  }

  return (
    <div className={`rounded-lg border px-4 py-3 ${RISK_STYLE[request.risk]}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          请求执行 <code className="font-mono">{request.toolName}</code>
        </span>
        {request.risk === 'high' && (
          <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-200">高危</span>
        )}
      </div>

      {request.affectedPaths?.length ? (
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          {request.affectedPaths.join('、')}
        </p>
      ) : null}

      <pre className="mt-2 max-h-32 overflow-auto rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {JSON.stringify(request.args, null, 2)}
      </pre>

      {/* 破坏性命令不给「总是允许」—— 这类操作的价值就在于每次都停一下 */}
      {request.neverPersist ? (
        <p className="mt-2 text-xs text-amber-300/80">
          ⚠ 这条命令含破坏性操作（rm / sudo / 重定向），无法保存为规则，只能单次批准。
        </p>
      ) : request.suggestedGrants.length > 0 ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] text-muted-foreground">总是允许（可选）</p>
          {request.suggestedGrants.map((g, i) => (
            <label key={g.pattern} className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="radio"
                name={`grant-${request.requestId}`}
                checked={grantIndex === i}
                onChange={() => setGrantIndex(i)}
                className="accent-muted-foreground"
              />
              <span className="text-foreground/80">{g.label}</span>
            </label>
          ))}
          {grantIndex !== null && (
            <div className="flex items-center gap-1 pt-1">
              {(Object.keys(SCOPE_LABELS) as RuleScope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    scope === s ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground'
                  }`}
                >
                  {SCOPE_LABELS[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          disabled={busy}
          onClick={() => void respond(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          允许
        </button>
        <button
          disabled={busy}
          onClick={() => void respond(false)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs text-foreground/80 hover:bg-accent/70 disabled:opacity-40"
        >
          拒绝
        </button>
      </div>
    </div>
  )
}
