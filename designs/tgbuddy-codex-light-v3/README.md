# TgBuddy Codex Light v3

## 方向

- 轻量桌面 Agent，不做重型 IDE：默认只显示当前任务、会话和结果，详情按需展开。
- Composer 只保留模式、专家、模型和上下文；Skill/MCP 改为应用级管理，不做工作区级选择。
- Session 首条消息先有即时占位标题，随后由 LLM 异步生成；用户手动重命名后永不覆盖。
- 结果侧栏合并“任务产物 / 工作区文件”，单击预览、查看器阅读、系统应用编辑。
- 设置中心完整覆盖通用、模型、工具与权限、应用能力和外观，不保留空页面。

## 参考来源

- TgBuddy 当前功能范围与 Renderer：`docs/02-功能范围.md`、`src/renderer/`
- 视觉基线：`designs/tgbuddy-codex-light-v2/`
- Prom 标题生成：`../Proma/apps/electron/src/main/lib/agent-orchestrator.ts`
- Craft Agents 文件树与查看器：https://github.com/craft-ai-agents/craft-agents-oss

参考只用于交互结构，产品范围仍由 TgBuddy 自身设计决定。

## 可交互状态

顶部状态条可切换主任务、计划审批、结构化提问、高危授权、目录丢失和标题生成。结果区可切换产物/工作区，产物支持 Markdown、图片、CSV、代码预览与独立查看器。

## 品牌图标来源

- DeepSeek、Anthropic 图标取自 [Simple Icons](https://github.com/simple-icons/simple-icons)，仅用于标识对应 Provider。
- OpenAI Compatible 不是单一厂商，使用通用 API 图标，避免把任意兼容端点误标为 OpenAI 官方服务。
