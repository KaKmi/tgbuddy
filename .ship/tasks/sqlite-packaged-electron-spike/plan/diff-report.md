# SQLite Packaged Electron Spike 规格差异裁决

基线：`main@4735c9da87d5a8a65e074175b34562efaff4dd83`

对比对象：

- 宿主规格：`plan/spec.md`
- 独立规格：`plan/peer-spec.md`
- 裁决依据：当前仓库代码、已安装 pi 0.82.1 声明/实现、已审计 SQLite backend 0.82.1、Electron 39.8.10 运行时预检

独立调查使用同一模型提供方作为 Claude CLI 403 后的 fallback，调查上下文与宿主调查隔离，但独立性弱于异构模型 peer；本报告不把一致意见当作证据，所有分歧都回到代码或已审计包实现裁决。

## 一致结论

| 主题 | 一致结论 | 证据 |
|---|---|---|
| 任务边界 | 只做隔离 Spike，不修改生产 SessionStore/IPC/Renderer，不读取真实 `~/.tgbuddy` | `src/main/index.ts:5-10,61-64`；`src/main/session-store.ts:1-13` |
| 目标 runtime | Bun、系统 Node、`electron .`、`ELECTRON_RUN_AS_NODE` 都不能代替 packaged gate | `docs/01-架构设计.md:412-452`；`docs/02-功能范围.md:140-160` |
| backend | 固定验证 `@earendil-works/pi-storage-sqlite-node@0.82.1`，通过 Repo/Session/Storage 契约写入 | backend `package.json:1-37`；`repo.d.ts:3-24` |
| 写入原子性 | entry、sequence、active leaf 和物化状态必须作为同一 transaction 验证 | backend `storage/index.js:203-258` |
| cleanup | 每个长生命周期 Session storage 必须显式 `cleanup()`，并验证 Windows 文件锁释放 | backend `storage/index.d.ts:15-36`、`storage/index.js:343-345` |
| crash | 派生同一 packaged 可执行文件并由父进程强杀；验证不固定数量的连续提交前缀 | `docs/02-功能范围.md:152-160`；backend `storage/index.js:203-258` |
| compaction | reopen 后必须通过真实 `buildContext()` 验证摘要和保留边界，不能只查 SQL | core `session.d.ts:16-47`、`session.js:23-90` |
| WAL backup | 不允许活跃 WAL 主库 `copyFile`；checkpoint 后用 SQLite backup API 生成独立恢复库 | `docs/01-架构设计.md:452`；Electron runtime 实测 `node:sqlite.backup` 存在 |
| importer | 逐行诊断、全类型覆盖、幂等、冲突不覆盖；第二次运行零新增 | `src/shared/types/session.ts:44-58`；`src/shared/types/message.ts:65-101` |

## 分歧与裁决

### 1. `ELECTRON_RUN_AS_NODE` 还是 packaged 应用

- 原宿主规格：把 `ELECTRON_RUN_AS_NODE=1` 的 Electron binary 作为 integration runtime。
- peer：要求打包后的 `.exe` 自证 `app.isPackaged === true`、`app.asar` 和同 exe child。
- 裁决：采纳 peer，并保留 `ELECTRON_RUN_AS_NODE` 仅作调查预检。
- 原因：架构门槛明确写“packaged Electron”；SQLite 包的 migration 通过相对 `import.meta.url` 读取 SQL，只有 ASAR 产物能验证资源裁剪和包内读取。

### 2. Electron Builder 还是最小 Packager fixture

- peer：新增 Electron Builder 配置并用 `--dir --win`。
- 宿主复核：项目没有任何发布打包器或配置，Spike 不应顺带确立生产发布工具链。
- 裁决：使用精确 `@electron/packager@20.0.4` 构造一次性 staging fixture，`asar: true`；不增加产品 Builder/Forge 配置。
- 原因：`package.json:8-19` 只有开发/构建命令。Packager 足以生成真正的目录产物和 ASAR，同时改动面更小，符合本任务“验证而非发布”的边界。

### 3. SQLite backend 放 production dependency 还是 devDependency

- peer：为保证打包 pruning 后仍存在，建议加入 production dependencies。
- 原宿主规格：Spike 通过前不得进入生产 dependencies。
- 裁决：根项目使用精确 devDependency；launcher 在临时 staging 的 package metadata 中把 backend、pi core、pi-ai 声明为 fixture runtime dependencies，再由 Packager prune/ASAR。
- 原因：`src/main/index.ts` 不加载 backend，本任务也禁止修改生产入口；把尚未通过门槛的 backend 提前纳入产品 runtime 会让验证任务本身改变待裁决架构。

### 4. 是否修改 `tsconfig.json`

- peer：新建 `spikes/**` 并扩展 include。
- 宿主：新文件放 `scripts/**`。
- 裁决：不修改 `tsconfig.json`。
- 原因：`tsconfig.json:19` 已包含 `scripts/**/*`；使用现有目录即可获得常规 typecheck，少一个无关配置变更。

### 5. 是否把 Electron 从范围版本改成精确版本

- peer：固定 Electron 到已解析的 39.8.10。
- 宿主：保持现有 `^39.0.0`，Packager 从当前锁文件/已安装 package 读取精确 39.8.10。
- 裁决：不改现有 Electron semver；报告实际 package/runtime 版本并要求两者一致。
- 原因：`bun.lock:649` 已解析 39.8.10；本 Spike 不负责项目依赖升级策略。为测试修改产品依赖声明会扩大范围。

### 6. WAL checkpoint 后复制还是 SQLite backup API

- 原宿主规格：checkpoint 后复制 db，并同时写了“禁止只复制主 db”，存在自相矛盾。
- peer：checkpoint 后调用 `node:sqlite.backup()`，恢复不依赖源 wal/shm。
- 裁决：采纳 peer；删除普通复制作为成功路径。
- 原因：Electron 目标 runtime 已实测导出 `backup`；Node 22 backup 对打开的 `DatabaseSync` 生成 SQLite 一致性备份，直接覆盖架构要求的 WAL 恢复风险。

### 7. crash 是否要求固定条数

- 原宿主规格：只写“恢复已经提交的前缀”，未定义可判定边界。
- peer：数量允许落在已确认最小值和上限之间，但业务序号必须是 `0..n-1` 连续前缀。
- 裁决：采纳 peer，并增加 `integrity_check`、物化计数一致和恢复后继续追加。
- 原因：OS 强杀与 stdout marker 存在竞态，固定最终条数会制造脆弱测试；连续前缀才是 transaction/WAL 的真实不变量。

### 8. `model_change.channelId` 如何映射

- peer：建议暂时 `channelId -> provider`，同时发 compatibility warning。
- 宿主复核：产品字段明确是 channel 实例 ID，pi entry 要求 provider 字符串。
- 裁决：映射为 `customType=legacy.model_change`，完整保存 `{channelId, modelId}` 并发 warning；不生成错误的 pi model state。
- 原因：`src/shared/types/session.ts:46` 与 core `types.d.ts:254-258` 字段语义不同。无 channel catalog 时无法从 `channelId` 推导 provider。

### 9. `truncate` 如何映射

- peer：建议每条 `truncate -> leaf`，target 为 `fromId` 前驱，同时承认兼容风险。
- 宿主复核：当前重放收集所有 truncate，最终从最早截断点统一裁剪；逐条 move leaf 后继续追加会改变后续消息是否进入 active branch。
- 裁决：先把 truncate 作为 legacy audit custom entry 保存；完成所有 entry 导入后，按当前 `replaySessionEntries()` 的最早裁剪语义追加一个确定 ID 的 leaf 导航 entry。fixture 必须包含 truncate，并比较 legacy replay 与 SQLite `buildContext()` 的有效消息。
- 原因：`src/main/session-store.ts:162-205` 是当前实际兼容行为；Spike 不能用 pi 的自然树语义覆盖既有数据语义。

### 10. 幂等键与半成品

- 两份规格都要求重复运行不增加 Session/entry；peer 补充 partial rebuild/conflict。
- 裁决：采纳 peer 的 importer marker + fingerprint，但 fingerprint 由 `legacy session id + header/index meta + 所有可解析原始行的规范化表示` 计算，坏行单独诊断且不改变逻辑内容摘要。
- 完整一致：skip；同 marker/fingerprint 但摘要不完整：删除该 importer 半成品后重建；marker 缺失或 fingerprint 冲突：失败且不覆盖。

### 11. Node 类型声明版本

- peer：升级到匹配 Electron Node 22 的 `@types/node`。
- 原宿主规格：未处理当前 `@types/node ^20.0.0`。
- 裁决：精确升级 devDependency 到 `@types/node@22.20.1`。
- 原因：SQLite backend 的公开声明引用 `node:sqlite`，Spike 还直接使用 Node 22.16 加入的 `backup()`；Node 20 类型无法为这些接口提供可靠 typecheck。

## 最终设计变化

宿主 `spec.md` 已按以上裁决更新：

- 真正 packaged + ASAR 成为首要验收；
- 新增 launcher/main/scenarios/import 四个职责分离文件；
- backend 和 Packager 都只作为精确 devDependency；
- backup 使用 checkpoint + `node:sqlite.backup()`；
- crash 使用同 exe 强杀与连续前缀判据；
- importer 覆盖所有 entry/message 变体，并对 model/truncate 做显式兼容处理；
- 不修改生产入口、生产 dependencies、`tsconfig.json` 或产品发布工具链。

## Debate outcome

无需第二轮 peer 辩论。主要分歧都能由当前架构门槛、字段定义和 backend 实现直接裁决；剩余 packaged child/ASAR/pruning 行为属于 Spike 本身要验证的 unknown，而不是继续纸面讨论可解决的问题。
