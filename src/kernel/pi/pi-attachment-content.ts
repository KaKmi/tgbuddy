import type { ImageContent } from '@earendil-works/pi-ai'
import type { AttachmentRef } from '../../shared/contracts/attachment.ts'
import type { BlobRef } from '../../shared/contracts/blob.ts'

/** 文本附件进上下文的单文件上限：超过只截断注入，完整内容仍在 BlobStore */
export const TEXT_ATTACHMENT_LIMIT = 64 * 1024

export interface PreparePromptWithAttachmentsInput {
  text: string
  attachments?: AttachmentRef[]
  load?: (blob: BlobRef) => Promise<Uint8Array>
  modelSupportsImages: boolean
}

/**
 * A03：把附件 ref 还原成模型可见内容。
 * - 图片（且模型 input 支持 image）→ pi ImageContent（base64）；
 * - 文本 → 前置为 `[附件]` 块；
 * - 缺失/读取失败/类型不支持/模型不支持 → 注入诊断文本，不阻断 Run。
 */
export async function preparePromptWithAttachments(
  input: PreparePromptWithAttachmentsInput,
): Promise<{ text: string; images: ImageContent[] }> {
  if (!input.attachments?.length) return { text: input.text, images: [] }
  const images: ImageContent[] = []
  const diagnostics: string[] = []
  const textBlocks: string[] = []
  for (const attachment of input.attachments) {
    const mime = attachment.mime ?? ''
    const isImage = mime.startsWith('image/')
    if (isImage && !input.modelSupportsImages) {
      diagnostics.push(`${attachment.name}：当前模型不支持图片，已跳过`)
      continue
    }
    let bytes: Uint8Array
    try {
      if (!input.load) throw new Error('附件读取未配置')
      bytes = await input.load(attachment.blob)
    } catch {
      diagnostics.push(`${attachment.name}：附件读取失败，已跳过`)
      continue
    }
    if (isImage) {
      images.push({
        type: 'image',
        data: Buffer.from(bytes).toString('base64'),
        mimeType: mime,
      })
      continue
    }
    const text = new TextDecoder().decode(bytes)
    const body = text.length > TEXT_ATTACHMENT_LIMIT
      ? `${text.slice(0, TEXT_ATTACHMENT_LIMIT)}\n（附件过长已截断，完整内容在结果区）`
      : text
    textBlocks.push(`[附件 ${attachment.name}]\n${body}\n[/附件]`)
  }
  const prefix = [...textBlocks, ...diagnostics].join('\n')
  return {
    text: prefix ? `${prefix}\n\n${input.text}` : input.text,
    images,
  }
}
