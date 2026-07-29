import typography from '@tailwindcss/typography'

/**
 * 颜色全部映射到 CSS 变量。
 *
 * `<alpha-value>` 占位符让 `bg-background/50` 这类透明度写法生效 ——
 * 这也是变量值要写成裸 HSL 三元组（`0 0% 100%`）而不是 `hsl(...)` 的原因。
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/renderer/**/*.{ts,tsx,html}',
    // streamdown 的类名在它的产物里，不扫的话它用到的 utility 会被 purge 掉
    './node_modules/streamdown/dist/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        /** 主内容区。与 background（侧边栏）刻意不同，用于拉开三栏层次 */
        'content-area': 'hsl(var(--content-area) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        /** 状态色。四态工具卡片、连接状态、风险等级共用 */
        status: {
          pending: 'hsl(var(--status-pending) / <alpha-value>)',
          running: 'hsl(var(--status-running) / <alpha-value>)',
          success: 'hsl(var(--status-success) / <alpha-value>)',
          error: 'hsl(var(--status-error) / <alpha-value>)',
          skill: 'hsl(var(--status-skill) / <alpha-value>)',
        },
        'code-bg': 'hsl(var(--code-bg) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [typography],
}
