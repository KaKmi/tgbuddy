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
  const [viewerFile, setViewerFile] = React.useState(null);
  const [flowState, setFlowState] = React.useState('main');
  const [titleState, setTitleState] = React.useState('idle');

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tgbuddy-theme', theme);
  }, [theme]);

  React.useEffect(() => {
    if (flowState !== 'title') { setTitleState('idle'); return undefined; }
    setTitleState('generating');
    const timer = window.setTimeout(() => setTitleState('ready'), 1400);
    return () => window.clearTimeout(timer);
  }, [flowState]);

  const toggleTheme = () => setTheme((value) => value === 'light' ? 'dark' : 'light');
  const flowOptions = [['main','主任务'],['plan','计划审批'],['ask','结构化提问'],['danger','高危授权'],['missing','目录丢失'],['title','标题生成']];

  return <div className="prototype-page">
    <div className="prototype-note"><div><span>V3 · 轻量完整 UX</span><strong>能力按需出现；Skill/MCP 改为应用级，不占 Composer 主路径。</strong></div><nav aria-label="原型状态">{flowOptions.map(([id,label]) => <button className={flowState === id ? 'active' : ''} key={id} onClick={() => { setFlowState(id); if(id === 'danger') setRunning(false); }}>{label}</button>)}</nav></div>
    <div className="app-window" data-screen-label="TgBuddy 主窗口 Codex Light v3">
      <Sidebar activeSession={activeSession} onSession={setActiveSession} workspace={workspace} workspaceOpen={workspaceOpen} onWorkspaceToggle={() => setWorkspaceOpen(!workspaceOpen)} onWorkspacePick={(item) => { setWorkspace(item); setWorkspaceOpen(false); }} query={query} setQuery={setQuery} onSettings={() => setSettingsOpen(true)} theme={theme} onTheme={toggleTheme} titleState={titleState} />
      <main className="chat-pane" data-screen-label="对话区"><header className="chat-header"><div><strong>{flowState === 'title' ? (titleState === 'ready' ? '分析销售退款异常' : '新会话') : 'Q2 交易异常分析'}</strong>{running && flowState === 'main' && <span className="run-pill"><i></i>执行中 · 1m 12s</span>}</div><button className={`results-toggle ${resultsOpen ? 'active' : ''}`} onClick={() => setResultsOpen(!resultsOpen)}><Icon name="panel" size={14} />结果与文件</button></header>
        <div className="chat-scroll"><ConversationFlow running={running} setRunning={setRunning} flowState={flowState === 'title' ? 'main' : flowState} /></div>
        {flowState === 'main' && <div className="pending-toast"><i></i><span>1 个授权请求等待处理</span><button>跳到该处</button></div>}
        <Composer menu={menu} setMenu={setMenu} mode={mode} setMode={setMode} expert={expert} setExpert={setExpert} contextOpen={contextOpen} setContextOpen={setContextOpen} running={running} onToggleRunning={() => setRunning(false)} />
      </main>
      <ResultsPanel open={resultsOpen} onClose={() => setResultsOpen(false)} selected={selectedResult} setSelected={setSelectedResult} filter={filter} setFilter={setFilter} onViewFile={setViewerFile} />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} theme={theme} onTheme={toggleTheme} />}
      {viewerFile && <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />}
      {flowState === 'danger' && <DangerPermissionModal onClose={() => setFlowState('main')} />}
    </div>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
