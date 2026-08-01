import type { AttachmentRef } from '../../shared/contracts/attachment.ts'

/** 附件 chip（A02）：名称 + 大小，可带移除按钮；消息回放时只读。 */
export function AttachmentChipList({
  attachments,
  onRemove,
}: {
  attachments: AttachmentRef[]
  onRemove?: (ref: AttachmentRef) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <span
          key={attachment.id}
          data-testid="attachment-chip"
          className="flex items-center gap-1.5 rounded-md bg-white/[.05] px-2 py-1 text-[11px] text-muted-foreground"
        >
          <span className="truncate">{attachment.name}</span>
          <span className="shrink-0 opacity-60">{formatSize(attachment.size)}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(attachment)}
              className="shrink-0 text-muted-foreground/60 hover:text-status-error"
              aria-label={`移除附件 ${attachment.name}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
