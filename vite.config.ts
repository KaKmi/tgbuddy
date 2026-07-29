import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './', // 打包后用 file:// 加载，必须是相对路径
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src/renderer') },
  },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
})
