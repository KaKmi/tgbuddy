# Design System

TgBuddy 的视觉与组件基线。

**用法**：连同 [04-给设计的prompt.md](04-给设计的prompt.md) 一起交给设计。这份文档回答"用什么组件库、什么颜色、什么间距"，那份回答"设计哪些屏幕、要解决什么问题"。

---

## 1. 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | React | 18.3 |
| 样式 | Tailwind CSS | 3.4 |
| 组件基础 | **shadcn/ui**（`new-york` 风格） | — |
| 无障碍原语 | Radix UI | 各包 ^1.x / ^2.x |
| 图标 | **lucide-react** | ^0.460 |
| 变体管理 | class-variance-authority + clsx + tailwind-merge | — |
| 动画 | tailwindcss-animate | ^1.0.7 |
| 排版插件 | @tailwindcss/typography | ^0.5 |
| 命令面板 | cmdk | ^1.1 |
| Toast | sonner | ^2.0 |
| 富文本输入 | TipTap | 3.19 |
| Markdown 渲染 | react-markdown + rehype-katex | 10.1 / ^7 |
| 代码高亮 | Shiki | 3.22 |

`components.json` 配置：

```json
{
  "style": "new-york",
  "tailwind": { "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "aliases": { "ui": "@/components/ui", "utils": "@/lib/utils" }
}
```

> **基色是 `neutral`，不是 `slate` / `zinc`。** 这决定了整套灰阶偏纯中性、不带蓝调。

---

## 2. 颜色系统

**全部用 CSS 变量 + HSL 三元组**（不带 `hsl()` 包裹），这样 Tailwind 能做 `/<alpha-value>` 透明度运算：

```css
--background: 0 0% 100%;
```

```js
// tailwind.config.js
background: 'hsl(var(--background) / <alpha-value>)'
```

### 2.1 语义色板（默认亮/暗）

| 变量 | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--background` | `0 0% 100%` | `0 0% 7%` | 侧边栏 / 全局底色 |
| `--content-area` | `0 0% 100%` | `0 0% 7%` | **主内容区**（与侧边栏区分的关键） |
| `--foreground` | `0 0% 3.9%` | `0 0% 98%` | 正文 |
| `--muted` | `0 0% 96.1%` | `0 0% 14.9%` | 次要背景 |
| `--muted-foreground` | `0 0% 45.1%` | `0 0% 63.9%` | 次要文字 |
| `--border` | `0 0% 89.8%` | `0 0% 14.9%` | 边框 |
| `--input` | `0 0% 89.8%` | `0 0% 14.9%` | 输入框边框 |
| `--ring` | `0 0% 3.9%` | `0 0% 83.1%` | 聚焦环 |
| `--primary` | `0 0% 9%` | `0 0% 98%` | 主按钮（**默认主题是黑白反色，不是彩色**） |
| `--secondary` | `0 0% 96.1%` | `0 0% 14.9%` | 次要按钮 |
| `--accent` | `0 0% 96.1%` | `0 0% 40%` | hover 强调 |
| `--destructive` | `0 84.2% 60.2%` | `0 55% 45%` | 危险操作 |
| `--card` | `0 0% 100%` | `0 0% 7%` | 卡片 |
| `--popover` | `0 0% 100%` | `0 0% 7%` | 弹出层 |
| `--dialog` | `0 0% 100%` | `0 0% 12%` | **设置弹窗：暗色下比背景更亮，制造悬浮感** |

### 2.2 专用色

| 变量 | 值 | 说明 |
|---|---|---|
| `--tooltip` / `-foreground` / `-muted` | `0 0% 15%` / `0 0% 98%` / `0 0% 75%` | 毛玻璃 Tooltip：深色半透明 + 白字。**亮暗模式都是深色**，不跟随主题 |
| `--code-bg` | `210 13% 12%`（#1e2228） | 代码块背景，**亮暗模式一致** |
| `--dashed-border` / `-hover` | `0 0% 9% / 0.35` → `0.50` | 虚线边框（新建会话、搜索按钮这类"待填充"控件） |
| `--stop-hover-bg` | `hsla(0, 80%, 60%, 0.12)` | 停止按钮的 hover 底色 |
| `--md-preview-font-size` | `15px` | Markdown 正文字号，用户可调 |

### 2.3 主题（`darkMode: 'class'`）

默认亮/暗主题之外，后续可以通过根元素的 `.theme-*` 类扩展彩色主题：

| 主题 | 类名 | 主色 | 内容区背景 | 气质 |
|---|---|---|---|---|
| 晴空碧海 | `.theme-ocean-light` | `#408abf` | `#f4f7fa` | 清爽蓝 |
| 苍穹暮色 | `.theme-ocean-dark` | `#084672` | `#0c141d` | 深海蓝 |
| 林间晨光 | `.theme-forest-light` | `#3f8361` | `#f6f9f7` | 自然绿 |
| 幽林夜色 | `.theme-forest-dark` | `#185337` | `#101814` | 深林绿 |
| 暖砂微光 | `.theme-slate-light` | `#bda59b` | `#f0efec` | 暖灰杏 |
| 夜岩暖影 | `.theme-slate-dark` | `#c9a89e` | `#161418` | 暖调暗色 |

**关键做法**：每套主题都重新定义 `--background`（侧边栏）和 `--content-area`（主内容区）两个值，**且刻意让它们不同**——侧边栏比内容区略深。这是三栏布局拉开层次的主要手段，比加边框更干净。

代码块背景在彩色主题下也跟着调（如 ocean 用 `#172030` 深蓝），保持整体色调统一。

> **给 TgBuddy 的建议**：初期只做默认亮/暗两套。但 CSS 变量结构从一开始就按这个方式组织，后面加主题就是加一个类，不用改组件。

---

## 3. 圆角与阴影

TgBuddy 采用以下圆角和阴影层级：

| 圆角 | 用量 | 典型场景 |
|---|---|---|
| `rounded-md` | 154 | **默认**。按钮、输入框、小卡片 |
| `rounded-lg` | 115 | 大卡片、弹出面板 |
| `rounded-full` | 107 | 头像、徽章、圆形图标按钮 |
| `rounded-xl` | 29 | 对话气泡、大容器 |
| `rounded-sm` | 27 | 内嵌小元素 |

| 阴影 | 用量 | 场景 |
|---|---|---|
| `shadow-sm` | 37 | **默认**。卡片、次要按钮 |
| `shadow-lg` | 21 | 弹出层、Popover |
| `shadow-xl` | 9 | 对话框 |

**设计原则**：

> 用**卡片和阴影**取代边框，用符合主题的**饱满色彩**，设置界面要设置背景为未来的不同主题留空间。

也就是说：能用 `shadow-sm` + `bg-card` 表达的层次，就不要用 `border`。

---

## 4. 组件清单

可按需使用以下 shadcn 组件，不要一次性全部引入：

```
alert / alert-dialog / badge / button / collapsible / command / context-menu
dialog / dropdown-menu / image-lightbox / input / label / loading-indicator
popover / scroll-area / select / separator / sheet / slider / sonner / spinner
switch / tabs / textarea / tooltip
```

其中 `image-lightbox` / `loading-indicator` / `spinner` 是自定义的，其余是标准 shadcn。

### Button 变体（直接沿用）

```ts
variant: default | destructive | outline | secondary | ghost | link
size:    default(h-9 px-4) | sm(h-8 px-3 text-xs) | lg(h-10 px-8)
       | icon(h-9 w-9) | icon-sm(h-7 w-7)
```

基础类：

```
inline-flex items-center justify-center gap-2 whitespace-nowrap
rounded-md text-sm font-medium transition-colors
focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
disabled:pointer-events-none disabled:opacity-50
[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0
```

注意两点：图标按钮 (`icon` / `icon-sm`) **关掉了聚焦环**（`focus-visible:ring-0`）；所有按钮内的 SVG 强制 `size-4` 并禁用指针事件。

---

## 5. 排版

- **界面字体**：不做自定义声明，走系统默认栈。中文界面下由操作系统决定（Windows 用微软雅黑 / 苹方）
- **等宽字体**（代码块、终端输出）：

  ```css
  ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Code',
  'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace
  ```

- **正文字号**：`text-sm`（14px）是界面默认，Markdown 正文用 `--md-preview-font-size`（默认 15px，用户可调三档）
- **字重**：按钮和标题用 `font-medium`，正文常规。**很少用 `font-bold`**

---

## 6. 动效

Tailwind 扩展了四组关键帧，全部是**位移类**，没有缩放和旋转：

```js
'slide-in-from-top'    // 0.3s ease-out
'slide-in-from-bottom'
'slide-out-to-right'   // 0.2s ease-in
'preview-slide-out'    // 0.25s ease-out，带透明度
```

配合 `tailwindcss-animate` 提供 Radix 的进出场动画。

**时长基调：进场 0.25–0.3s，出场 0.2s**（出场比进场快）。颜色过渡统一 `transition-colors`，不指定时长走 Tailwind 默认 150ms。

---

## 7. 给 TgBuddy 的取舍建议

| 沿用 | 简化 |
|---|---|
| shadcn/ui `new-york` + `neutral` 基色 | 组件先只装用到的，不要一次装 25 个 |
| CSS 变量 + HSL 三元组的组织方式 | **只做默认亮/暗两套主题**，彩色主题以后加 |
| `--background` vs `--content-area` 双背景拉层次 | — |
| Button 的变体和尺寸定义 | — |
| lucide-react 图标 | — |
| 卡片+阴影 > 边框 的原则 | — |
| 位移类动效、出场快于进场 | — |
| TipTap 富文本输入 | **可以先用普通 textarea**，TipTap 是为了 `@` 提及和富文本粘贴，第一版用不上 |
| Shiki 代码高亮 | 保留，Agent 输出大量代码 |

三栏布局里的**结果区**需要独立设计，重点处理产物筛选、只读预览和外部打开。
