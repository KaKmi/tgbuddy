import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { formatSize, truncateTail } from '@earendil-works/pi-agent-core'
import type { BlobRef } from '../../shared/contracts/blob.ts'

/** 工具输出落 Blob 的字节阈值（docs/02 E2E #4） */
export const TOOL_OUTPUT_THRESHOLD = 256 * 1024

/** 模型/UI 收到的截断预览行数（docs/06 决定 2） */
export const TOOL_OUTPUT_PREVIEW_LINES = 8

export interface PrepareToolOutputPreviewInput {
  content: Array<TextContent | ImageContent>
  sessionId: string
  toolCallId: string
  /** 完整输出落 BlobStore，返回 ref；失败时只记诊断不阻断 */
  store(sessionId: string, toolCallId: string, text: string): Promise<BlobRef>
}

/**
 * A04：工具输出超过阈值时，把完整内容落 Blob，模型/消息只收 8 行尾部预览
 * （bash 的关键结果在尾部）。返回 undefined 表示未超阈值，无需处理。
 */
export async function prepareToolOutputPreview(
  input: PrepareToolOutputPreviewInput,
): Promise<{ text: string; outputRef?: BlobRef } | undefined> {
  const text = input.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('')
  // 阈值按 UTF-8 字节算，中文等多字节内容不会被低估
  if (new TextEncoder().encode(text).byteLength <= TOOL_OUTPUT_THRESHOLD) {
    return undefined
  }
  let outputRef: BlobRef | undefined
  try {
    outputRef = await input.store(input.sessionId, input.toolCallId, text)
  } catch (error) {
    console.error('[PiToolOutput] 长输出落 Blob 失败：', error)
  }
  const preview = truncateTail(text, { maxLines: TOOL_OUTPUT_PREVIEW_LINES })
  const note = outputRef
    ? `\n（输出过长已截断，完整 ${formatSize(outputRef.size)} 可在结果区打开）`
    : '\n（输出过长已截断）'
  return {
    text: `${preview.content}${note}`,
    ...(outputRef ? { outputRef } : {}),
  }
}
