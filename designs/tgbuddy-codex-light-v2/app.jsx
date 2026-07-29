function App() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem('tgbuddy-theme') || 'light');
  const [workspace, setWorkspace] = React.useState(workspaceData[0]);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeSession, setActiveSession] = React.useState('risk-q2');
  const [resultsOpen, setResultsOpen] = React.useState(true);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [menu, setMenu] = React.useState(null);
  const [contextOpen, setContextOpen] = React.useState(false);
  const [mode, setMode] = React.useState('auto');
  const [expert, setExpert] = React.useState('none');
  const [running, setRunning] = React.useState(true);
  const [selectedResult, setSelectedResult] = React.useState('report');
  const [filter, setFilter] = React.useState('全部');

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tgbuddy-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((value) => value === 'light' ? 'dark' : 'light');

  return (
    <div className="prototype-page">
      <div className="prototype-note"><span>V2 设计方向</span><strong>Codex 风格的纸白工作台，默认明亮并支持深色切换；功能结构以完整 Agent 桌面端为目标。</strong></div>
      <div className="app-window" data-screen-label="TgBuddy 主窗口 Codex Light v2">
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
        <main className="chat-pane" data-screen-label="对话区">
          <header className="chat-header">
            <div><strong>Q2 交易异常分析</strong>{running && <span className="run-pill"><i></i>执行中 · 1m 12s</span>}</div>
            <button className={`results-toggle ${resultsOpen ? 'active' : ''}`} onClick={() => setResultsOpen(!resultsOpen)}><Icon name="panel" size={14} />结果区</button>
          </header>
          <div className="chat-scroll"><ConversationFlow running={running} setRunning={setRunning} /></div>
          <div className="pending-toast"><i></i><span>1 个授权请求等待处理</span><button>跳到该处</button></div>
          <Composer menu={menu} setMenu={setMenu} mode={mode} setMode={setMode} expert={expert} setExpert={setExpert} contextOpen={contextOpen} setContextOpen={setContextOpen} running={running} onToggleRunning={() => setRunning(false)} />
        </main>
        <ResultsPanel open={resultsOpen} onClose={() => setResultsOpen(false)} selected={selectedResult} setSelected={setSelectedResult} filter={filter} setFilter={setFilter} />
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} theme={theme} onTheme={toggleTheme} />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
