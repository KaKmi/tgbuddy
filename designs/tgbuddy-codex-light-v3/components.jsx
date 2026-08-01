const { useMemo, useState } = React;

function Icon({ name, size = 16 }) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    folder: '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    moon: '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    panel: '<path d="M3 5h18v14H3z"/><path d="M15 5v14"/>', chevron: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    send: '<path d="M12 19V5M6 11l6-6 6 6"/>', file: '<path d="M14 3v5h5"/><path d="M5 3h9l5 5v13H5z"/>',
    check: '<path d="m4 12 5 5L20 6"/>', alert: '<path d="M12 9v4M12 17h.01"/><path d="m10.3 3.9-7.8 13.6A1.7 1.7 0 0 0 4 20h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3.4 0Z"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>', pin: '<path d="m15 4 5 5-3 2-4 4-1 5-3-3-3-3 5-1 4-4z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>', external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    paperclip: '<path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.3-9.3a4 4 0 0 1 5.7 5.7l-9.4 9.4a2 2 0 1 1-2.8-2.8l8.7-8.7"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    braces: '<path d="M8 3H6a2 2 0 0 0-2 2v4a3 3 0 0 1-2 3 3 3 0 0 1 2 3v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4a3 3 0 0 0 2 3 3 3 0 0 0-2 3v4a2 2 0 0 1-2 2h-2"/>',
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths[name] || paths.file }}></svg>;
}

function ProviderMark({ provider }) {
  if (provider.id === 'deepseek') return <span className="provider-mark brand-deepseek"><img src="assets/deepseek.svg" alt="" /></span>;
  if (provider.id === 'anthropic') return <span className="provider-mark brand-anthropic"><img src="assets/anthropic.svg" alt="" /></span>;
  return <span className="provider-mark brand-compatible"><Icon name="braces" size={16} /></span>;
}

function ThemeToggle({ theme, onToggle }) {
  return <button className="icon-button" onClick={onToggle} aria-label="切换黑白主题"><Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} /></button>;
}

function WorkspaceMenu({ workspace, open, onToggle, onPick }) {
  return <div className="workspace-wrap">
    <button className={`workspace-chip ${open ? 'is-open' : ''}`} onClick={onToggle}><span className="workspace-icon"><Icon name="folder" size={14} /></span><span className="workspace-copy"><strong>{workspace.name}</strong><small>{workspace.path}</small></span><Icon name="down" size={12} /></button>
    {open && <div className="popover workspace-menu"><div className="popover-label">工作区</div>{workspaceData.map((item) => <button className={`menu-row ${workspace.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => onPick(item)}><span className="check-slot">{workspace.id === item.id ? '✓' : ''}</span><span className="menu-copy"><strong>{item.name}</strong><small>{item.path}</small></span><span className="menu-meta">{item.meta}</span></button>)}<div className="menu-footer"><Icon name="plus" size={13} />选择其他文件夹…</div><p className="menu-note">会话、产物和授权规则按工作区隔离；Skill 与 MCP 为应用级能力。</p></div>}
  </div>;
}

function Sidebar({ activeSession, onSession, workspace, workspaceOpen, onWorkspaceToggle, onWorkspacePick, query, setQuery, onSettings, theme, onTheme, titleState }) {
  const groups = useMemo(() => sessionGroups.map((group) => ({ ...group, items: group.items.filter((item) => `${item.title}${item.subtitle}`.toLowerCase().includes(query.toLowerCase())) })).filter((group) => group.items.length), [query]);
  return <aside className="sidebar" data-screen-label="侧边栏 会话列表">
    <div className="brand-row"><div className="brand-mark">T</div><div className="brand-name">TgBuddy</div><div className="brand-actions"><ThemeToggle theme={theme} onToggle={onTheme} /><button className="icon-button" onClick={onSettings} aria-label="打开设置"><Icon name="settings" size={15} /></button></div></div>
    <WorkspaceMenu workspace={workspace} open={workspaceOpen} onToggle={onWorkspaceToggle} onPick={onWorkspacePick} />
    <button className="new-session"><Icon name="plus" size={14} /><span>新建会话</span><kbd>Ctrl N</kbd></button>
    <label className="search-box"><Icon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话与产物" /></label>
    <div className="session-scroll">
      {titleState !== 'idle' && <section className="session-group"><div className="session-label">刚刚</div><button className="session-item active"><div className="session-title-row"><span className={titleState === 'generating' ? 'mini-spinner' : 'generated-dot'}></span><strong>{titleState === 'generating' ? '正在生成标题…' : '分析销售退款异常'}</strong><time>刚刚</time></div><div className="session-subtitle">{titleState === 'generating' ? '已发送首条消息' : '标题由模型生成 · 可手动重命名'}</div></button></section>}
      {groups.map((group) => <section className="session-group" key={group.title}><div className="session-label">{group.title}</div>{group.items.map((item) => <button className={`session-item ${activeSession === item.id ? 'active' : ''}`} key={item.id} onClick={() => onSession(item.id)}><div className="session-title-row">{item.status === 'running' && <span className="running-dot"></span>}<strong>{item.title}</strong>{item.pinned && <Icon name="pin" size={11} />}<time>{item.time}</time></div><div className={`session-subtitle ${item.status}`}>{item.subtitle}</div></button>)}</section>)}
    </div>
    <div className="sidebar-footer"><span className="health-dot"></span><span>本地服务正常</span><small>v0.1</small></div>
  </aside>;
}

function MenuPopover({ title, hint, items, selected, onPick }) {
  return <div className="popover capability-menu"><div className="popover-heading"><span>{title}</span><small>{hint}</small></div>{items.map((item) => <button className="menu-row" key={item.id} onClick={() => onPick(item)}><span className="check-slot">{selected === item.id ? '✓' : ''}</span><span className="menu-copy"><strong>{item.label}</strong><small>{item.desc}</small></span></button>)}</div>;
}

function ContextPanel({ onClose }) {
  return <div className="popover context-panel"><div className="context-title"><strong>43.1%</strong><span>已使用 72.5K / 168.0K</span><button className="icon-button" onClick={onClose}><Icon name="close" size={14} /></button></div><div className="context-bar">{contextRows.map((row) => <span key={row.label} className={`bar-${row.tone}`} style={{ width: `${row.width}%` }}></span>)}</div><div className="context-list">{contextRows.map((row) => <div className="context-row" key={row.label}><span className={`legend legend-${row.tone}`}></span><span>{row.label}</span><code>{row.value}</code></div>)}</div><div className="context-divider"></div><div className="threshold-title"><span>自动压缩阈值</span><code>85%</code></div><div className="threshold"><span className="threshold-fill"></span><i className="threshold-now"></i><b></b></div><p className="context-help">触发前可稍后；压缩时消息继续排队，历史原文保留在本地。</p><div className="context-actions"><button className="secondary-button">立即压缩</button></div></div>;
}

function Composer({ menu, setMenu, mode, setMode, expert, setExpert, contextOpen, setContextOpen, running, onToggleRunning }) {
  const [draft, setDraft] = useState('');
  const menus = {
    mode: { title: '权限模式', hint: '会话级', items: modeOptions, selected: mode, onPick: (item) => { setMode(item.id); setMenu(null); } },
    expert: { title: '专家', hint: '切换 Profile', items: expertOptions, selected: expert, onPick: (item) => { setExpert(item.id); setMenu(null); } },
  };
  const selectedMode = modeOptions.find((item) => item.id === mode);
  const selectedExpert = expertOptions.find((item) => item.id === expert);
  return <div className="composer-shell"><div className="composer" data-screen-label="Agent 输入区">
    <div className="composer-toolbar"><button className="composer-chip" onClick={() => setMenu(menu === 'mode' ? null : 'mode')}><span>模式</span>{selectedMode.label}<Icon name="down" size={10} /></button><button className="composer-chip" onClick={() => setMenu(menu === 'expert' ? null : 'expert')}><span>专家</span>{selectedExpert.label}<Icon name="down" size={10} /></button><div className="composer-right"><button className="model-chip">DeepSeek V4 Pro<Icon name="down" size={10} /></button><button className="context-chip" onClick={() => { setContextOpen(!contextOpen); setMenu(null); }}><i></i>43.1%</button></div></div>
    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="给 Agent 下达任务…" />
    <div className="composer-footer"><div className="composer-left"><button className="attachment-button" aria-label="添加附件"><Icon name="paperclip" size={14} /></button><span>{mode === 'plan' ? '计划模式：先调查并提交计划' : mode === 'bypass' ? '完全访问：不会再询问授权' : '默认权限：写操作与命令会请求授权'}</span></div><div className="send-actions">{running && <button className="stop-button" onClick={onToggleRunning}><Icon name="stop" size={12} />停止</button>}<button className="send-button" onClick={() => draft.trim() && setDraft('')}><Icon name="send" size={15} /></button></div></div>
    {menu && <MenuPopover {...menus[menu]} />}{contextOpen && <ContextPanel onClose={() => setContextOpen(false)} />}
  </div></div>;
}

function ToolCard({ type, title, meta, status, expanded, onToggle, children }) {
  return <div className={`tool-card status-${status}`}><button className="tool-head" onClick={onToggle}><span className="tool-state">{status === 'success' ? <Icon name="check" size={14} /> : status === 'pending' ? <Icon name="alert" size={14} /> : <span className="spinner"></span>}</span><code>{type}</code><span>{title}</span><small>{meta}</small><Icon name={expanded ? 'down' : 'chevron'} size={12} /></button>{expanded && <div className="tool-body">{children}</div>}</div>;
}

function PlanCard() { return <div className="flow-card"><div className="flow-card-head"><span className="flow-symbol">P</span><div><strong>实施计划已准备好</strong><small>3 个步骤 · 预计修改 5 个文件</small></div></div><ol><li>核对数据字段与异常阈值</li><li>实现分析脚本并运行验证</li><li>生成报告、CSV 与图表</li></ol><div className="flow-actions"><button className="text-button">退回修改</button><button className="primary-button">批准并执行</button></div></div>; }
function AskCard() { return <div className="flow-card"><div className="flow-card-head"><span className="flow-symbol">?</span><div><strong>异常账户按什么标准输出？</strong><small>选择一项后继续原任务</small></div></div><div className="choice-stack"><button>风险分 ≥ 0.82 <small>推荐 · 92 个账户</small></button><button>风险分 ≥ 0.75 <small>覆盖更广 · 184 个账户</small></button><button>自定义阈值</button></div><div className="flow-actions"><button className="primary-button">确认选择</button></div></div>; }
function MissingWorkspaceCard() { return <div className="flow-card danger-card"><div className="flow-card-head"><Icon name="folder" size={17} /><div><strong>工作区目录已移动</strong><small>历史仍可查看，文件工具已暂停。</small></div></div><code>~/work/risk-q2</code><div className="flow-actions"><button className="secondary-button">选择新位置</button></div></div>; }

function ConversationFlow({ running, setRunning, flowState }) {
  const [openTool, setOpenTool] = useState('pending'); const [compacted, setCompacted] = useState(false);
  if (flowState === 'plan') return <div className="conversation-flow"><div className="user-message">先分析数据结构，给我一份执行计划。</div><PlanCard /></div>;
  if (flowState === 'ask') return <div className="conversation-flow"><div className="assistant-message"><div className="assistant-mark">T</div><p>我发现不同阈值会显著改变结果范围，需要你确认。</p></div><AskCard /></div>;
  if (flowState === 'missing') return <div className="conversation-flow"><MissingWorkspaceCard /></div>;
  return <div className="conversation-flow"><div className="user-message">分析 data/trades 下 Q2 的交易记录，找出异常账户，最后给我一份报告和图表。</div><div className="assistant-message"><div className="assistant-mark">T</div><p>我会先确认数据范围和字段，再清洗记录、识别异常交易，最后把报告、数据表和图表收进右侧结果区。</p></div><ToolCard type="glob" title="查找 data/trades 下的 Q2 文件" meta="0.4s · 3 个结果" status="success" expanded={openTool === 'glob'} onToggle={() => setOpenTool(openTool === 'glob' ? '' : 'glob')}><pre>2026-04.csv   18.2 MB{`\n`}2026-05.csv   19.7 MB{`\n`}2026-06.csv   21.1 MB</pre></ToolCard><ToolCard type="bash" title="清洗并合并 3 份交易数据" meta="执行中 · 8.2s" status="running" expanded={openTool === 'bash'} onToggle={() => setOpenTool(openTool === 'bash' ? '' : 'bash')}><pre>normalize timestamps{`\n`}drop duplicates: 812 rows{`\n`}join account registry…</pre></ToolCard><ToolCard type="write" title="写入 reports/q2-risk-report.md" meta="等待授权" status="pending" expanded={openTool === 'pending'} onToggle={() => setOpenTool(openTool === 'pending' ? '' : 'pending')}><div className="permission-copy"><strong>允许写入这份报告？</strong><span>当前工作区内新建 18.6 KB Markdown 文件。</span></div><div className="permission-scope"><span>本次允许</span><span>总是允许 write → reports/**</span></div><div className="permission-actions"><button className="text-button">拒绝</button><button className="secondary-button">总是允许</button><button className="primary-button" onClick={() => setRunning(true)}>允许</button></div></ToolCard><div className="system-marker"><span>⇲</span><button onClick={() => setCompacted(!compacted)}>已压缩 18 条历史消息 · {compacted ? '收起' : '查看摘要'}</button><i></i></div>{compacted && <div className="summary-card">已完成定位、清洗与阈值确认；原始消息仍保存在本地。</div>}<div className="assistant-message"><div className="assistant-mark">T</div><p>分析结果已经生成。我标记了 92 个异常账户，并整理了三份产物。</p></div></div>;
}

function PreviewBody({ file }) {
  if (file.ext === 'PNG') return <div className="image-preview"><div className="chart-bars"><i></i><i></i><i></i><i></i><i></i><i></i></div><p>风险分布 · 92 个异常账户</p></div>;
  if (file.ext === 'CSV') return <div className="table-preview"><div><b>account_id</b><b>risk_score</b><b>trades</b></div><div><span>A-1842</span><span>0.94</span><span>218</span></div><div><span>A-9281</span><span>0.91</span><span>166</span></div><div><span>A-4407</span><span>0.89</span><span>143</span></div><small>预览前 3 行 · 共 92 行</small></div>;
  if (file.ext === 'PY') return <pre className="code-preview"><em>def</em> score_account(trades):{`\n`}    burst = detect_burst(trades){`\n`}    <em>return</em> model.predict(burst)</pre>;
  return <div className="markdown-preview"><h2>Q2 交易异常分析</h2><p>本次分析覆盖 4–6 月共 3,284,119 条交易记录，识别出 92 个需要复核的账户。</p><hr /><h3>重点发现</h3><p>集中申报主要发生在开盘后 90 秒内，其中 14 个账户风险分高于 0.82。</p></div>;
}

function WorkspaceTree({ selected, onSelect }) {
  return <div className="workspace-tree"><div className="tree-root"><Icon name="folder" size={14} /><strong>risk-q2</strong><small>自动刷新</small></div>{workspaceFiles.map((entry) => <div key={entry.id}>{entry.type === 'folder' ? <><button className="tree-row folder-row"><Icon name="down" size={11} /><Icon name="folder" size={14} /><span>{entry.name}</span></button>{entry.open && entry.children.map((child) => <button className={`tree-row child-row ${selected === child.id ? 'active' : ''}`} key={child.id} onClick={() => onSelect(child.id)}><span className="tree-ext">{child.ext}</span><span>{child.name}</span><small>{child.meta}</small></button>)}</> : <button className="tree-row" onClick={() => onSelect('report')}><span className="tree-ext">{entry.ext}</span><span>{entry.name}</span><small>{entry.meta}</small></button>}</div>)}</div>;
}

function ResultsPanel({ open, onClose, selected, setSelected, filter, setFilter, onViewFile }) {
  const [section, setSection] = useState('artifacts'); const visible = filter === '全部' ? resultItems : resultItems.filter((item) => item.type === filter); const current = resultItems.find((item) => item.id === selected) || resultItems[0];
  if (!open) return null;
  return <aside className="results-panel" data-screen-label="结果与工作区文件"><div className="panel-header"><div className="panel-tabs"><button className={section === 'artifacts' ? 'active' : ''} onClick={() => setSection('artifacts')}>产物</button><button className={section === 'files' ? 'active' : ''} onClick={() => setSection('files')}>工作区</button></div><small>{section === 'artifacts' ? `${resultItems.length} 项` : '已挂载'}</small><button className="icon-button" onClick={onClose}><Icon name="close" size={14} /></button></div>{section === 'artifacts' ? <><div className="filter-row">{['全部', '文档', '代码', '图片', '数据'].map((item) => <button className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="preview-card compact-preview"><div className="preview-head"><span>{current.ext}</span><code title={current.path}>{current.path}</code><small>{current.source}</small></div><div className="preview-content"><PreviewBody file={current} /></div><div className="preview-actions"><button className="secondary-button"><Icon name="external" size={13} />系统打开</button><button className="secondary-button" onClick={() => onViewFile(current)}><Icon name="eye" size={13} />查看</button></div></div><div className="result-scroll">{['本次任务', '更早'].map((group) => <section key={group}><div className="result-label">{group}</div>{visible.filter((item) => item.group === group).map((item) => <button className={`result-item ${selected === item.id ? 'active' : ''}`} key={item.id} onClick={() => setSelected(item.id)}><span className={`result-ext tone-${item.tone}`}>{item.ext}</span><span><strong>{item.name}</strong><small>{item.meta} · {item.source}</small></span></button>)}</section>)}</div></> : <><div className="tree-toolbar"><label><Icon name="search" size={13} /><input placeholder="筛选工作区文件" /></label><button className="icon-button"><Icon name="refresh" size={13} /></button></div><WorkspaceTree selected={selected} onSelect={setSelected} /><div className="tree-footer">单击预览 · 双击用系统打开</div></>}</aside>;
}

function FileViewer({ file, onClose }) {
  return <div className="file-viewer-backdrop"><section className="file-viewer" data-screen-label="文件查看器"><header><div><small>交易风控 / {file.path.split('/').slice(0,-1).join(' / ')}</small><strong>{file.name}</strong></div><span>{file.ext} · {file.meta}</span><button className="secondary-button"><Icon name="external" size={13} />系统打开</button><button className="icon-button" onClick={onClose}><Icon name="close" size={15} /></button></header><main><PreviewBody file={file} /></main><footer><span>只读预览</span><span>内容来自当前工作区 · 自动随文件变化刷新</span></footer></section></div>;
}

function GeneralSettings() {
  const [restore, setRestore] = useState(true);
  return <div className="settings-content"><SettingsSection title="启动与会话"><SettingsRow title="启动时恢复" desc="回到上次工作区和会话"><button aria-label={restore ? '启动时恢复已开启' : '启动时恢复已关闭'} className={`switch ${restore ? 'is-on' : ''}`} onClick={() => setRestore(!restore)}><i></i></button></SettingsRow><SettingsRow title="新会话默认模式" desc="仅影响新建会话"><select defaultValue="auto"><option value="auto">默认权限</option><option value="plan">计划模式</option></select></SettingsRow></SettingsSection><SettingsSection title="本地数据"><SettingsRow title="数据目录" desc="Session、Blob 与索引均保存在本机"><button className="secondary-button">打开目录</button></SettingsRow><SettingsRow title="诊断日志" desc="不包含 API Key 与附件正文"><button className="secondary-button">导出</button></SettingsRow></SettingsSection></div>;
}

function ProviderEditor({ provider, onBack, onSave }) {
  const isNew = !provider;
  const [name, setName] = useState(provider?.name || 'OpenAI Compatible');
  const [endpoint, setEndpoint] = useState(provider?.endpoint || 'https://api.example.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState(provider?.id === 'deepseek' ? ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro'] : ['qwen3:32b', 'qwen3-coder', 'embed-local']);
  const [testing, setTesting] = useState('idle');
  const [saved, setSaved] = useState(false);
  const testConnection = () => { setTesting('testing'); window.setTimeout(() => setTesting('success'), 700); };
  const syncModels = () => setModels((items) => items.includes('auto-discovered-model') ? items : [...items, 'auto-discovered-model']);
  return <div className="settings-content provider-editor"><div className="manager-nav"><button className="back-button" onClick={onBack}>← 模型</button><div className="manager-title-with-icon">{provider && <ProviderMark provider={provider} />}<span><strong>{isNew ? '添加 Provider' : `配置 ${provider.name}`}</strong><small>连接信息与可用模型</small></span></div><span className={`status-label ${testing === 'success' ? 'online' : ''}`}>{testing === 'testing' ? '测试中…' : testing === 'success' ? '连接正常' : isNew ? '未保存' : '已连接'}</span></div><SettingsSection title="连接"><div className="form-grid"><label><span>显示名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>接口类型</span><select defaultValue={provider?.id === 'deepseek' ? 'deepseek' : 'openai'}><option value="openai">OpenAI Compatible</option><option value="deepseek">DeepSeek</option><option value="anthropic">Anthropic Compatible</option></select></label><label className="span-2"><span>Base URL</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label><label className="span-2"><span>API Key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={isNew ? '输入 API Key' : '已保存在系统钥匙串；留空则不修改'} /></label></div></SettingsSection><SettingsSection title="模型" note="连接成功后自动发现，也可以手动刷新"><div className="model-list">{models.map((model, index) => <div key={model}><code>{model}</code>{index === 0 && <span className="quiet-badge">默认</span>}</div>)}</div><div className="section-actions"><span>{models.length} 个模型可用</span><button className="secondary-button" onClick={syncModels}><Icon name="refresh" size={12} />同步模型</button></div></SettingsSection><div className="editor-actions"><button className="secondary-button" onClick={testConnection}>{testing === 'testing' ? '正在测试…' : '测试连接'}</button><button className="primary-button" disabled={!name.trim() || !endpoint.trim()} onClick={() => { onSave({ id: provider?.id || `custom-${Date.now()}`, name, endpoint, status: '已连接', models: `${models.length} 个模型` }); setSaved(true); }}>{saved ? '已保存' : '保存'}</button></div><p className="manager-footnote">API Key 仅写入本机系统钥匙串；保存前不会替换现有密钥。</p></div>;
}

function ModelSettings() {
  const [editing, setEditing] = useState(undefined);
  const [providers, setProviders] = useState(providerRows);
  const saveProvider = (next) => setProviders((items) => items.some((item) => item.id === next.id) ? items.map((item) => item.id === next.id ? next : item) : [...items, next]);
  if (editing !== undefined) return <ProviderEditor provider={editing || null} onBack={() => setEditing(undefined)} onSave={saveProvider} />;
  return <div className="settings-content"><SettingsSection title="模型分工" note="一个默认选择，必要时再覆盖"><SettingsRow title="主 Agent" desc="对话、工具调用与最终回答"><select defaultValue="deepseek"><option value="deepseek">DeepSeek V4 Pro</option><option value="local">本地 Qwen 32B</option></select></SettingsRow><SettingsRow title="子智能体" desc="默认跟随主模型"><select defaultValue="follow"><option value="follow">跟随主模型</option><option value="local">本地 Qwen 32B</option></select></SettingsRow><SettingsRow title="上下文压缩" desc="优先速度和稳定摘要"><select defaultValue="local"><option value="local">本地 Qwen 32B</option><option value="follow">跟随主模型</option></select></SettingsRow></SettingsSection><SettingsSection title="Provider 与密钥" note="连接、认证与模型发现统一管理">{providers.map((row) => <div className="provider-card" key={row.id}><ProviderMark provider={row} /><div><strong>{row.name}</strong><code>{row.endpoint}</code><small>{row.status} · {row.models}</small></div><button className="secondary-button" onClick={() => setEditing(row)}>配置</button></div>)}<button className="add-card" onClick={() => setEditing(null)}><Icon name="plus" size={14} />添加 Provider</button></SettingsSection></div>;
}
function PermissionSettings() {
  const [selectedMode, setSelectedMode] = useState('auto');
  const [rules, setRules] = useState([
    { id: 'reports', tool: 'write', scope: 'reports/**', meta: '交易风控 · 仅允许此路径 · 今天' },
    { id: 'status', tool: 'bash', scope: 'git status', meta: '交易风控 · 仅允许此命令 · 7 月 24 日' },
  ]);
  const [confirming, setConfirming] = useState(null);
  return <div className="settings-content"><SettingsSection title="默认权限模式" note="只影响新会话；运行中可在输入框切换"><div className="mode-cards">{modeOptions.map((mode) => <button className={selectedMode === mode.id ? 'active' : ''} key={mode.id} onClick={() => setSelectedMode(mode.id)}><strong>{mode.label}</strong><small>{mode.desc}</small></button>)}</div></SettingsSection><SettingsSection title="已记住的授权" note="你在授权请求中选择“总是允许”后生成；按工作区隔离">{rules.length === 0 ? <div className="empty-rule"><Icon name="check" size={15} /><span><strong>没有已记住的授权</strong><small>写入与命令会继续按当前权限模式询问。</small></span></div> : rules.map((rule) => <div className="rule-row" key={rule.id}><code>{rule.tool}</code><span><strong>{rule.scope}</strong><small>{rule.meta}</small></span>{confirming === rule.id ? <div className="inline-confirm"><small>撤销后下次会重新询问</small><button className="text-button" onClick={() => setConfirming(null)}>取消</button><button className="danger-text-button" onClick={() => { setRules((items) => items.filter((item) => item.id !== rule.id)); setConfirming(null); }}>确认撤销</button></div> : <button className="text-button" onClick={() => setConfirming(rule.id)}>撤销</button>}</div>)}</SettingsSection><SettingsSection title="工具默认行为" note="系统安全基线，只读展示"><div className="readonly-grid"><span><b>读取类</b><small>默认直接执行</small></span><span><b>写入与命令</b><small>默认每次询问</small></span><span><b>高危不可逆</b><small>始终模态确认</small></span></div></SettingsSection></div>;
}

function SkillManager({ onBack }) {
  const [enabled, setEnabled] = useState({ data: true, docs: true, browser: false, review: true });
  const [installed, setInstalled] = useState(false);
  const [query, setQuery] = useState('');
  const skills = [
    { id: 'data', name: '数据分析', source: '内置', desc: '清洗数据、生成统计与报告' },
    { id: 'docs', name: '文档处理', source: '内置', desc: '读取、生成并校验文档' },
    { id: 'browser', name: '浏览器自动化', source: '已安装', desc: '操作网页并采集可见状态' },
    { id: 'review', name: '代码审查', source: '已安装', desc: '检查改动并定位高风险问题' },
  ];
  const allSkills = installed ? [...skills, { id: 'report', name: '报告模板', source: '刚刚安装', desc: '生成结构化业务报告与摘要' }] : skills;
  const visible = allSkills.filter((skill) => `${skill.name}${skill.desc}`.includes(query));
  return <div className="settings-content manager-view"><div className="manager-nav"><button className="back-button" onClick={onBack}>← 应用能力</button><div><strong>技能</strong><small>{Object.values(enabled).filter(Boolean).length} 个示例技能已启用</small></div><button className="secondary-button" disabled={installed} onClick={() => { setInstalled(true); setEnabled((state) => ({ ...state, report: true })); }}><Icon name={installed ? 'check' : 'plus'} size={13} />{installed ? '已安装' : '安装技能'}</button></div><label className="manager-search"><Icon name="search" size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能" /></label><div className="manager-list">{visible.map((skill) => <div className="manager-row" key={skill.id}><span className="skill-mark">S</span><div><strong>{skill.name}</strong><small>{skill.desc}</small><em>{skill.source} · 对所有工作区可用</em></div><button aria-label={`${skill.name}${enabled[skill.id] ? '已启用' : '已停用'}`} className={`switch ${enabled[skill.id] ? 'is-on' : ''}`} onClick={() => setEnabled((state) => ({ ...state, [skill.id]: !state[skill.id] }))}><i></i></button></div>)}</div><p className="manager-footnote">关闭技能不会删除文件；新的 Run 不再加载它，正在运行的任务不受影响。</p></div>;
}

function McpManager({ onBack }) {
  const [servers, setServers] = useState([
    { id: 'filesystem', name: 'Local Files', detail: 'stdio · 6 个工具', state: 'online', label: '在线' },
    { id: 'github', name: 'GitHub', detail: 'HTTP · 12 个工具', state: 'online', label: '在线' },
    { id: 'analytics', name: 'Analytics DB', detail: 'HTTP · 连接超时', state: 'warning', label: '异常' },
  ]);
  const toggle = (id) => setServers((items) => items.map((item) => item.id !== id ? item : item.state === 'online' ? { ...item, state: 'offline', label: '已断开' } : { ...item, state: 'online', label: '在线', detail: item.id === 'analytics' ? 'HTTP · 4 个工具' : item.detail }));
  const addServer = () => setServers((items) => items.some((item) => item.id === 'custom') ? items : [...items, { id: 'custom', name: 'Custom MCP', detail: 'HTTP · 尚未连接', state: 'offline', label: '已添加' }]);
  return <div className="settings-content manager-view"><div className="manager-nav"><button className="back-button" onClick={onBack}>← 应用能力</button><div><strong>MCP 服务</strong><small>{servers.filter((item) => item.state === 'online').length} 个服务在线</small></div><button className="secondary-button" onClick={addServer}><Icon name="plus" size={13} />添加服务</button></div><div className="manager-list">{servers.map((server) => <div className="manager-row" key={server.id}><span className={`connector-dot ${server.state}`}></span><div><strong>{server.name}</strong><small>{server.detail}</small><em>应用级连接 · 按 Run 暴露所需工具</em></div><span className={`status-label ${server.state}`}>{server.label}</span><button className="secondary-button" onClick={() => toggle(server.id)}>{server.state === 'online' ? '断开' : server.state === 'warning' ? '重试' : '连接'}</button></div>)}</div><p className="manager-footnote">服务连接对所有工作区共用；具体工具是否可执行仍受当前权限模式控制。</p></div>;
}

function CapabilitySettings() {
  const [manager, setManager] = useState(null);
  if (manager === 'skill') return <SkillManager onBack={() => setManager(null)} />;
  if (manager === 'mcp') return <McpManager onBack={() => setManager(null)} />;
  return <div className="settings-content"><div className="settings-callout"><Icon name="check" size={16} /><div><strong>能力是应用级配置</strong><p>Skill 与 MCP 对所有工作区可见；每次 Run 仍只加载任务需要的能力。</p></div></div>{capabilityRows.map((row) => <div className="capability-card" key={row.id}><span className={`connector-dot ${row.status}`}></span><div><strong>{row.name}</strong><small>{row.summary}</small><p>{row.detail}</p></div><button className="secondary-button" onClick={() => setManager(row.id)}>管理</button></div>)}</div>;
}
function AppearanceSettings({ theme, onTheme }) { return <div className="settings-content"><SettingsSection title="主题"><div className="appearance-grid"><button className={theme === 'light' ? 'active' : ''} onClick={() => theme !== 'light' && onTheme()}><div className="theme-preview light-preview"></div><strong>明亮</strong><small>纸白工作台</small></button><button className={theme === 'dark' ? 'active' : ''} onClick={() => theme !== 'dark' && onTheme()}><div className="theme-preview dark-preview"></div><strong>深色</strong><small>暖炭灰界面</small></button></div></SettingsSection></div>; }
function SettingsSection({ title, note, children }) { return <section className="settings-section"><div className="settings-section-title"><strong>{title}</strong>{note && <small>{note}</small>}</div><div className="settings-group">{children}</div></section>; }
function SettingsRow({ title, desc, children }) { return <div className="settings-row"><span><strong>{title}</strong><small>{desc}</small></span><div>{children}</div></div>; }

function SettingsModal({ onClose, theme, onTheme }) {
  const [tab, setTab] = useState('general'); const tabs = [['general','通用'],['models','模型'],['permissions','工具与权限'],['capabilities','能力'],['appearance','外观']]; const titles = { general:'通用', models:'模型', permissions:'工具与权限', capabilities:'应用能力', appearance:'外观' }; const subtitles = { general:'应用行为与本地数据。', models:'Provider、密钥和模型分工。', permissions:'权限模式、规则与工具默认行为。', capabilities:'全局管理 Skill 与 MCP，不随工作区切换。', appearance:'主题与显示偏好。' };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="settings-modal" data-screen-label="设置中心"><aside><div className="settings-title">设置</div>{tabs.map(([id,label]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}{id === 'capabilities' && <span>1</span>}</button>)}</aside><main><div className="settings-head"><div><strong>{titles[tab]}</strong><p>{subtitles[tab]}</p></div><button className="icon-button" onClick={onClose}><Icon name="close" size={15} /></button></div>{tab === 'general' && <GeneralSettings />}{tab === 'models' && <ModelSettings />}{tab === 'permissions' && <PermissionSettings />}{tab === 'capabilities' && <CapabilitySettings />}{tab === 'appearance' && <AppearanceSettings theme={theme} onTheme={onTheme} />}</main></div></div>;
}

function DangerPermissionModal({ onClose }) { return <div className="modal-backdrop danger-backdrop"><div className="danger-modal"><span className="danger-icon"><Icon name="alert" size={19} /></span><div><strong>允许执行不可逆命令？</strong><p>此操作会强制覆盖远程分支，无法通过 TgBuddy 撤销。</p><pre>git push --force origin main</pre><small>高危操作不会提供“总是允许”。</small></div><div className="danger-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="danger-button" onClick={onClose}>仅本次执行</button></div></div></div>; }

Object.assign(window, { Icon, Sidebar, Composer, ConversationFlow, ResultsPanel, FileViewer, SettingsModal, DangerPermissionModal });
