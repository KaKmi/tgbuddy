# TgBuddy

TgBuddy 是一个基于 **pi 内核**的本地优先 Agent Workbench，使用 Electron、React、
`@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai`。它既是一套可供二次开发的
通用工作平台，也是一份强调架构决策、工程质量和可验证证据的面试作品。产品只做 Agent
模式，不做普通 Chat 模式。

第一版采用“仓库内模块化 Runtime + Electron 参考宿主”：先把正常的软件分层、扩展接口、
测试和失败恢复做好，不提前承诺独立 npm SDK、第三方插件 ABI、复杂 DI 容器或完整 Team 平台。

## 当前状态

项目正在进行一次**架构迁移式的二次开发**，不是从零重写。M1 可恢复 Agent
内核、M2 Workspace/安全、M3 通用能力系统（Channel/Profile/Tool/Skill/MCP +
Run 能力快照与 token 账本）、M4 附件与结果（Blob/附件/长输出/Artifact/结果区）、
M5 单层子 Agent（lineage/预算/取消/权限）与 M6 产品收口（空状态/会话搜索与菜单/
设置与视觉收口/端到端验收）均已按 Slice 流程完成开发并全量回归通过，进入第一版联调 QA。

Session/Run/Context 已迁入 Runtime、SQLite 和 pi `AgentHarness`；旧裸 `Agent`、
JSONL canonical owner、Main compaction/permission/plan/ask-user/channel/tools
owner 已删除。密钥只经 SecretStore（safeStorage）保存，SQLite 只存 ref；
工具、技能与 MCP 均经统一注册表进入 Run 启动时的不可变快照。

### 已有基座

- Electron 主进程、Preload、React Renderer 和 IPC 双通道。
- pi Provider 接入、流式消息、工具调用和多轮上下文。
- 内置文件工具、权限挂起、计划模式和 `ask_user`。
- 多 Session generation 守卫、停止运行和挂起请求清理。
- SQLite canonical Session、pi 消息历史、legacy JSONL 一次性幂等导入。
- Run 单飞、并行、停止、崩溃恢复与 durable `message_end`。
- 上下文用量统计、自动/手动压缩、编辑重发和扁平派生会话。
- 工具卡片、权限卡片、计划审批和压缩状态等 UI 基础组件。

这些代码不会整体推倒。迁移过程中优先保留已经验证的 Provider、事件、UI 和测试能力，
逐步替换运行时、存储和 Workspace 边界。

### 正在迁移的目标架构

| 领域 | 当前基座 | 目标 |
|---|---|---|
| Agent Runtime | Runtime + pi `AgentHarness` 已接管 | M2/M3 接入 Workspace、Policy、Tool、Skill 与 MCP |
| 会话存储 | SQLite catalog + pi SQLite Session backend | 后续增加 Blob、Artifact 和导出能力；JSONL 只做兼容导入 |
| Workspace | 自动创建 `~/.tgbuddy/workspaces/{id}` | 逻辑 `WorkspaceRecord` + 可重新定位的 `WorkspaceMount` |
| Sandbox | 全局配置 + 文件路径校验 | 每个 Run 独立的 `Sandboxed ExecutionEnv` + canonical path 校验 |
| 大对象 | 消息内截断或剥离 | BlobStore 保存附件、完整工具输出、预览和非工作区产物 |
| 能力系统 | 内置 Tool | Tool Registry + Skill Registry + MCP Manager |
| 多 Agent | 尚未实现 | 主 Agent 同步委派单层 child，最多 2 个，最大深度 1 |

### 平台设计原则

- **可替换**：Provider、Session storage、Tool、Skill、MCP 和 Agent Profile 通过明确接口装配。
- **宿主解耦**：Runtime 不依赖 React 组件；Electron 通过 IPC 使用 Runtime，而不是成为业务内核。
- **最小扩展面**：第一版只开放仓库内 TypeScript 接口，不维护跨版本插件兼容承诺。
- **可验证**：关键架构决策必须有测试、失败场景或可重复的 spike 结果支撑。
- **不过度设计**：不为了“平台感”引入无真实消费者的抽象层，每个扩展点至少服务当前实现或近期 Wave。
- **面试可讲清楚**：保留架构图、取舍、迁移路径、测试证据和性能数字，而不是只展示功能截图。

## 第一版范围

第一版需要完成的闭环是：

```text
用户消息和附件
  -> 恢复 Session 与 Workspace
  -> AgentHarness 构造上下文和能力
  -> Provider / Tool / MCP / Skill
  -> 权限与 Sandbox
  -> 消息、Blob 和产物持久化
  -> UI 流式展示与重启恢复
```

Team 第一版不做独立实体、成员页、任务 DAG、parallel/chain/router 或复杂调度。
只保留“主 Agent 委派 child，并让过程可见”的最小能力。

详细边界见：

- [架构设计](docs/01-架构设计.md)
- [功能范围](docs/02-功能范围.md)
- [设计决策](docs/06-设计决策.md)
- [项目进度](docs/08-项目进度.md)
- [文档索引](docs/DOCS_INDEX.md)

## 开发方式

架构文档中的阶段是 Milestone，不直接作为一个大任务开发。实际开发计划按以下层次拆分：

```text
Milestone
  -> Wave（2-5 天）
    -> Story（0.5-2 天）
      -> 验收测试
```

里程碑和下一 Slice 见 [项目进度](docs/08-项目进度.md)，详细实施以 `.ship/tasks/tgbuddy-vertical-slices/plan/plan.md` 为准：

| 顺序 | Wave | 目标 |
|---:|---|---|
| 0 | SQLite packaged spike | 验证 Electron 打包环境中的追加、强杀恢复、WAL 备份和 JSONL 导入 |
| 1 | Session Runtime | 接入 AgentHarness、SessionRepo、save point、错误和取消生命周期 |
| 2 | Workspace 与安全 | WorkspaceMount、per-run Sandbox、权限规则绑定 Workspace |
| 3 | Blob 与产物 | 附件、大 Tool 输出、预览和 Artifact 索引 |
| 4 | 能力系统 | Skill Registry、MCP Manager、上下文能力预算 |
| 5 | 单层委派 | child lineage、root budget、权限透传和级联取消 |
| 6 | UI 与恢复验收 | 按交互原型完成工具卡片、结果区、压缩和恢复场景 |

## 本地运行

### 安装依赖

```bash
bun install
```

复制开发配置并填写模型密钥：

```bash
copy .env.example .env
```

### 验证 pi 内核

```bash
bun run probe
```

`probe` 不启动 Electron，用于验证 Provider、流式输出、工具调用和多轮上下文。
Bun 会自动加载 `.env`；Electron 不会，开发模式由主进程的 `loadDotEnv()` 处理。

### 启动桌面应用

```bash
bun run dev
```

### 检查与构建

```bash
bun test
bun run typecheck
bun run build
```

主进程使用 esbuild 输出 ESM，Preload 输出 CJS，Renderer 由 Vite 构建。
主进程依赖保持 external，由 Electron 的 Node 运行时解析。

## 模型与渠道

渠道配置当前位于 `~/.tgbuddy/channels.json`，开发环境也可通过 `.env` 提供 DeepSeek 配置。

接入其它 Provider 时，优先读取
`node_modules/@earendil-works/pi-ai/dist/providers/data/` 中的现成 compat 配置，
不要手工猜测第三方端点的 Tool、thinking 或 token 字段兼容性。

## UI 事实来源

UI 实现以 `tgbuddy-mockup/TgBuddy 交互原型.dc.html` 为唯一事实来源。
颜色、间距、圆角、工具卡片状态和交互时序直接读取原型源码，不根据截图目测调整。

设计系统和原型说明：

- [设计系统](docs/05-design.md)
- [UI 设计需求清单](docs/03-UI设计需求清单.md)
- `tgbuddy-mockup/TgBuddy 交互原型.dc.html`

## 架构红线

- pi 的运行时调用只允许出现在 `src/kernel/` 和明确的 Harness 适配层；pi 类型允许出现在 `src/shared/`。
- Renderer 不直接访问数据库、任意文件路径、API Key 或 MCP 子进程。
- 文件类 Tool 统一通过 `ExecutionEnv` 访问磁盘，不能在每个 Tool 内各写一套路径校验。
- pi 内置 Tool 的 `details` 形状不可依赖；产物由 Tool 参数和成功结果共同推导。
- 消息保存引用，不把大 Base64 图片或完整大 Tool 输出直接写入 Session payload。
- 注释和文档使用中文，保留必要的英文术语。

稳定的研发约束见 [AGENTS.md](AGENTS.md)，动态里程碑和下一 Slice 见 [项目进度](docs/08-项目进度.md)。
