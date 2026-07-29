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
      { id: 'risk-q2', title: 'Q2 交易异常分析', subtitle: '正在写 reports/q2-risk…', time: '刚刚', status: 'running' },
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
  { id: 'report', group: '本次任务', type: '文档', ext: 'MD', name: 'q2-risk-report.md', meta: '刚刚 · 18.6 KB', tone: 'blue' },
  { id: 'chart', group: '本次任务', type: '图片', ext: 'PNG', name: 'risk-distribution.png', meta: '1 分钟前 · 428 KB', tone: 'green' },
  { id: 'data', group: '本次任务', type: '数据', ext: 'CSV', name: 'flagged-accounts.csv', meta: '2 分钟前 · 92 行', tone: 'amber' },
  { id: 'script', group: '更早', type: '代码', ext: 'PY', name: 'clean-trades.py', meta: '8 分钟前 · 已修改', tone: 'violet' },
];

const contextRows = [
  { label: '系统提示词', value: '9.7K', width: 10, tone: 'gray' },
  { label: '工具及子智能体', value: '18.2K', width: 18, tone: 'blue' },
  { label: '对话消息', value: '38.6K', width: 38, tone: 'amber' },
  { label: '技能', value: '4.8K', width: 5, tone: 'violet' },
  { label: '连接器及 MCP', value: '1.2K', width: 2, tone: 'green' },
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
  contextRows,
  modeOptions,
  expertOptions,
  skillOptions,
  connectorOptions,
});
