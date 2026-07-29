import { useState } from 'react'
import type { AskUserRequest } from '../../shared/types/permission.ts'

export function AskUserCard({ request }: { request: AskUserRequest }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const complete = request.questions.every((question) =>
    Boolean((custom[question.id] ?? answers[question.id] ?? '').trim()),
  )

  async function submit() {
    if (!complete) return
    setBusy(true)
    await window.tgbuddy.askUser.respond({
      requestId: request.requestId,
      answers: request.questions.map((question) => ({
        questionId: question.id,
        value: (custom[question.id] ?? answers[question.id] ?? '').trim(),
      })),
    })
  }

  return (
    <div
      className="max-w-[720px] overflow-hidden px-3 py-3"
      style={{
        borderRadius: 11,
        background: 'rgba(127,167,212,.045)',
        boxShadow: 'inset 0 0 0 1px rgba(127,167,212,.20)',
      }}
    >
      <div className="mb-3 text-[13px] font-medium" style={{ color: '#9dbfe0' }}>
        需要你的补充
      </div>

      <div className="space-y-4">
        {request.questions.map((question) => (
          <fieldset key={question.id} className="space-y-2">
            <legend className="text-sm text-foreground">
              <span className="mr-2 text-xs text-muted-foreground">{question.header}</span>
              {question.question}
            </legend>
            <div className="grid gap-1.5">
              {question.options.map((option) => (
                <label
                  key={option.label}
                  className="flex cursor-pointer gap-2 rounded-lg bg-white/[.025] px-2.5 py-2 hover:bg-white/[.045]"
                >
                  <input
                    type="radio"
                    name={`${request.requestId}-${question.id}`}
                    checked={answers[question.id] === option.label && !custom[question.id]}
                    onChange={() => {
                      setAnswers((prev) => ({ ...prev, [question.id]: option.label }))
                      setCustom((prev) => ({ ...prev, [question.id]: '' }))
                    }}
                    className="mt-0.5 accent-[#9dbfe0]"
                  />
                  <span>
                    <span className="block text-xs text-foreground/90">{option.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <input
              value={custom[question.id] ?? ''}
              onChange={(event) =>
                setCustom((prev) => ({ ...prev, [question.id]: event.target.value }))
              }
              placeholder="其他答案…"
              className="w-full rounded-lg bg-card px-2.5 py-2 text-xs outline-none ring-1 ring-border focus:ring-ring/40"
            />
          </fieldset>
        ))}
      </div>

      <button
        disabled={busy || !complete}
        onClick={() => void submit()}
        className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
      >
        提交回答
      </button>
    </div>
  )
}
