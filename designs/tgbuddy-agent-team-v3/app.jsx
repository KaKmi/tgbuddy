function App() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem('tgbuddy-theme') || 'light');
  const [workspace, setWorkspace] = React.useState(workspaceData[0]);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeSession, setActiveSession] = React.useState('risk-q2');
  const [workbenchOpen, setWorkbenchOpen] = React.useState(true);
  const [workbenchView, setWorkbenchView] = React.useState('team');
  const [teamTab, setTeamTab] = React.useState('tasks');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [menu, setMenu] = React.useState(null);
  const [contextOpen, setContextOpen] = React.useState(false);
  const [mode, setMode] = React.useState('auto');
  const [profile, setProfile] = React.useState('risk');
  const [running, setRunning] = React.useState(true);
  const [selectedResult, setSelectedResult] = React.useState('report');
  const [filter, setFilter] = React.useState('全部');
  const [selectedAgent, setSelectedAgent] = React.useState(null);
  const [allowedPermissions, setAllowedPermissions] = React.useState([]);
  const [reassigned, setReassigned] = React.useState(false);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tgbuddy-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((value) => value === 'light' ? 'dark' : 'light');
  const openTeamTab = (tab) => {
    setWorkbenchOpen(true);
    setWorkbenchView('team');
    setTeamTab(tab);
    setSelectedAgent(null);
  };
  const openAgent = (agentId) => {
    setWorkbenchOpen(true);
    setWorkbenchView('team');
    setSelectedAgent(agentId);
  };
  const allowPermission = (id) => setAllowedPermissions((items) => items.includes(id) ? items : [...items, id]);

  return (
    <div className="prototype-page">
      <div className="prototype-note"><span>V3 · Agent Team</span><strong>中间看主管叙事，右侧管理任务、成员和授权；动效参考成熟桌面端的短促、克制状态转换。</strong></div>
      <div className="app-window" data-screen-label="TgBuddy Agent Team v3">
        <Sidebar
          activeSession={activeSession}
          onSession={setActiveSession}
          workspace={workspace}
          workspaceOpen={workspaceOpen}
          onWorkspaceToggle={() => setWorkspaceOpen(!workspaceOpen)}
          onWorkspacePick={(item) => { setWorkspace(item); setWorkspaceOpen(false); }}
          query={query}
          setQuery={setQuery}
          onSettings={() => setSettingsOpen(true)}
          theme={theme}
          onTheme={toggleTheme}
        />
        <main className="chat-pane" data-screen-label="主管 Agent 对话区">
          <header className="chat-header team-chat-header">
            <div><strong>Q2 交易异常分析</strong>{running && <span className="run-pill"><i></i>Team 执行中 · 2m 18s</span>}<span className="header-agent-stack">{teamAgents.slice(0,4).map((agent) => <i key={agent.id}>{agent.mark}</i>)}<small>+1</small></span></div>
            <button className={`results-toggle ${workbenchOpen ? 'active' : ''}`} onClick={() => setWorkbenchOpen(!workbenchOpen)}><Icon name="panel" size={14} />工作台</button>
          </header>
          <div className="chat-scroll"><ConversationFlow onOpenAgent={openAgent} onOpenPermissions={() => openTeamTab('permissions')} reassigned={reassigned} /></div>
          {permissionRequests.length - allowedPermissions.length > 0 && <div className="pending-toast" onClick={() => openTeamTab('permissions')}><i></i><span>{permissionRequests.length - allowedPermissions.length} 个 Team 授权请求</span><button>打开队列</button></div>}
          <Composer menu={menu} setMenu={setMenu} mode={mode} setMode={setMode} profile={profile} setProfile={setProfile} contextOpen={contextOpen} setContextOpen={setContextOpen} running={running} onToggleRunning={() => setRunning(false)} />
        </main>
        <WorkbenchPanel
          open={workbenchOpen}
          onClose={() => setWorkbenchOpen(false)}
          view={workbenchView}
          setView={(view) => { setWorkbenchView(view); setSelectedAgent(null); }}
          teamTab={teamTab}
          setTeamTab={setTeamTab}
          selectedResult={selectedResult}
          setSelectedResult={setSelectedResult}
          filter={filter}
          setFilter={setFilter}
          selectedAgent={selectedAgent}
          setSelectedAgent={setSelectedAgent}
          allowed={allowedPermissions}
          onAllow={allowPermission}
          onAllowAll={() => setAllowedPermissions(permissionRequests.map((item) => item.id))}
          reassigned={reassigned}
          onReassign={() => setReassigned(true)}
        />
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} theme={theme} onTheme={toggleTheme} />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
