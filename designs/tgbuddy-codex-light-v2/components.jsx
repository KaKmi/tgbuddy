const { useEffect, useMemo, useRef, useState } = React;

function Icon({ name, size = 16 }) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    folder: '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    moon: '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    panel: '<path d="M3 5h18v14H3z"/><path d="M15 5v14"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    file: '<path d="M14 3v5h5"/><path d="M5 3h9l5 5v13H5z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="m10.3 3.9-7.8 13.6A1.7 1.7 0 0 0 4 20h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3.4 0Z"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    pin: '<path d="m15 4 5 5-3 2-4 4-1 5-3-3-3-3 5-1 4-4z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    sliders: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  };
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths[name] || paths.file }}></svg>
  );
}

function ThemeToggle({ theme, onToggle }) {
  return (
    <button className="icon-button" onClick={onToggle} aria-label="切换黑白主题" title="切换黑白主题">
      <Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />
    </button>
  );
}

function WorkspaceMenu({ workspace, open, onToggle, onPick }) {
  return (
    <div className="workspace-wrap">
      <button className={`workspace-chip ${open ? 'is-open' : ''}`} onClick={onToggle}>
        <span className="workspace-icon"><Icon name="folder" size={14} /></span>
        <span className="workspace-copy">
          <strong>{workspace.name}</strong>
          <small>{workspace.path}</small>
        </span>
        <Icon name="down" size={12} />
      </button>
      {open && (
        <div className="popover workspace-menu">
          <div className="popover-label">工作区</div>
          {workspaceData.map((item) => (
            <button className={`menu-row ${workspace.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => onPick(item)}>
              <span className="check-slot">{workspace.id === item.id ? '✓' : ''}</span>
              <span className="menu-copy"><strong>{item.name}</strong><small>{item.path}</small></span>
              <span className="menu-meta">{item.meta}</span>
            </button>
          ))}
          <div className="menu-footer"><Icon name="plus" size={13} /> 选择其他文件夹…</div>
          <p className="menu-note">会话、产物和授权规则都按工作区隔离。</p>
        </div>
      )}
    </div>
  );
}

function Sidebar({ activeSession, onSession, workspace, workspaceOpen, onWorkspaceToggle, onWorkspacePick, query, setQuery, onSettings, theme, onTheme }) {
  const filtered = useMemo(() => sessionGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => `${item.title}${item.subtitle}`.toLowerCase().includes(query.toLowerCase())),
  })).filter((group) => group.items.length), [query]);
  return (
    <aside className="sidebar" data-screen-label="侧边栏 会话列表">
      <div className="brand-row">
        <div className="brand-mark">T</div>
        <div className="brand-name">TgBuddy</div>
        <div className="brand-actions">
          <ThemeToggle theme={theme} onToggle={onTheme} />
          <button className="icon-button" onClick={onSettings} aria-label="打开设置"><Icon name="settings" size={15} /></button>
        </div>
      </div>
      <WorkspaceMenu workspace={workspace} open={workspaceOpen} onToggle={onWorkspaceToggle} onPick={onWorkspacePick} />
      <button className="new-session"><Icon name="plus" size={14} /><span>新建会话</span><kbd>Ctrl N</kbd></button>
      <label className="search-box"><Icon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话与产物" /></label>
      <div className="session-scroll">
        {filtered.map((group) => (
          <section className="session-group" key={group.title}>
            <div className="session-label">{group.title}</div>
            {group.items.map((item) => (
              <button className={`session-item ${activeSession === item.id ? 'active' : ''}`} key={item.id} onClick={() => onSession(item.id)}>
                <div className="session-title-row">
                  {item.status === 'running' && <span className="running-dot"></span>}
                  <strong>{item.title}</strong>
                  {item.pinned && <Icon name="pin" size={11} />}
                  <time>{item.time}</time>
                </div>
                <div className={`session-subtitle ${item.status}`}>{item.subtitle}</div>
              </button>
            ))}
          </section>
        ))}
      </div>
      <div className="sidebar-footer"><span className="health-dot"></span><span>本地服务正常</span><small>v0.1</small></div>
    </aside>
  );
}

function MenuPopover({ title, hint, items, selected, onPick, footer }) {
  return (
    <div className="popover capability-menu">
      <div className="popover-heading"><span>{title}</span><small>{hint}</small></div>
      {items.map((item) => (
        <button className="menu-row" key={item.id} onClick={() => onPick(item)}>
          <span className="check-slot">{selected === item.id || item.on ? '✓' : ''}</span>
          <span className="menu-copy"><strong>{item.label}</strong><small>{item.desc}</small></span>
          {item.status && <span className={`status-word ${item.status}`}>{item.status === 'online' ? '已连接' : '注意'}</span>}
        </button>
      ))}
      {footer && <div className="menu-link">{footer}</div>}
    </div>
  );
}

function ContextPanel({ onClose }) {
  return (
    <div className="popover context-panel">
      <div className="context-title"><strong>43.1%</strong><span>已使用 72.5K / 168.0K</span><button className="icon-button" onClick={onClose}><Icon name="close" size={14} /></button></div>
      <div className="context-bar">{contextRows.map((row) => <span key={row.label} className={`bar-${row.tone}`} style={{ width: `${row.width}%` }}></span>)}</div>
      <div className="context-list">{contextRows.map((row) => <div className="context-row" key={row.label}><span className={`legend legend-${row.tone}`}></span><span>{row.label}</span><code>{row.value}</code></div>)}</div>
      <div className="context-divider"></div>
      <div className="threshold-title"><span>自动压缩阈值</span><code>85%</code></div>
      <div className="threshold"><span className="threshold-fill"></span><i className="threshold-now"></i><b></b></div>
      <p className="context-help">到 85% 自动压缩，不打断任务；触发前 3 秒可选择稍后。历史原文仍保存在本地。</p>
      <div className="context-actions"><button className="secondary-button">立即压缩</button><button className="text-button">管理常驻能力</button></div>
    </div>
  );
}

function Composer({ menu, setMenu, mode, setMode, expert, setExpert, contextOpen, setContextOpen, running, onToggleRunning }) {
  const [draft, setDraft] = useState('');
  const menus = {
    mode: { title: '权限模式', hint: '会话级', items: modeOptions, selected: mode, onPick: (item) => { setMode(item.id); setMenu(null); } },
    expert: { title: '专家', hint: '切换系统提示词', items: expertOptions, selected: expert, onPick: (item) => { setExpert(item.id); setMenu(null); } },
    skills: { title: '技能', hint: '3 个已启用', items: skillOptions, selected: '', onPick: () => {}, footer: '在设置中管理技能…' },
    connectors: { title: '连接器', hint: '2 / 3 在线', items: connectorOptions, selected: '', onPick: () => {}, footer: '在设置中管理连接器…' },
  };
  const selectedMode = modeOptions.find((item) => item.id === mode);
  const selectedExpert = expertOptions.find((item) => item.id === expert);
  return (
    <div className="composer-shell">
      <div className="composer" data-screen-label="Agent 输入区">
        <div className="composer-toolbar">
          <button className="composer-chip" onClick={() => setMenu(menu === 'mode' ? null : 'mode')}><span>模式</span>{selectedMode.label}<Icon name="down" size={10} /></button>
          <button className="composer-chip" onClick={() => setMenu(menu === 'expert' ? null : 'expert')}><span>专家</span>{selectedExpert.label}<Icon name="down" size={10} /></button>
          <button className="composer-chip" onClick={() => setMenu(menu === 'skills' ? null : 'skills')}><span>技能</span>3<Icon name="down" size={10} /></button>
          <button className="composer-chip" onClick={() => setMenu(menu === 'connectors' ? null : 'connectors')}><span>连接器</span>2<Icon name="down" size={10} /></button>
          <div className="composer-right">
            <button className="model-chip">DeepSeek V4 Pro<Icon name="down" size={10} /></button>
            <button className="context-chip" onClick={() => { setContextOpen(!contextOpen); setMenu(null); }}><i></i>43.1%</button>
          </div>
        </div>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="给 Agent 下达任务…" />
        <div className="composer-footer">
          <span>{mode === 'plan' ? '计划模式：先调查并提交计划' : mode === 'bypass' ? '完全访问：不会再询问授权' : '默认权限：写操作与命令会请求授权'}</span>
          <div className="send-actions">
            {running && <button className="stop-button" onClick={onToggleRunning}><Icon name="stop" size={12} />停止</button>}
            <button className="send-button" onClick={() => draft.trim() && setDraft('')}><Icon name="send" size={15} /></button>
          </div>
        </div>
        {menu && menus[menu] && <MenuPopover {...menus[menu]} />}
        {contextOpen && <ContextPanel onClose={() => setContextOpen(false)} />}
      </div>
    </div>
  );
}

function ToolCard({ type, title, meta, status, expanded, onToggle, children }) {
  return (
    <div className={`tool-card status-${status}`}>
      <button className="tool-head" onClick={onToggle}>
        <span className="tool-state">{status === 'success' ? <Icon name="check" size={14} /> : status === 'pending' ? <Icon name="alert" size={14} /> : <span className="spinner"></span>}</span>
        <code>{type}</code><span>{title}</span><small>{meta}</small><Icon name={expanded ? 'down' : 'chevron'} size={12} />
      </button>
      {expanded && <div className="tool-body">{children}</div>}
    </div>
  );
}

function ConversationFlow({ running, setRunning }) {
  const [openTool, setOpenTool] = useState('pending');
  const [compacted, setCompacted] = useState(false);
  return (
    <div className="conversation-flow">
      <div className="user-message">分析 data/trades 下 Q2 的交易记录，找出异常账户，最后给我一份报告和图表。</div>
      <div className="assistant-message"><div className="assistant-mark">T</div><p>我会先确认数据范围和字段，再清洗记录、识别异常交易，最后把报告、数据表和图表收进右侧结果区。</p></div>
      <ToolCard type="glob" title="查找 data/trades 下的 Q2 文件" meta="0.4s · 3 个结果" status="success" expanded={openTool === 'glob'} onToggle={() => setOpenTool(openTool === 'glob' ? '' : 'glob')}>
        <div className="tool-section"><span>范围</span><code>data/trades/**/*.csv</code></div><pre>2026-04.csv   18.2 MB{`\n`}2026-05.csv   19.7 MB{`\n`}2026-06.csv   21.1 MB</pre>
      </ToolCard>
      <ToolCard type="bash" title="清洗并合并 3 份交易数据" meta="执行中 · 8.2s" status="running" expanded={openTool === 'bash'} onToggle={() => setOpenTool(openTool === 'bash' ? '' : 'bash')}>
        <pre>normalize timestamps{`\n`}drop duplicates: 812 rows{`\n`}join account registry…</pre>
      </ToolCard>
      <div className="assistant-message"><div className="assistant-mark">T</div><p>数据已清洗完成。下一步需要执行分析脚本并写入报告文件。</p></div>
      <ToolCard type="write" title="写入 reports/q2-risk-report.md" meta="等待授权" status="pending" expanded={openTool === 'pending'} onToggle={() => setOpenTool(openTool === 'pending' ? '' : 'pending')}>
        <div className="permission-copy"><strong>允许写入这份报告？</strong><span>目标位于当前工作区，预计新建 18.6 KB Markdown 文件。</span></div>
        <div className="permission-scope"><span>本次允许</span><span>总是允许 write → reports/**</span></div>
        <div className="permission-actions"><button className="text-button">拒绝</button><button className="secondary-button">总是允许</button><button className="primary-button" onClick={() => setRunning(true)}>允许</button></div>
      </ToolCard>
      <div className="system-marker"><span>⇲</span><button onClick={() => setCompacted(!compacted)}>已压缩 18 条历史消息 · {compacted ? '收起' : '查看摘要'}</button><i></i></div>
      {compacted && <div className="summary-card">已完成文件定位、数据清洗和阈值确认。产出 data/clean/trades.parquet；待完成报告、异常账户表与图表。原始消息仍保存在本地历史中。</div>}
      <div className="assistant-message"><div className="assistant-mark">T</div><p>分析结果已经生成。我标记了 92 个异常账户，并整理了三份产物。你可以在右侧预览，或者让我继续修改。</p></div>
    </div>
  );
}

function ResultsPanel({ open, onClose, selected, setSelected, filter, setFilter }) {
  const visible = filter === '全部' ? resultItems : resultItems.filter((item) => item.type === filter);
  const current = resultItems.find((item) => item.id === selected) || resultItems[0];
  if (!open) return null;
  return (
    <aside className="results-panel" data-screen-label="结果区 产物">
      <div className="panel-header"><strong>结果区</strong><small>{resultItems.length} 个产物</small><button className="icon-button" onClick={onClose}><Icon name="close" size={14} /></button></div>
      <div className="filter-row">{['全部', '文档', '代码', '图片', '数据'].map((item) => <button className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
      <div className="preview-card">
        <div className="preview-head"><span>Markdown</span><code>{current.name}</code><small>只读</small></div>
        <div className="preview-content"><h2>Q2 交易异常分析</h2><p>本次分析覆盖 4–6 月共 3,284,119 条交易记录，识别出 92 个需要复核的账户。</p><hr /><h3>重点发现</h3><p>集中申报主要发生在开盘后 90 秒内，涉及 5 只标的；其中 14 个账户的风险得分高于 0.82。</p><pre>risk_score = 0.82{`\n`}flagged_accounts = 92</pre></div>
        <div className="preview-actions"><button className="secondary-button"><Icon name="external" size={13} />打开文件</button><button className="primary-button">让 Agent 改这份</button></div>
      </div>
      <div className="result-scroll">
        {['本次任务', '更早'].map((group) => <section key={group}><div className="result-label">{group}</div>{visible.filter((item) => item.group === group).map((item) => <button className={`result-item ${selected === item.id ? 'active' : ''}`} key={item.id} onClick={() => setSelected(item.id)}><span className={`result-ext tone-${item.tone}`}>{item.ext}</span><span><strong>{item.name}</strong><small>{item.meta}</small></span><Icon name="chevron" size={12} /></button>)}</section>)}
      </div>
    </aside>
  );
}

function SettingsModal({ onClose, theme, onTheme }) {
  const [tab, setTab] = useState('tools');
  const tabs = [['general', '通用'], ['tools', '工具与权限'], ['mcp', '连接器 MCP'], ['skills', '技能'], ['model', '模型与密钥'], ['appearance', '外观']];
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="settings-modal" data-screen-label="设置中心">
        <aside><div className="settings-title">设置</div>{tabs.map(([id, label]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}{id === 'mcp' && <span>1</span>}</button>)}</aside>
        <main>
          <div className="settings-head"><div><strong>{tabs.find(([id]) => id === tab)[1]}</strong><p>管理 TgBuddy 在当前工作区中的行为与能力。</p></div><button className="icon-button" onClick={onClose}><Icon name="close" size={15} /></button></div>
          {tab === 'tools' && <div className="settings-content"><div className="settings-callout"><Icon name="alert" size={16} /><div><strong>权限按工具与范围组合</strong><p>文件工具按路径，命令按前缀，连接器按方法设置允许、询问或禁止。</p></div></div>{['read · 读取文件', 'write · 写入文件', 'edit · 修改文件', 'bash · 执行命令'].map((item, index) => <div className="setting-row" key={item}><span className="setting-icon">{index === 0 ? 'R' : index === 1 ? 'W' : index === 2 ? 'E' : '$'}</span><span><strong>{item}</strong><small>{index === 0 ? '当前工作区内直接允许' : '每次执行前询问'}</small></span><select defaultValue={index === 0 ? 'allow' : 'ask'}><option value="allow">允许</option><option value="ask">询问</option><option value="deny">禁止</option></select></div>)}</div>}
          {tab === 'mcp' && <div className="settings-content">{connectorOptions.map((item) => <div className="connector-card" key={item.id}><span className={`connector-dot ${item.status}`}></span><div><strong>{item.label}</strong><small>{item.desc}</small></div><button className="secondary-button">{item.status === 'online' ? '配置' : '重新授权'}</button></div>)}<button className="add-card"><Icon name="plus" size={15} />添加 MCP 服务</button></div>}
          {tab === 'skills' && <div className="settings-content">{skillOptions.map((item) => <div className="setting-row" key={item.id}><span className="setting-icon">S</span><span><strong>{item.label}</strong><small>{item.desc}</small></span><button className="switch is-on"><i></i></button></div>)}</div>}
          {tab === 'appearance' && <div className="settings-content"><div className="appearance-grid"><button className={theme === 'light' ? 'active' : ''} onClick={() => theme !== 'light' && onTheme()}><div className="theme-preview light-preview"></div><strong>明亮</strong><small>纸白工作台</small></button><button className={theme === 'dark' ? 'active' : ''} onClick={() => theme !== 'dark' && onTheme()}><div className="theme-preview dark-preview"></div><strong>深色</strong><small>暖炭灰界面</small></button></div></div>}
          {!['tools', 'mcp', 'skills', 'appearance'].includes(tab) && <div className="settings-content"><div className="empty-settings"><Icon name="sliders" size={20} /><strong>该页面将在后续开发中接入</strong><p>原型先确定信息结构、表单密度和交互层级。</p></div></div>}
        </main>
      </div>
    </div>
  );
}

Object.assign(window, { Icon, Sidebar, Composer, ConversationFlow, ResultsPanel, SettingsModal });
