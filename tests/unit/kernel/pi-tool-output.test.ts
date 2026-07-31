import { describe, expect, test } from 'bun:test'
import {
  prepareToolOutputPreview,
  TOOL_OUTPUT_PREVIEW_LINES,
  TOOL_OUTPUT_THRESHOLD,
} from '../../../src/kernel/pi/pi-tool-output.ts'
import type { BlobRef } from '../../../src/shared/contracts/blob.ts'

function textBlock(text: string): { type: 'text'; text: string } {
  return { type: 'text', text }
}

describe('prepareToolOutputPreview（A04）', () => {
  test('未超阈值返回 undefined，不落 Blob', async () => {
    let stored = false
    const result = await prepareToolOutputPreview({
      content: [textBlock('小输出')],
      sessionId: 's1',
      toolCallId: 't1',
      store: async () => {
        stored = true
        return { hash: 'h', size: 1 }
      },
    })

    expect(result).toBeUndefined()
    expect(stored).toBe(false)
  })

  test('超阈值落 Blob，模型只收 8 行尾部预览 + ref', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`).join('\n')
    const ref: BlobRef = { hash: 'hash-1', size: 999 }
    const result = await prepareToolOutputPreview({
      // 大段单行输出 + 尾部 20 行：保证超阈值且尾部是结构化行
      content: [textBlock(`${'x'.repeat(TOOL_OUTPUT_THRESHOLD)}\n${lines}`)],
      sessionId: 's1',
      toolCallId: 't1',
      store: async () => ref,
    })

    expect(result).toBeDefined()
    if (!result) return
    expect(result.outputRef).toBe(ref)
    expect(result.text).toContain('（输出过长已截断')
    // 预览只含末尾 8 行 + 截断说明
    const visibleLines = result.text.split('\n').filter((line) => line.startsWith('line-'))
    expect(visibleLines).toHaveLength(TOOL_OUTPUT_PREVIEW_LINES)
    expect(visibleLines[0]).toBe('line-12')
  })

  test('store 失败仍给截断预览，不带 ref 且不阻断', async () => {
    const result = await prepareToolOutputPreview({
      content: [textBlock('x'.repeat(TOOL_OUTPUT_THRESHOLD + 10))],
      sessionId: 's1',
      toolCallId: 't1',
      store: async () => {
        throw new Error('磁盘满')
      },
    })

    expect(result?.outputRef).toBeUndefined()
    expect(result?.text).toContain('（输出过长已截断）')
  })

  test('UTF-8 多字节内容按字节阈值判定（中文 3 字节/字）', async () => {
    const chars = Math.ceil(TOOL_OUTPUT_THRESHOLD / 3) + 10
    const result = await prepareToolOutputPreview({
      content: [textBlock('中'.repeat(chars))],
      sessionId: 's1',
      toolCallId: 't1',
      store: async () => ({ hash: 'h', size: chars * 3 }),
    })
    expect(result).toBeDefined()
  })

  test('多段文本块合并后按总长度判定', async () => {
    const half = Math.ceil(TOOL_OUTPUT_THRESHOLD / 2) + 10
    const result = await prepareToolOutputPreview({
      content: [textBlock('a'.repeat(half)), textBlock('b'.repeat(half))],
      sessionId: 's1',
      toolCallId: 't1',
      store: async () => ({ hash: 'h', size: half * 2 }),
    })
    expect(result).toBeDefined()
  })
})
