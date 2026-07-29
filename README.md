# TgBuddy

基于 **pi** 内核的精简版 Agent 桌面应用，使用
[`@earendil-works/pi-*`](https://github.com/earendil-works/pi) 管理模型调用和 Agent 循环。

- **给 Claude Code 的项目指引**：[CLAUDE.md](CLAUDE.md)
- 架构设计：[docs/01-架构设计.md](docs/01-架构设计.md)
- 功能范围（做什么 / 不做什么）：[docs/02-功能范围.md](docs/02-功能范围.md)
- UI 设计需求清单（给设计的输入）：[docs/03-UI设计需求清单.md](docs/03-UI设计需求清单.md)
- 给设计的 prompt：[docs/04-给设计的prompt.md](docs/04-给设计的prompt.md)
- 设计系统：[docs/05-design.md](docs/05-design.md)
- **设计决策（已定，照做即可）**：[docs/06-设计决策.md](docs/06-设计决策.md)
- 交互原型：`tgbuddy-mockup/TgBuddy 交互原型（独立版）.html`
- 只做 Agent 模式，不做 Chat 模式
- 目标规模：`src/` 下 30–40 个文件

## 当前进度

| # | 阶段 | 状态 |
|---|---|---|
| 1 | 打通内核 | ✅ DeepSeek 实测通过（流式 / 工具调用 / 权限挂起 / 多轮） |
| 2 | Electron 骨架 | ✅ 三栏骨架 + IPC 双通道，实测能发消息看到流式 |
| 3 | 持久化（线性 JSONL + 原子写 + 续接） | ✅ 跨进程重放、坏行跳过、.bak 恢复均实测 |
| 4 | 工具 + 权限 + 沙箱 + 删除保护 | ✅ 全部实测通过 |
| 4.5 | 计划模式 | ✅ 两个工具 + 模式切换 + 计划审批卡片 |
| 5 | 并发与中断 | ✅ 多会话隔离 + generation 守卫 + abort + 挂起请求恢复/清理 |
| 5.5 | 上下文用量面板 | ⬜ |
| 6 | 上下文压缩 | ⬜ |
| 6.5 | 技能 + 连接器（Skills / MCP） | ⬜ |
| 7 | 记忆（工具式、本地） | ⬜ |
| 7.5 | 专家（轻量，切 systemPrompt） | ⬜ |
| 8 | 专家（子 Agent）+ 团队编排 | ⬜ |

面向用户的四个概念对应关系：**模式** = 权限模式，**专家** = systemPrompt 或子 Agent，
**技能** = Agent Skills 的 `SKILL.md`，**连接器** = MCP Server。

## 阶段 1：验证内核

先不碰 Electron。用一个脚本证明 pi 能连上你要用的端点，并且
`beforeToolCall` 能真的挂起 agent loop（这是整个权限设计的支点）。

```bash
bun install
```

把 `.env.example` 复制成 `.env`，填入你的 DeepSeek key（compat 已按 pi 官方目录预配好）：

```bash
copy .env.example .env
```

然后直接跑，Bun 会自动加载 `.env`，不用管 shell 的环境变量语法：

```bash
bun run probe
```

可选项在 `.env` 里：`DEEPSEEK_MODEL=deepseek-v4-pro`（默认 flash）、`DEEPSEEK_BASE_URL=...`（走中转网关时）。

脚本跑三轮，分别验证流式输出、工具调用 + `beforeToolCall` 挂起、多轮上下文。

## 阶段 2：跑起来

```bash
bun run dev
```

同时起 Vite dev server 和 Electron，主进程/preload 用 esbuild 编译。
渠道配置沿用 `.env` 里的 `DEEPSEEK_API_KEY`，所以 probe 能跑通的配置界面上也能直接用。

### 构建产物说明

| 产物 | 工具 | 格式 |
|---|---|---|
| `dist/main.js` | esbuild | **ESM**（Electron ≥28 支持 ESM 主进程） |
| `dist/preload.cjs` | esbuild | **CJS**（preload 只用 electron 两个 API，不冒 ESM 的险） |
| `dist/renderer/` | Vite | — |

主进程用 `--packages=external`，**不把 node_modules 打进去**。原因：pi-ai 把
`openai` / `@anthropic-ai/sdk` / `@aws-sdk/client-bedrock-runtime` / `@google/genai`
全列为硬依赖并靠动态 import 懒加载，全量 bundle 会把 AWS SDK 这类
bundler-hostile 的包也拖进来。Electron 主进程有完整的 Node 解析，留在
node_modules 里即可。

### 接其它端点

**先去 `node_modules/@earendil-works/pi-ai/dist/providers/data/` 找有没有现成的。**
pi 为 36 家 provider 维护了 compat 矩阵，那里的 json 就是权威配置，自己一个个试要花几小时。

DeepSeek 的预设就是这么来的（见 [src/shared/channel-presets.ts](src/shared/channel-presets.ts)），
关键是这四项：

```json
{ "supportsStore": false, "supportsDeveloperRole": false,
  "requiresReasoningContentOnAssistantMessages": true, "thinkingFormat": "deepseek" }
```

另注意 DeepSeek 的 baseUrl 是 `https://api.deepseek.com`，**不带 `/v1`**。

## 架构红线

**`src/kernel/` 是唯一允许 import pi 的目录。** 其它任何文件出现
`@earendil-works/pi-*` 都是架构违规。

这条规则用于防止内核 API 从 shared 层一路渗透到 React 组件，避免 Provider
抽象失效，也让消息持久化和 UI 不必依赖内核的运行时实现细节。
