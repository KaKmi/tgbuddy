const { useMemo, useState } = React;

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
    check: '<path d="m4 12 5 5L20 6"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="m10.3 3.9-7.8 13.6A1.7 1.7 0 0 0 4 20h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3.4 0Z"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    pin: '<path d="m15 4 5 5-3 2-4 4-1 5-3-3-3-3 5-1 4-4z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 10h5a5 5 0 0 0 5-5"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    retry: '<path d="M20 6v5h-5"/><path d="M18.5 15a7 7 0 1 1-.8-7.8L20 9"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    spark: '<path d="m12 3 1.2 4.2L17 9l-3.8 1.8L12 15l-1.2-4.2L7 9l3.8-1.8z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/>',
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths[name] || paths.file }}></svg>;
}

function ThemeToggle({ theme, onToggle }) {
  return <button className="icon-button" onClick={onToggle} aria-label="切换黑白主题" title="切换黑白主题"><Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} /></button>;
}

function WorkspaceMenu({ workspace, open, onToggle, onPick }) {
  return (
    <div className="workspace-wrap">
      <button className={`workspace-chip ${open ? 'is-open' : ''}`} onClick={onToggle}>
        <span className="workspace-icon"><Icon name="folder" size={14} /></span>
        <span className="workspace-copy"><strong>{workspace.name}</strong><small>{workspace.path}</small></span>
        <Icon name="down" size={12} />
      </button>
      {open && <div className="popover workspace-menu">
        <div className="popover-label">工作区</div>
        {workspaceData.map((item) => <button className={`menu-row ${workspace.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => onPick(item)}><span className="check-slot">{workspace.id === item.id ? '✓' : ''}</span><span className="menu-copy"><strong>{item.name}</strong><small>{item.path}</small></span><span className="menu-meta">{item.meta}</span></button>)}
        <div className="menu-footer"><Icon name="plus" size={13} />选择其他文件夹…</div>
      </div>}
    </div>
  );
}

function Sidebar({ activeSession, onSession, workspace, workspaceOpen, onWorkspaceToggle, onWorkspacePick, query, setQuery, onSettings, theme, onTheme }) {
  const filtered = useMemo(() => sessionGroups.map((group) => ({ ...group, items: group.items.filter((item) => `${item.title}${item.subtitle}`.toLowerCase().includes(query.toLowerCase())) })).filter((group) => group.items.length), [query]);
  return (
    <aside className="sidebar" data-screen-label="侧边栏 会话列表">
      <div className="brand-row"><div className="brand-mark">T</div><div className="brand-name">TgBuddy</div><div className="brand-actions"><ThemeToggle theme={theme} onToggle={onTheme} /><button className="icon-button" onClick={onSettings} aria-label="打开设置"><Icon name="settings" size={15} /></button></div></div>
      <WorkspaceMenu workspace={workspace} open={workspaceOpen} onToggle={onWorkspaceToggle} onPick={onWorkspacePick} />
      <button className="new-session"><Icon name="plus" size={14} /><span>新建任务</span><kbd>Ctrl N</kbd></button>
      <label className="search-box"><Icon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务与产物" /></label>
      <div className="session-scroll">
        {filtered.map((group) => <section className="session-group" key={group.title}><div className="session-label">{group.title}</div>{group.items.map((item) => <button className={`session-item ${activeSession === item.id ? 'active' : ''}`} key={item.id} onClick={() => onSession(item.id)}>
          <div className="session-title-row">{item.status === 'running' && <span className="running-dot"></span>}<strong>{item.title}</strong>{item.pinned && <Icon name="pin" size={11} />}<time>{item.time}</time></div>
          <div className={`session-subtitle ${item.status}`}>{item.subtitle}</div>
          {item.team && <div className="session-team">{item.team.map((mark, index) => <span key={`${mark}-${index}`}>{mark}</span>)}<small>2 运行 · 1 阻塞</small></div>}
        </button>)}</section>)}
      </div>
      <div className="sidebar-footer"><span className="health-dot"></span><span>本地服务正常</span><small>v0.1</small></div>
    </aside>
  );
}

function MenuPopover({ title, hint, items, selected, onPick, footer }) {
  return <div className="popover capability-menu"><div className="popover-heading"><span>{title}</span><small>{hint}</small></div>{items.map((item) => <button className="menu-row" key={item.id} onClick={() => onPick(item)}><span className="check-slot">{selected === item.id || item.on ? '✓' : ''}</span><span className="menu-copy"><strong>{item.label}</strong><small>{item.desc}</small></span>{item.status && <span className={`status-word ${item.status}`}>{item.status === 'online' ? '已连接' : '注意'}</span>}</button>)}{footer && <div className="menu-link">{footer}</div>}</div>;
}

function ContextPanel({ onClose }) {
  return <div className="popover context-panel"><div className="context-title"><strong>53.0%</strong><span>Team 共使用 89.0K / 168.0K</span><button className="icon-button" onClick={onClose}><Icon name="close" size={14} /></button></div><div className="context-bar">{contextRows.map((row) => <span key={row.label} className={`bar-${row.tone}`} style={{ width: `${row.width}%` }}></span>)}</div><div className="context-list">{contextRows.map((row) => <div className="context-row" key={row.label}><span className={`legend legend-${row.tone}`}></span><span>{row.label}</span><code>{row.value}</code></div>)}</div><div className="context-divider"></div><div className="threshold-title"><span>单 Agent 自动压缩阈值</span><code>85%</code></div><div className="threshold"><span className="threshold-fill"></span><i className="threshold-now"></i><b></b></div><p className="context-help">成员独立压缩，不影响 Team 共享摘要；主管只接收交接摘要和最终产物。</p><div className="context-actions"><button className="secondary-button">压缩主管上下文</button><button className="text-button">查看各成员</button></div></div>;
}

function Composer({ menu, setMenu, mode, setMode, profile, setProfile, contextOpen, setContextOpen, running, onToggleRunning }) {
  const [draft, setDraft] = useState('');
  const menus = {
    mode: { title: '权限模式', hint: 'Team 级', items: modeOptions, selected: mode, onPick: (item) => { setMode(item.id); setMenu(null); } },
    team: { title: 'Agent Team', hint: '选择团队模板', items: teamProfiles, selected: profile, onPick: (item) => { setProfile(item.id); setMenu(null); } },
    skills: { title: '共享技能', hint: '3 个已启用', items: skillOptions, selected: '', onPick: () => {}, footer: '按成员配置能力…' },
    connectors: { title: '共享连接器', hint: '2 / 3 在线', items: connectorOptions, selected: '', onPick: () => {}, footer: '管理 Team 连接器…' },
  };
  const selectedMode = modeOptions.find((item) => item.id === mode);
  const selectedProfile = teamProfiles.find((item) => item.id === profile);
  return <div className="composer-shell"><div className="composer team-composer" data-screen-label="Agent Team 输入区">
    <div className="composer-toolbar">
      <button className="composer-chip" onClick={() => setMenu(menu === 'mode' ? null : 'mode')}><span>模式</span>{selectedMode.label}<Icon name="down" size={10} /></button>
      <button className="composer-chip team-chip" onClick={() => setMenu(menu === 'team' ? null : 'team')}><Icon name="users" size={12} />{selectedProfile.label}<Icon name="down" size={10} /></button>
      <button className="composer-chip" onClick={() => setMenu(menu === 'skills' ? null : 'skills')}><span>技能</span>共享 3<Icon name="down" size={10} /></button>
      <button className="composer-chip" onClick={() => setMenu(menu === 'connectors' ? null : 'connectors')}><span>连接器</span>共享 2<Icon name="down" size={10} /></button>
      <div className="composer-right"><button className="model-chip">按角色分配模型<Icon name="down" size={10} /></button><button className="context-chip" onClick={() => { setContextOpen(!contextOpen); setMenu(null); }}><i></i>53.0%</button></div>
    </div>
    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="给主管 Agent 补充要求，或让它调整分工…" />
    <div className="composer-footer"><span>主管会拆解任务；只有关键委派、阻塞和结果会进入对话流</span><div className="send-actions">{running && <button className="stop-button" onClick={onToggleRunning}><Icon name="stop" size={12} />停止全部</button>}<button className="send-button" onClick={() => draft.trim() && setDraft('')}><Icon name="send" size={15} /></button></div></div>
    {menu && menus[menu] && <MenuPopover {...menus[menu]} />}{contextOpen && <ContextPanel onClose={() => setContextOpen(false)} />}
  </div></div>;
}

function AgentMini({ agent, onClick }) {
  return <button className={`agent-mini tone-${agent.tone}`} onClick={() => onClick(agent.id)}><span className="agent-avatar">{agent.mark}</span><span><strong>{agent.name.replace(' Agent', '')}</strong><small>{agent.statusText}</small></span><i className={`agent-status status-${agent.status}`}></i></button>;
}

function DelegationCard({ onOpenAgent }) {
  return <div className="delegation-card motion-enter"><div className="delegation-head"><span className="delegation-icon"><Icon name="branch" size={15} /></span><span><strong>已创建风控分析 Team</strong><small>主管把任务拆成 4 条并行工作流</small></span><button className="text-button">调整分工</button></div><div className="delegation-flow">{teamAgents.slice(1).map((agent, index) => <React.Fragment key={agent.id}><AgentMini agent={agent} onClick={onOpenAgent} />{index < 3 && <span className="flow-line"></span>}</React.Fragment>)}</div></div>;
}

function TeamActivity({ agentId, icon, title, meta, tone, children, onOpenAgent }) {
  const agent = teamAgents.find((item) => item.id === agentId);
  return <button className={`team-activity activity-${tone} motion-enter`} onClick={() => onOpenAgent(agentId)}><span className={`agent-avatar tone-${agent.tone}`}>{agent.mark}</span><span className="activity-copy"><span><strong>{agent.name}</strong><small>{meta}</small></span><b>{title}</b>{children}</span><span className="activity-symbol">{icon === 'spinner' ? <i className="spinner"></i> : <Icon name={icon} size={14} />}</span></button>;
}

function ConversationFlow({ onOpenAgent, onOpenPermissions, reassigned }) {
  const [delegationOpen, setDelegationOpen] = useState(true);
  return <div className="conversation-flow team-flow">
    <div className="user-message">分析 data/trades 下 Q2 的交易记录，找出异常账户，最后给我一份经过审查的报告和图表。</div>
    <div className="assistant-message"><div className="assistant-mark">T</div><p>这项任务包含数据处理、图表、写作和事实核查。我会建立一个 Agent Team 并行处理，由我负责依赖协调和最终汇总。</p></div>
    <div className="system-marker team-marker"><span><Icon name="users" size={12} /></span><button onClick={() => setDelegationOpen(!delegationOpen)}>风控分析 Team · 5 个成员 · {delegationOpen ? '收起分工' : '查看分工'}</button><i></i></div>
    {delegationOpen && <DelegationCard onOpenAgent={onOpenAgent} />}
    <TeamActivity agentId="data" icon="spinner" title="正在计算账户风险分数" meta="执行中 · 68%" tone="running" onOpenAgent={onOpenAgent}><span className="activity-progress"><i style={{ width: '68%' }}></i></span></TeamActivity>
    <TeamActivity agentId="chart" icon="check" title="已生成 risk-distribution.png" meta="已完成 · 通过检查" tone="done" onOpenAgent={onOpenAgent}><small>主管已收到产物摘要，原始文件进入右侧成果区。</small></TeamActivity>
    <TeamActivity agentId="report" icon="clock" title="等待数据 Agent 交付异常账户表" meta="等待依赖" tone="waiting" onOpenAgent={onOpenAgent}><small>等待不会占用模型调用；依赖满足后自动继续。</small></TeamActivity>
    <TeamActivity agentId="review" icon={reassigned ? 'retry' : 'alert'} title={reassigned ? '已重派引用核查，正在恢复执行' : '审查暂停：报告缺少 1 条数据引用'} meta={reassigned ? '已重派 · 预计 32 秒' : '需要处理'} tone={reassigned ? 'running' : 'blocked'} onOpenAgent={onOpenAgent}><small>{reassigned ? '主管已附带缺失引用和相关数据片段。' : '可以重试、补充上下文或交给其他成员。'}</small></TeamActivity>
    <div className="assistant-message"><div className="assistant-mark">T</div><p>图表已经完成；数据分析还需约 46 秒。当前有两项写入与命令权限等待处理，我会在授权后继续推进报告和审查。</p></div>
    <button className="permission-inline" onClick={onOpenPermissions}><span><Icon name="shield" size={14} /></span><strong>2 个 Team 授权请求</strong><small>来自数据 Agent 和报告 Agent</small><Icon name="chevron" size={13} /></button>
  </div>;
}

function ResultView({ selected, setSelected, filter, setFilter }) {
  const visible = filter === '全部' ? resultItems : resultItems.filter((item) => item.type === filter);
  const current = resultItems.find((item) => item.id === selected) || resultItems[0];
  return <div className="panel-view panel-view-enter"><div className="filter-row">{['全部', '文档', '代码', '图片', '数据'].map((item) => <button className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="preview-card"><div className="preview-head"><span>Markdown</span><code>{current.name}</code><small>{current.review}</small></div><div className="preview-owner"><span className="agent-avatar tone-blue">文</span><span><strong>{current.owner}</strong><small>产物归属与审查链已保留</small></span></div><div className="preview-content"><h2>Q2 交易异常分析</h2><p>本次分析覆盖 4–6 月共 3,284,119 条交易记录，识别出 92 个需要复核的账户。</p><hr /><h3>重点发现</h3><p>集中申报主要发生在开盘后 90 秒内，涉及 5 只标的；其中 14 个账户的风险得分高于 0.82。</p><pre>risk_score = 0.82{`\n`}flagged_accounts = 92</pre></div><div className="preview-actions"><button className="secondary-button"><Icon name="external" size={13} />打开文件</button><button className="primary-button">让主管协调修改</button></div></div><div className="result-scroll">{['本次任务', '更早'].map((group) => <section key={group}><div className="result-label">{group}</div>{visible.filter((item) => item.group === group).map((item) => <button className={`result-item ${selected === item.id ? 'active' : ''}`} key={item.id} onClick={() => setSelected(item.id)}><span className={`result-ext tone-${item.tone}`}>{item.ext}</span><span><strong>{item.name}</strong><small>{item.meta}</small></span><Icon name="chevron" size={12} /></button>)}</section>)}</div></div>;
}

function StatusGlyph({ status }) {
  if (status === 'running') return <i className="spinner"></i>;
  if (status === 'done') return <Icon name="check" size={13} />;
  if (status === 'blocked') return <Icon name="alert" size={13} />;
  if (status === 'waiting') return <Icon name="clock" size={13} />;
  return <span className="empty-dot"></span>;
}

function TaskView({ onOpenAgent, reassigned }) {
  return <div className="team-scroll panel-view-enter"><div className="team-summary"><div><strong>任务依赖</strong><small>3 完成 · 2 执行 · 1 等待 · 1 阻塞</small></div><span className="team-percent">54%</span></div><div className="team-progress"><i></i></div><div className="task-tree">{teamTasks.map((task) => { const effectiveStatus = task.id === 'review' && reassigned ? 'running' : task.status; return <button className={`task-row task-${effectiveStatus} depth-${task.depth}`} key={task.id} onClick={() => onOpenAgent(task.agentId)}><span className="task-rail"></span><span className="task-glyph"><StatusGlyph status={effectiveStatus} /></span><span className="task-copy"><strong>{task.title}</strong><small>{task.owner} · {task.id === 'review' && reassigned ? '已重派 · 正在恢复' : task.meta}</small></span><Icon name="chevron" size={12} /></button>; })}</div></div>;
}

function MembersView({ onOpenAgent, reassigned }) {
  return <div className="team-scroll member-list panel-view-enter">{teamAgents.map((agent) => { const status = agent.id === 'review' && reassigned ? 'running' : agent.status; return <button className="member-card" key={agent.id} onClick={() => onOpenAgent(agent.id)}><span className={`agent-avatar large tone-${agent.tone}`}>{agent.mark}</span><span className="member-copy"><span><strong>{agent.name}</strong><em className={`status-label status-${status}`}>{agent.id === 'review' && reassigned ? '已重派' : agent.statusText}</em></span><small>{agent.role}</small><b>{agent.task}</b><span className="member-progress"><i style={{ width: `${agent.progress}%` }}></i></span></span><span className="member-meta"><code>{agent.tokens}</code><small>{agent.model}</small></span></button>; })}</div>;
}

function PermissionView({ allowed, onAllow, onAllowAll }) {
  const pending = permissionRequests.filter((item) => !allowed.includes(item.id));
  return <div className="team-scroll permission-view panel-view-enter"><div className="permission-summary"><span><Icon name="shield" size={15} /></span><div><strong>{pending.length ? `${pending.length} 个请求等待处理` : '授权队列已清空'}</strong><small>{pending.length ? '相同风险级别可以批量处理' : '成员会自动恢复其后续任务'}</small></div>{pending.length > 1 && <button className="secondary-button" onClick={onAllowAll}>全部允许</button>}</div>{pending.map((request) => <div className="permission-request" key={request.id}><div className="permission-agent"><span className="agent-avatar tone-blue">{request.mark}</span><span><strong>{request.agent}</strong><small>{request.risk}</small></span></div><div className="permission-command"><code>{request.tool}</code><span>{request.target}</span></div><div className="permission-buttons"><button className="text-button">拒绝</button><button className="secondary-button">始终允许该成员</button><button className="primary-button" onClick={() => onAllow(request.id)}>允许</button></div></div>)}{!pending.length && <div className="permission-empty"><span><Icon name="check" size={18} /></span><strong>所有成员已恢复执行</strong><p>授权规则按 Team、成员和工具范围分别记录。</p></div>}</div>;
}

function AgentDetail({ agentId, onClose, onReassign, reassigned }) {
  const agent = teamAgents.find((item) => item.id === agentId) || teamAgents[0];
  const isReview = agent.id === 'review';
  return <div className="agent-detail"><div className="agent-detail-head"><button className="icon-button back-button" onClick={onClose}><Icon name="chevron" size={14} /></button><span className={`agent-avatar tone-${agent.tone}`}>{agent.mark}</span><span><strong>{agent.name}</strong><small>{agent.role}</small></span></div><div className="agent-detail-scroll"><div className="agent-hero"><div><span className={`status-label status-${isReview && reassigned ? 'running' : agent.status}`}>{isReview && reassigned ? '已重派执行' : agent.statusText}</span><strong>{isReview && reassigned ? '正在恢复引用核查' : agent.task}</strong></div><span className="agent-score">{isReview && reassigned ? 48 : agent.progress}%</span></div><div className="member-progress large"><i style={{ width: `${isReview && reassigned ? 48 : agent.progress}%` }}></i></div><div className="detail-grid"><div><small>模型</small><strong>{agent.model}</strong></div><div><small>上下文</small><strong>{agent.tokens}</strong></div><div><small>工具调用</small><strong>{agent.id === 'data' ? '12 次' : '6 次'}</strong></div><div><small>产物</small><strong>{agent.status === 'done' ? '1 个' : '0 个'}</strong></div></div><section className="detail-section"><div className="detail-title"><strong>最近活动</strong><small>仅展示关键事件</small></div><div className="timeline-item done"><span></span><div><strong>接收主管委派</strong><small>包含任务说明、约束和 4.2K 共享摘要</small></div><time>1m</time></div><div className="timeline-item running"><span></span><div><strong>{isReview ? '检查报告证据引用' : '执行当前子任务'}</strong><small>{isReview ? '发现报告第 3 节缺少数据来源' : agent.task}</small></div><time>刚刚</time></div></section>{isReview && <div className={`recovery-card ${reassigned ? 'resolved' : ''}`}><span><Icon name={reassigned ? 'check' : 'alert'} size={16} /></span><div><strong>{reassigned ? '已交给备用审查成员' : '这个成员需要处理'}</strong><p>{reassigned ? '主管已附带缺失引用、相关数据片段和原审查记录。' : '可沿用当前上下文重试，或把任务和摘要交给备用成员。'}</p></div></div>}</div><div className="agent-detail-actions">{isReview && !reassigned && <><button className="secondary-button"><Icon name="retry" size={13} />原成员重试</button><button className="primary-button" onClick={onReassign}><Icon name="users" size={13} />重派任务</button></>} {!isReview && <><button className="secondary-button"><Icon name="pause" size={13} />暂停成员</button><button className="primary-button">给主管发指令</button></>}</div></div>;
}

function WorkbenchPanel({ open, onClose, view, setView, teamTab, setTeamTab, selectedResult, setSelectedResult, filter, setFilter, selectedAgent, setSelectedAgent, allowed, onAllow, onAllowAll, reassigned, onReassign }) {
  if (!open) return null;
  return <aside className="results-panel team-workbench" data-screen-label="成果与 Agent Team 工作台"><div className="panel-header workbench-head"><div className="workbench-switch"><button className={view === 'results' ? 'active' : ''} onClick={() => setView('results')}>成果 <small>4</small></button><button className={view === 'team' ? 'active' : ''} onClick={() => setView('team')}>团队 <small>5</small></button><i className={view === 'team' ? 'to-team' : ''}></i></div><button className="icon-button" onClick={onClose}><Icon name="close" size={14} /></button></div>{view === 'results' ? <ResultView selected={selectedResult} setSelected={setSelectedResult} filter={filter} setFilter={setFilter} /> : <div className="team-panel"><div className="team-panel-head"><div className="team-title"><span className="team-stack">{teamAgents.slice(0,4).map((agent, index) => <i key={agent.id} style={{ zIndex: 5-index }}>{agent.mark}</i>)}</span><span><strong>风控分析 Team</strong><small>2 运行 · 1 等待 · 1 阻塞</small></span></div><div className="team-controls"><button className="icon-button" title="暂停全部"><Icon name="pause" size={13} /></button><button className="icon-button" title="更多"><Icon name="settings" size={13} /></button></div></div><div className="team-tabs">{[['tasks','任务'],['members','成员'],['permissions','授权']].map(([id,label]) => <button className={teamTab === id ? 'active' : ''} key={id} onClick={() => { setTeamTab(id); setSelectedAgent(null); }}>{label}{id === 'permissions' && permissionRequests.length - allowed.length > 0 && <span>{permissionRequests.length - allowed.length}</span>}</button>)}</div>{teamTab === 'tasks' && <TaskView onOpenAgent={setSelectedAgent} reassigned={reassigned} />}{teamTab === 'members' && <MembersView onOpenAgent={setSelectedAgent} reassigned={reassigned} />}{teamTab === 'permissions' && <PermissionView allowed={allowed} onAllow={onAllow} onAllowAll={onAllowAll} />}{selectedAgent && <AgentDetail agentId={selectedAgent} onClose={() => setSelectedAgent(null)} onReassign={onReassign} reassigned={reassigned} />}</div>}</aside>;
}

function SettingsModal({ onClose, theme, onTheme }) {
  const [tab, setTab] = useState('team');
  const tabs = [['general', '通用'], ['team', 'Agent Team'], ['tools', '工具与权限'], ['mcp', '连接器 MCP'], ['skills', '技能'], ['appearance', '外观']];
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="settings-modal" data-screen-label="设置中心"><aside><div className="settings-title">设置</div>{tabs.map(([id,label]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}{id === 'mcp' && <span>1</span>}</button>)}</aside><main><div className="settings-head"><div><strong>{tabs.find(([id]) => id === tab)[1]}</strong><p>管理 TgBuddy 在当前工作区中的行为与能力。</p></div><button className="icon-button" onClick={onClose}><Icon name="close" size={15} /></button></div>{tab === 'team' && <div className="settings-content"><div className="settings-callout"><Icon name="users" size={16} /><div><strong>主管负责边界，成员负责专业执行</strong><p>限制最大并行数，避免 Token、权限请求和错误同时失控。</p></div></div>{[['最大并行成员','4 个'],['失败后自动重试','1 次'],['成员默认上下文','独立'],['完成后自动审查','已开启']].map(([label,value],index) => <div className="setting-row" key={label}><span className="setting-icon">{index+1}</span><span><strong>{label}</strong><small>{index === 0 ? '不包含主管 Agent' : '对新建 Team 生效'}</small></span><button className={index === 3 ? 'switch is-on' : 'secondary-button'}>{index === 3 ? <i></i> : value}</button></div>)}</div>}{tab === 'tools' && <div className="settings-content"><div className="settings-callout"><Icon name="shield" size={16} /><div><strong>权限可按 Team 或成员授权</strong><p>批量授权仅合并风险级别相同、范围相近的请求。</p></div></div>{['read · 读取文件','write · 写入文件','bash · 执行命令'].map((item,index) => <div className="setting-row" key={item}><span className="setting-icon">{index === 0 ? 'R' : index === 1 ? 'W' : '$'}</span><span><strong>{item}</strong><small>{index === 0 ? '工作区内直接允许' : '合并进入授权队列'}</small></span><select defaultValue={index === 0 ? 'allow' : 'ask'}><option value="allow">允许</option><option value="ask">询问</option><option value="deny">禁止</option></select></div>)}</div>}{tab === 'mcp' && <div className="settings-content">{connectorOptions.map((item) => <div className="connector-card" key={item.id}><span className={`connector-dot ${item.status}`}></span><div><strong>{item.label}</strong><small>{item.desc}</small></div><button className="secondary-button">{item.status === 'online' ? '配置' : '重新授权'}</button></div>)}</div>}{tab === 'skills' && <div className="settings-content">{skillOptions.map((item) => <div className="setting-row" key={item.id}><span className="setting-icon">S</span><span><strong>{item.label}</strong><small>{item.desc}</small></span><button className="switch is-on"><i></i></button></div>)}</div>}{tab === 'appearance' && <div className="settings-content"><div className="appearance-grid"><button className={theme === 'light' ? 'active' : ''} onClick={() => theme !== 'light' && onTheme()}><div className="theme-preview light-preview"></div><strong>明亮</strong><small>纸白工作台</small></button><button className={theme === 'dark' ? 'active' : ''} onClick={() => theme !== 'dark' && onTheme()}><div className="theme-preview dark-preview"></div><strong>深色</strong><small>暖炭灰界面</small></button></div></div>}{!['team','tools','mcp','skills','appearance'].includes(tab) && <div className="settings-content"><div className="empty-settings"><Icon name="settings" size={20} /><strong>通用设置</strong><p>语言、通知和默认工作区将在这里管理。</p></div></div>}</main></div></div>;
}

Object.assign(window, { Icon, Sidebar, Composer, ConversationFlow, WorkbenchPanel, SettingsModal });
