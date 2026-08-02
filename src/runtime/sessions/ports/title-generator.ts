export interface GenerateTitleInput {
  userMessage: string
  channelId?: string
  modelId?: string
  signal: AbortSignal
}

export interface TitleGenerator {
  generate(input: GenerateTitleInput): Promise<string | null>
}
