export type ProviderBrand = 'deepseek' | 'anthropic' | 'generic'

export function providerBrand(input: { name: string; baseUrl: string }): ProviderBrand {
  const identity = `${input.name} ${input.baseUrl}`.toLocaleLowerCase()
  if (identity.includes('deepseek')) return 'deepseek'
  if (identity.includes('anthropic') || identity.includes('claude')) return 'anthropic'
  return 'generic'
}
