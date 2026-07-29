import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import { App } from './App.tsx'
import { useGlobalAgentListeners } from './hooks/useGlobalAgentListeners.ts'
import './styles.css'

/**
 * ★ 全局监听挂在这一层，和 App 平级、永不卸载。
 *
 * 放进 App 里也能跑，但等以后有了路由/多视图切换，
 * 组件一卸载流式就断了。这个位置是刻意的。
 */
function AgentListeners() {
  useGlobalAgentListeners()
  return null
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider>
      <AgentListeners />
      <App />
    </Provider>
  </React.StrictMode>,
)
