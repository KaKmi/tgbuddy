import { describe, expect, test } from 'bun:test'
import { providerBrand } from '../src/renderer/features/settings/provider-brand.ts'

describe('Provider 品牌识别', () => {
  test('按名称或端点识别 DeepSeek 与 Anthropic', () => {
    expect(providerBrand({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' })).toBe('deepseek')
    expect(providerBrand({ name: 'Claude 公司账号', baseUrl: 'https://api.anthropic.com' })).toBe('anthropic')
  })

  test('OpenAI Compatible 与未知本地端点保持中性 API 图标', () => {
    expect(providerBrand({ name: 'OpenAI Compatible', baseUrl: 'http://127.0.0.1:11434/v1' })).toBe('generic')
    expect(providerBrand({ name: '公司网关', baseUrl: 'https://llm.example.com/v1' })).toBe('generic')
  })
})
