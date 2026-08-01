# 设计 QA：V3 全界面逐区还原

## 对照来源

- 结构、尺寸与交互：`designs/tgbuddy-codex-light-v3/TgBuddy Codex Light v3.html`
- 样式 token：`designs/tgbuddy-codex-light-v3/styles.css`
- 组件与状态：`designs/tgbuddy-codex-light-v3/components.jsx`
- 用户整窗参考：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-da00e583-8835-4ed2-8669-6a9754e0f682.png`
- 用户结果区参考：`C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-1c6bc0e4-030d-4bc2-9868-61478b562a93.png`
- 实现截图：`test-results/m4-results.e2e.ts-M4：write-产物出现在结果区，可预览并用系统打开/results-panel.png`

参考图与实现截图已在同一视觉比较输入中打开核对。实现截图使用 Electron 完整窗口与 2× 像素密度，因此画布尺寸不同；组件 CSS 尺寸按原型数值比较。

## 逐区核对

| 区域 | 核对内容 | 结果 |
|---|---|---|
| 自绘窗口栏 | 36px 高度、主题化背景、窗口按钮、无原生黑色标题栏 | 通过 |
| 左侧栏 | 252px 宽、品牌、Workspace 卡、新会话、搜索、会话分组、本地状态 | 通过 |
| 会话行 | 10px 圆角、标题/时间/状态层级；hover 显示置顶、删除、归档三个图标按钮 | 通过 |
| 空会话 | 样例任务、Composer 可直接输入；首条发送自动建会话 | 通过 |
| 对话头部 | 48px 高度、标题、运行状态、结果与文件入口 | 通过 |
| 消息流 | 720px 内容宽度、用户气泡、T 标记、正文行高、编辑态 | 通过 |
| 工具与系统卡 | 成功/运行/等待/失败四态、3px 状态边、压缩和系统标记 | 通过 |
| Composer | 820px 最大宽、130px 最小高、模式/专家/模型、附件、发送/停止、上下文用量 | 通过 |
| 上下文面板 | 当前窗口 token 分类、自动压缩阈值；不展示 cost | 通过 |
| 结果区 | 356px 宽、产物/工作区、筛选、预览卡、本次任务/更早分组、空态 | 通过 |
| 工作区文件 | 搜索、刷新、目录层级、单击只读预览、双击系统打开 | 通过 |
| 文件查看器 | 780×670 上限、路径/类型、只读内容、系统打开、遮罩/按钮/Escape 关闭 | 通过 |
| 设置中心 | 900×650 布局、通用/模型/工具与权限/能力/外观、Provider 与专家配置 | 通过 |
| 主题与响应式 | light/dark token；1180px 结果覆盖、820px 侧栏收缩、640px 隐藏 | 通过 |

## 运行验证

- `bun test`：377/377
- `bun run check:architecture`：通过
- `bun run typecheck`：通过
- `bun run build`：通过（保留既有 Vite 主 chunk 警告）
- Electron E2E：16/16，覆盖设置、Composer、会话 hover 操作、无会话首发、结果区、工作区文件、文件查看器和响应式

权限审批业务流程按用户要求暂停，本轮仅统一已经存在的可见卡片表面，不改变策略、规则或 IPC 契约。

final result: passed
