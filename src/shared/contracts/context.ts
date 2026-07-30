/** 上下文窗口的公共分类用量。分类值是估算，合计值优先使用模型供应商回报的数据。 */
export interface ContextUsageBreakdown {
  systemPrompt: number
  tools: number
  messages: number
  skills: number
  mcp: number
}

export interface ContextUsage {
  /** 当前请求完成后实际占用的上下文 token 数 */
  usedTokens: number
  contextWindow: number
  /** 保留一位小数，允许超过 100，以便暴露配置错误 */
  percent: number
  breakdown: ContextUsageBreakdown
  /** 最近一轮模型调用的输出与费用，不计入分类条形图 */
  outputTokens: number
  costUsd: number
  updatedAt: number
}
