import type {
  Channel,
  ChannelModel,
  ProviderDiagnosticCode,
} from '../../../shared/contracts/channel.ts'

export type { ProviderDiagnosticCode } from '../../../shared/contracts/channel.ts'

export type ProviderDiscoveryResult =
  | { ok: true; models: ChannelModel[] }
  | { ok: false; code: Exclude<ProviderDiagnosticCode, 'ok'>; message: string }

export interface ProviderDiscoveryInput {
  /** 必须已解析出明文 apiKey（ChannelService.resolve 的结果） */
  channel: Channel
  signal?: AbortSignal
}

export interface ProviderCatalog {
  discover(input: ProviderDiscoveryInput): Promise<ProviderDiscoveryResult>
}
