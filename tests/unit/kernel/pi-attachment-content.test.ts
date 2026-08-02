import { describe, expect, test } from 'bun:test'
import {
  preparePromptWithAttachments,
  TEXT_ATTACHMENT_LIMIT,
} from '../../../src/kernel/pi/pi-attachment-content.ts'
import type { AttachmentRef } from '../../../src/shared/contracts/attachment.ts'

const encoder = new TextEncoder()

function imageRef(id: string): AttachmentRef {
  return {
    id,
    name: `${id}.png`,
    size: 3,
    mime: 'image/png',
    blob: { hash: `h-${id}`, size: 3, mime: 'image/png' },
  }
}

function textRef(id: string, name = `${id}.txt`): AttachmentRef {
  return {
    id,
    name,
    size: 5,
    mime: 'text/plain',
    blob: { hash: `h-${id}`, size: 5 },
  }
}

describe('preparePromptWithAttachments（A03）', () => {
  test('图片附件转 pi ImageContent（base64），正文原样保留', async () => {
    const { text, images } = await preparePromptWithAttachments({
      text: '看看这张图',
      attachments: [imageRef('a1')],
      load: () => Promise.resolve(encoder.encode('abc')),
      modelSupportsImages: true,
    })

    expect(text).toBe('看看这张图')
    expect(images).toEqual([
      { type: 'image', data: 'YWJj', mimeType: 'image/png' },
    ])
  })

  test('文本附件前置为 [附件] 块', async () => {
    const { text, images } = await preparePromptWithAttachments({
      text: '总结一下',
      attachments: [textRef('t1')],
      load: () => Promise.resolve(encoder.encode('需求说明内容')),
      modelSupportsImages: true,
    })

    expect(text).toContain('[附件 t1.txt]')
    expect(text).toContain('需求说明内容')
    expect(text).toContain('总结一下')
    expect(images).toHaveLength(0)
  })

  test('模型不支持图片时跳过并给诊断，不阻断', async () => {
    const { text, images } = await preparePromptWithAttachments({
      text: 'hi',
      attachments: [imageRef('a1')],
      load: () => Promise.resolve(encoder.encode('abc')),
      modelSupportsImages: false,
    })

    expect(images).toHaveLength(0)
    expect(text).toContain('不支持图片')
  })

  test('附件读取失败注入诊断并继续处理后续附件', async () => {
    const { text, images } = await preparePromptWithAttachments({
      text: 'hi',
      attachments: [imageRef('bad'), textRef('ok')],
      load: (blob) =>
        blob.hash === 'h-bad'
          ? Promise.reject(new Error('缺失'))
          : Promise.resolve(encoder.encode('正常文本')),
      modelSupportsImages: true,
    })

    expect(images).toHaveLength(0)
    expect(text).toContain('bad.png：附件读取失败')
    expect(text).toContain('[附件 ok.txt]')
    expect(text).toContain('正常文本')
  })

  test('超长文本附件截断注入并注明完整内容在结果区', async () => {
    const big = 'x'.repeat(TEXT_ATTACHMENT_LIMIT + 100)
    const { text } = await preparePromptWithAttachments({
      text: 'hi',
      attachments: [textRef('big')],
      load: () => Promise.resolve(encoder.encode(big)),
      modelSupportsImages: true,
    })

    expect(text).toContain('附件过长已截断')
    expect(text.length).toBeLessThan(big.length)
  })

  test('无附件时原样返回，不加载任何内容', async () => {
    let loaded = false
    const { text, images } = await preparePromptWithAttachments({
      text: 'hi',
      load: () => {
        loaded = true
        return Promise.resolve(new Uint8Array())
      },
      modelSupportsImages: true,
    })

    expect(text).toBe('hi')
    expect(images).toHaveLength(0)
    expect(loaded).toBe(false)
  })
})
