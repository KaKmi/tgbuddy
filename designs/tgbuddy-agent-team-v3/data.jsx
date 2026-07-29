const workspaceData = [
  { id: 'risk', name: '交易风控', path: '~/work/risk-q2', meta: '6 个会话' },
  { id: 'contracts', name: '合同比对', path: '~/work/contracts', meta: '2 个会话' },
  { id: 'scratch', name: '临时草稿', path: '~/Desktop/scratch', meta: '空' },
];

const sessionGroups = [
  {
    title: '置顶',
    items: [
      { id: 'budget', title: 'Q3 预算模型重构', subtitle: '已完成 · 4 个产物', time: '周一', status: 'done', pinned: true },
    ],
  },
  {
    title: '今天',
    items: [
      { id: 'risk-q2', title: 'Q2 交易异常分析', subtitle: 'Team · 4 Agent · 2 正在执行', time: '刚刚', status: 'running', team: ['T', '数', '图', '审'] },
      { id: 'pricing', title: '爬取竞品定价页', subtitle: '失败 · 连接器超时', time: '11:05', status: 'error' },
    ],
  },
  {
    title: '更早 · 7 天内',
    items: [
      { id: 'cluster', title: '客服日志聚类', subtitle: '已完成 · 2 个产物', time: '周五', status: 'done' },
      { id: 'migration', title: 'CSV → 数据库迁移脚本', subtitle: '已归档', time: '周四', status: 'archived' },
    ],
  },
];

const resultItems = [
  { id: 'report', group: '本次任务', type: '文档', ext: 'MD', name: 'q2-risk-report.md', meta: '报告 Agent 创建 · 等待审查', owner: '报告 Agent', review: '等待审查', tone: 'blue' },
  { id: 'chart', group: '本次任务', type: '图片', ext: 'PNG', name: 'risk-distribution.png', meta: '图表 Agent 创建 · 已通过', owner: '图表 Agent', review: '已通过', tone: 'green' },
  { id: 'data', group: '本次任务', type: '数据', ext: 'CSV', name: 'flagged-accounts.csv', meta: '数据 Agent 创建 · 92 行', owner: '数据 Agent', review: '待整合', tone: 'amber' },
  { id: 'script', group: '更早', type: '代码', ext: 'PY', name: 'clean-trades.py', meta: '数据 Agent 修改 · 已通过', owner: '数据 Agent', review: '已通过', tone: 'violet' },
];

const teamAgents = [
  { id: 'lead', mark: 'T', name: '主管 Agent', role: '拆解任务、协调依赖并汇总交付', model: 'DeepSeek V4 Pro', status: 'running', statusText: '正在协调', task: '等待报告初稿后启动最终汇总', progress: 72, tokens: '18.4K', tone: 'lead' },
  { id: 'data', mark: '数', name: '数据 Agent', role: '清洗数据并识别异常账户', model: 'DeepSeek V4 Pro', status: 'running', statusText: '执行中', task: '计算账户风险分数 · 2,141,890 / 3,284,119', progress: 68, tokens: '31.8K', tone: 'blue' },
  { id: 'report', mark: '文', name: '报告 Agent', role: '把分析结论整理成审阅报告', model: 'GPT-5.2', status: 'waiting', statusText: '等待依赖', task: '等待 flagged-accounts.csv 完成', progress: 24, tokens: '8.2K', tone: 'amber' },
  { id: 'chart', mark: '图', name: '图表 Agent', role: '生成风险分布与时间趋势图', model: 'GPT-5.2', status: 'done', statusText: '已完成', task: 'risk-distribution.png 已通过检查', progress: 100, tokens: '12.6K', tone: 'green' },
  { id: 'review', mark: '审', name: '审查 Agent', role: '核对数据、证据和最终交付', model: 'DeepSeek V4 Pro', status: 'blocked', statusText: '需要处理', task: '报告审查因引用缺失暂停', progress: 36, tokens: '6.9K', tone: 'red' },
];

const teamTasks = [
  { id: 'scope', title: '确认数据范围与风险口径', owner: '主管 Agent', agentId: 'lead', status: 'done', meta: '已完成 · 4m 12s', depth: 0 },
  { id: 'clean', title: '清洗并合并 Q2 交易数据', owner: '数据 Agent', agentId: 'data', status: 'done', meta: '已完成 · 3,284,119 行', depth: 1 },
  { id: 'score', title: '计算异常账户风险分数', owner: '数据 Agent', agentId: 'data', status: 'running', meta: '68% · 预计 46 秒', depth: 1 },
  { id: 'chart', title: '生成风险分布图', owner: '图表 Agent', agentId: 'chart', status: 'done', meta: '已完成 · 1 个产物', depth: 1 },
  { id: 'report', title: '撰写风险分析报告', owner: '报告 Agent', agentId: 'report', status: 'waiting', meta: '等待风险分数', depth: 1 },
  { id: 'review', title: '审查证据与引用', owner: '审查 Agent', agentId: 'review', status: 'blocked', meta: '缺少 1 条数据引用', depth: 1 },
  { id: 'merge', title: '汇总并交付最终成果', owner: '主管 Agent', agentId: 'lead', status: 'queued', meta: '等待 3 个上游任务', depth: 0 },
];

const permissionRequests = [
  { id: 'p1', agentId: 'data', agent: '数据 Agent', mark: '数', tool: 'bash', target: 'python scripts/score_accounts.py', risk: '将读取 3 份数据并写入 data/clean/' },
  { id: 'p2', agentId: 'report', agent: '报告 Agent', mark: '文', tool: 'write', target: 'reports/q2-risk-report.md', risk: '将在当前工作区新建 18.6 KB 文件' },
];

const teamProfiles = [
  { id: 'risk', label: '风控分析 Team', desc: '主管、数据、报告、图表和审查 Agent' },
  { id: 'engineering', label: '工程交付 Team', desc: '主管、实现、测试和代码审查 Agent' },
  { id: 'research', label: '研究报告 Team', desc: '调研、事实核查、写作和编辑 Agent' },
];

const contextRows = [
  { label: 'Team 共享上下文', value: '12.1K', width: 12, tone: 'gray' },
  { label: '主管 Agent', value: '18.4K', width: 18, tone: 'blue' },
  { label: '数据 Agent', value: '31.8K', width: 31, tone: 'amber' },
  { label: '报告与图表 Agent', value: '20.8K', width: 21, tone: 'violet' },
  { label: '审查 Agent', value: '6.9K', width: 7, tone: 'green' },
];

const modeOptions = [
  { id: 'auto', label: '默认权限', desc: '只读直接执行，写操作和命令逐次授权' },
  { id: 'plan', label: '计划模式', desc: '先调查并提交计划，批准后才执行' },
  { id: 'bypass', label: '完全访问', desc: '不再询问，仅建议在隔离环境中使用' },
];

const skillOptions = [
  { id: 'files', label: '文件与文档', desc: '读取、编写并整理工作区文件', on: true },
  { id: 'charts', label: '图表生成', desc: '从数据产出图表与可视化', on: true },
  { id: 'review', label: '代码审查', desc: '检查错误、风险和缺失测试', on: true },
];

const connectorOptions = [
  { id: 'browser', label: '浏览器', desc: '已连接 · 6 个工具', status: 'online' },
  { id: 'postgres', label: 'PostgreSQL', desc: '已连接 · 4 个工具', status: 'online' },
  { id: 'notion', label: 'Notion', desc: '需要重新授权', status: 'warning' },
];

Object.assign(window, {
  workspaceData,
  sessionGroups,
  resultItems,
  teamAgents,
  teamTasks,
  permissionRequests,
  teamProfiles,
  contextRows,
  modeOptions,
  skillOptions,
  connectorOptions,
});
