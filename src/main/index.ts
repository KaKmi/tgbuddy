/**
 * Electron 主进程入口。
 */

import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { registerIpc } from './ipc.ts'
import { ensureDataDir } from './channel-store.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged
const DEV_URL = 'http://localhost:5173'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    // 深色底，避免加载时白闪
    backgroundColor: '#111111',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev) {
    // dev 模式下 vite 可能还没起来，重试几次
    void loadDevUrlWithRetry(mainWindow)
    mainWindow.webContents.openDevTools({ mode: 'right' })
  } else {
    void mainWindow.loadFile(join(__dirname, 'renderer/index.html'))
  }
}

async function loadDevUrlWithRetry(win: BrowserWindow, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (win.isDestroyed()) return
    try {
      await win.loadURL(DEV_URL)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  console.error(`[main] 连不上 vite dev server（${DEV_URL}），请确认 bun run dev:vite 在跑`)
}

app.whenReady().then(() => {
  ensureDataDir()
  registerIpc(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
