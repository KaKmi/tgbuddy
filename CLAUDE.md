# CLAUDE.md

给 Claude Code 的项目指引。**注释和文档一律中文**，保留必要的英文术语。

## 这是什么

TgBuddy —— 基于 **pi 内核**的精简版 Agent 桌面应用。只做 Agent 模式，不做 Chat 模式。
目标规模控制在 `src/` 下 30–40 个文件。

- 架构设计：[docs/01-架构设计.md](docs/01-架构设计.md)
- 功能范围：[docs/02-功能范围.md](docs/02-功能范围.md)
- **设计决策（已定，照做不要重新讨论）**：[docs/06-设计决策.md](docs/06-设计决策.md)
- 设计系统：[docs/05-design.md](docs/05-design.md)

## 常用命令

```bash
bun run dev            # Vite + Electron，热重载
bun run probe          # 不启动 Electron，直接验证内核（改 kernel 层后先跑这个）
bun run typecheck
bun run build
```

---

# ⚠️ UI 还原：以交互原型为准

**`tgbuddy-mockup/TgBuddy 交互原型.dc.html` 是 UI 的唯一事实来源。**

调样式**不要凭感觉**。那份原型里所有数值都是内联样式，直接抠出来用：

```bash
# 找某个组件的模板（先 grep 到 isXxx 标志位，再看它的 sc-if 块）
grep -n "isTool" "tgbuddy-mockup/TgBuddy 交互原型.dc.html"

# 状态配色表在 ST 常量里
grep -n "const ST = {" -A 8 "tgbuddy-mockup/TgBuddy 交互原型.dc.html"

# 场景说明和设计决策理由在 notes / decisions 两个对象里
grep -n "const decisions = \[" -A 12 "tgbuddy-mockup/TgBuddy 交互原型.dc.html"
```

**教训**：靠截图目测调了三轮都不对，去抠源码后一次就对了。差的是圆角 8→11px、
描述字号 14→13px、卡片间距 16→2px、描边从 `border` 换成 `inset box-shadow` 这类
单看每条都很小、叠起来"就是不像"的东西。

## 从原型学到的几条通用规则

**颜色标记异常，不标记常态。** 原型里成功态的图标是 `#7f8b98` 灰蓝、左侧色条
`transparent` —— 不是绿色，也不画条。因为一次任务里绝大多数调用都成功，
用绿色会让整屏发绿，唯一那个红叉反而被淹掉。

**安静的状态用文字，响亮的状态用颜色。** 「未完成」这类容易和成功混淆的状态，
靠文字标签说明；只有失败、等待授权这种必须被发现的才用颜色。色弱用户和
快速扫视的人都不会漏。

**结构和状态分开。** 「这是什么东西」用结构表达（容器、chip、等宽字体），
「它处于什么状态」用颜色表达。踩过的坑：按"成功不该抢注意力"把颜色降下去时，
顺手把容器也去掉了，结果工具调用变成几行飘在对话流里的文字，读者认不出这是另一类东西。

**用背景层次而不是边框划分区域。** 原型是四级灰阶递进
（`#0e0e0f` 侧边栏 → `#141415` 对话区 → `#17171a` 卡片 → `#1b1b1e` 悬浮层），
每级只差一点点亮度。描边一律 `rgba(255,255,255,.05)` 级别，几乎看不见。

---

# 踩过的坑（都是真实撞过的）

## 样式与构建

**改了 `tailwind.config.js` 必须重启 dev server。** Vite 的 PostCSS 缓存不会失效，
界面上看到的是旧构建。症状很迷惑：CSS 产物里明明是对的，界面就是不变。

**CSS 的 `@import` 必须在所有语句最前面**（`@charset` 除外），放到 `@tailwind` 后面
postcss 直接报错。

**`--border` 必须存实色，不能存白色再靠透明度。** 全局有
`* { border-color: hsl(var(--border)) }`，存白色会让所有边框变成实心白。

**shadcn 的 CSS 变量是硬要求，不是可选项。** streamdown、AI Elements 以及任何
shadcn 组件都直接用 `bg-background` / `border-border` / `text-muted-foreground`。
不定义的后果不是"没主题"而是**样式错乱**：`border border-border` 里 `border` 生效
（1px）但 `border-border` 是不存在的类，边框取 Tailwind 默认浅灰 —— 深色背景上一圈白边。

**`prose` 会和 streamdown 打架。** 两个症状：prose 给行内代码加 `content: '`'` 伪元素，
界面上**真的显示出反引号**；prose 和 streamdown 各画一层代码块背景边框，变成双层框。
必须用 `prose-code:before:content-none` / `prose-pre:bg-transparent` 等中和掉。
但不能整个丢掉 prose —— 列表、段落的排版还靠它（Tailwind preflight 把默认样式全抹了）。

## 布局

**flex 子项要滚动必须加 `min-h-0`。** 默认 `min-height: auto` 会被内容撑开而不是被父容器
约束，内部 `height:100%` 的滚动区永远不溢出。例外：如果这个 flex 子项自己就是滚动容器
（`overflow-y-auto`），规范规定 `min-height:auto` 不生效，所以碰巧能work —— 这也是为什么
换成 `StickToBottom` 之后才暴露出来。

**`StickToBottom.Content` 内部渲染两层 div**：外层（`height:100%`）是真正的滚动容器，
接 `scrollClassName`；内层才接 `className`。给错层就滚不动。

## 运行时

**Bun 自动加载 `.env`，Electron 不会。** `bun run probe` 能跑通的配置，
`electron .` 里 `process.env` 是空的。主进程有个 `loadDotEnv()` 专门处理，只在开发期用。

**Electron 二进制走 npmmirror。** 已写进 `.npmrc`。若卡住，清掉
`node_modules/electron/dist` 和 `path.txt` 再重装 —— `install.js` 看到空的 `dist` 目录
会**误判为已安装、静默退出 0**，既不下载也不报错。

**pi 的 `stream` 永远不 throw**，所有失败编码成 `error` 事件。不订阅那个分支的话，
认证失败在界面上表现为"模型不说话"，没有任何提示。

**pi 的 `tool_execution_start` 比权限请求早约 5ms**（实测）。UI 收到 `tool_start` 后
延迟 120ms 才进入「执行中」，期间收到授权请求就取消 —— 否则用户会先看到
「正在执行 rm -rf」再弹授权框，信任一次就崩。

---

# 架构红线

**pi 的「调用」只在 `src/kernel/`，pi 的「类型」允许出现在 `src/shared/`。**
消息不做归一化翻译（pi 的格式本身已经是中立格式，0.79→0.82 三个 minor 一个字段没改），
但套一层信封补 `id`、系统通知、`ToolDetails` 约定。会话文件头记 `kernel: 'pi@0.82'` 作为版本护栏。

**工具的 `details` 形状不可依赖** —— pi 内置的 `write` 返回 `details: undefined`。
产物识别从**工具调用的参数**推导，见 `session-store.ts` 的 `countArtifacts`。
加新的产出型工具时要在那里的 `PRODUCING` 集合里登记。

**沙箱在 `ExecutionEnv` 层，不在工具层。** pi 的工具只能通过 env 碰磁盘，包一层就覆盖全部。
⚠️ 但对 `bash` 只是软约束 —— 任意 shell 无法静态解析，它的实际防线是权限提示。

**不要复制其他项目的组件文件。** 标准 shadcn 组件直接用 `npx shadcn add` 生成。
值得抄的是**颜色变量和设计约定**，那些已经提炼进 `docs/05-design.md`。

# 代码风格

- 永远不用 `any`，创建合适的 interface
- 对象类型优先 `interface` 而非 `type`
- 仅类型导入用 `import type`
- 注释解释**为什么**，不解释**做了什么** —— 尤其是那些"看起来多余但删了会坏"的代码
