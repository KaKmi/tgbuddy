import type { Channel } from '../../shared/contracts/channel.ts'

/**
 * 渠道目录持久化端口。repository 只存取行数据，
 * 密钥 ref 与明文流转由 ChannelService 负责。
 */
export interface ChannelRepository {
  list(): Channel[]
  get(channelId: string): Channel | undefined
  save(channel: Channel): Channel
  delete(channelId: string): void
}
