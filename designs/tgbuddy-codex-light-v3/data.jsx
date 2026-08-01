const workspaceData = [
  { id: 'risk', name: '交易风控', path: '~/work/risk-q2', meta: '6 个会话' },
  { id: 'contracts', name: '合同比对', path: '~/work/contracts', meta: '2 个会话' },
  { id: 'scratch', name: '临时草稿', path: '~/Desktop/scratch', meta: '空' },
];

const sessionGroups = [
  { title: '置顶', items: [{ id: 'budget', title: 'Q3 预算模型重构', subtitle: '已完成 · 4 个产物', time: '周一', status: 'done', pinned: true }] },
  { title: '今天', items: [
    { id: 'risk-q2', title: 'Q2 交易异常分析', subtitle: '正在写 reports/q2-risk…', time: '刚刚', status: 'running' },
    { id: 'pricing', title: '爬取竞品定价页', subtitle: '失败 · MCP 服务超时', time: '11:05', status: 'error' },
  ] },
  { title: '更早 · 7 天内', items: [
    { id: 'cluster', title: '客服日志聚类', subtitle: '已完成 · 2 个产物', time: '周五', status: 'done' },
    { id: 'migration', title: 'CSV → 数据库迁移脚本', subtitle: '已归档', time: '周四', status: 'archived' },
  ] },
];

const resultItems = [
  { id: 'report', group: '本次任务', type: '文档', ext: 'MD', name: 'q2-risk-report.md', path: 'reports/q2-risk-report.md', meta: '刚刚 · 18.6 KB', tone: 'blue', source: 'write' },
  { id: 'chart', group: '本次任务', type: '图片', ext: 'PNG', name: 'risk-distribution.png', path: 'reports/risk-distribution.png', meta: '1 分钟前 · 428 KB', tone: 'green', source: '图表技能' },
  { id: 'data', group: '本次任务', type: '数据', ext: 'CSV', name: 'flagged-accounts.csv', path: 'reports/flagged-accounts.csv', meta: '2 分钟前 · 92 行', tone: 'amber', source: '子智能体' },
  { id: 'script', group: '更早', type: '代码', ext: 'PY', name: 'clean-trades.py', path: 'scripts/clean-trades.py', meta: '8 分钟前 · 已修改', tone: 'violet', source: 'edit' },
];

const workspaceFiles = [
  { id: 'reports', name: 'reports', type: 'folder', open: true, children: [
    { id: 'report', name: 'q2-risk-report.md', type: 'file', ext: 'MD', meta: '18.6 KB' },
    { id: 'chart', name: 'risk-distribution.png', type: 'file', ext: 'PNG', meta: '428 KB' },
    { id: 'data', name: 'flagged-accounts.csv', type: 'file', ext: 'CSV', meta: '92 行' },
  ] },
  { id: 'scripts', name: 'scripts', type: 'folder', open: true, children: [
    { id: 'script', name: 'clean-trades.py', type: 'file', ext: 'PY', meta: '3.1 KB' },
  ] },
  { id: 'source', name: 'data', type: 'folder', open: false, children: [] },
  { id: 'readme', name: 'README.md', type: 'file', ext: 'MD', meta: '2.4 KB' },
];

const contextRows = [
  { label: '系统提示词', value: '9.7K', width: 10, tone: 'gray' },
  { label: '工具及子智能体', value: '18.2K', width: 18, tone: 'blue' },
  { label: '对话消息', value: '38.6K', width: 38, tone: 'amber' },
  { label: '技能', value: '4.8K', width: 5, tone: 'violet' },
  { label: 'MCP', value: '1.2K', width: 2, tone: 'green' },
];

const modeOptions = [
  { id: 'auto', label: '默认权限', desc: '只读直接执行，写操作和命令逐次授权' },
  { id: 'plan', label: '计划模式', desc: '先调查并提交计划，批准后才执行' },
  { id: 'bypass', label: '完全访问', desc: '不再询问，仅建议在隔离环境中使用' },
];

const expertOptions = [
  { id: 'none', label: '通用 Agent', desc: '适合日常代码、文件与调研任务' },
  { id: 'data', label: '数据分析专家', desc: '偏重数据清洗、统计和报告表达' },
  { id: 'code', label: '工程专家', desc: '偏重代码实现、测试和架构约束' },
];

const providerRows = [
  { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com', status: '已连接', models: '3 个模型', key: '•••• •••• 4f2a' },
  { id: 'openai', name: 'OpenAI Compatible', endpoint: 'http://127.0.0.1:11434/v1', status: '已连接', models: '7 个模型', key: '本地端点' },
];

const capabilityRows = [
  { id: 'skill', name: '技能', summary: '8 个已启用', detail: '应用级能力 · 所有工作区共用', status: 'online' },
  { id: 'mcp', name: 'MCP 服务', summary: '2 在线 · 1 异常', detail: '应用级连接 · 运行时按需暴露工具', status: 'warning' },
];

Object.assign(window, { workspaceData, sessionGroups, resultItems, workspaceFiles, contextRows, modeOptions, expertOptions, providerRows, capabilityRows });
