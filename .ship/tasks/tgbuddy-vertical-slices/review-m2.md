# M2 Code Review（Workspace 与安全，S01–S11）

评审范围：`568f68e...HEAD`（M2 全部 11 个 Slice，77 文件，+4518/-903），
以 `.ship/tasks/tgbuddy-vertical-slices/plan/spec.md`、`plan.md` M2 章节和 `dev-ledger.md` 为验收基线。

评审方式说明：按 ship:review 规范应使用独立 peer reviewer；本轮因上一回合中断遗留的
review 子代理树占满并发名额且无法产出，已回收后由主机逐文件完成静态评审并以运行时
复现验证 findings。独立性弱于独立 reviewer，已在报告中注明。

## Findings

### P2：沙箱拦截 pi 内置 bash 工具的完整输出临时文件写入，长输出命令必然失败

- File: `src/kernel/pi/pi-execution-env.ts:51`（`PATH_METHODS` 名单，`appendFile` 在第 57 行）
- Trigger: bash 命令输出超过 pi 的截断阈值（50KB 或 2000 行）。pi 的
  `executeShellWithCapture`（`node_modules/@earendil-works/pi-agent-core/dist/harness/utils/shell-output.js:66-70`）
  会调用 `env.createTempFile()`（系统临时目录，工作区外）再用 `env.appendFile(fullOutputPath, ...)` 写完整输出；
  我们的沙箱 Proxy 对 `appendFile` 执行 `resolveSandboxedPath`，判定路径超出工作区并返回
  `PermissionDenied`。
- 复现证据：真实 `buildBuiltinTools` + `PiRunExecutionEnv`，bash 输出 60KB →
  `ExecutionError: {"kind":"PermissionDenied","message":"路径超出工作区范围：C:\...\Temp\...\bash-*.log"}`，
  工具以异常结束。
- Impact: 任何长输出（>50KB 或 >2000 行）的 bash 调用在 M2 的 Env 层下必然报错，
  pi 的截断预览与"完整输出"机制整体失效；这是 S03 新 Env owner（自旧 `main/tools/sandboxed-env.ts`
  承接）的实际功能破坏。A04 之前的每一条大输出路径都会踩中。
- Fix: 让 pi 内部临时文件协议走工作区作用域：在沙箱 Proxy 拦截 `createTempDir`/`createTempFile`，
  重定向到工作区内的隐藏临时目录（如 `<mount>/.tgbuddy-tmp`），返回路径保证通过容器校验，
  `dispose()` 时清理；并补"真实 bash 工具 + 超阈值输出"的集成回归测试。

### P2：plan 模式下 `find` 被当作只读命令，`find -delete` / `find -exec ... +` 绕过计划审批

- File: `src/shared/contracts/permission.ts:121-122`（`READONLY_COMMANDS` 含 `find`），
  消费方 `src/runtime/permissions/policy-engine.ts:132`（plan 模式 bash 只读直接 allow）
- Trigger: 用户在 plan 模式，Agent 调用 `find . -delete` 或 `find . -name "*.tmp" -exec rm {} +`。
  两条命令都不含 `| > ; & $() ` 等被排除字符，`isReadOnlyCommand` 返回 true，
  plan 分支直接放行，既不询问也不等计划审批。
- 复现证据：`policy.evaluate({ toolName:'bash', args:{command:'find . -delete'} }, mode='plan')`
  → `{action:'allow'}`；`find ... -exec rm {} +` 同样 `allow`。现有测试仅覆盖 `git status`。
- Impact: 破坏 plan 模式"写/命令工具必须先交计划等批准"的核心承诺；`neverPersist`
  （破坏性命令免检）同样被绕过，破坏性删除可在 plan 模式下静默执行。
- Fix: `isReadOnlyCommand` 增加 `find` 破坏性标志检测（`-delete`/`-exec`/`-execdir`/`-ok` 返回非只读），
  或直接从只读白名单移除 `find`；补 plan 模式 `find -delete` 拒绝的回归测试。

### P3：沙箱 Proxy 未校验 `createTempDir`/`createTempFile`，可越过工作区边界创建文件并返回路径

- File: `src/kernel/pi/pi-execution-env.ts:51-65`（`PATH_METHODS` 与实际 `FileSystem` 接口不对齐：
  缺 `createTempDir`/`createTempFile`，反而包含不存在的 `rename`/`copyFile`）
- Trigger: Agent 或 pi 内置工具调用 `env.createTempDir()`/`env.createTempFile()`。
  NodeExecutionEnv 在系统 `os.tmpdir()` 下创建目录/文件（`nodejs.js:596-612`）。
- 复现证据：`env.createTempFile()` 返回
  `C:\Users\...\AppData\Local\Temp\tmp-...\bash-*.log`（工作区外路径，直接暴露给模型）。
- Impact: 违反 S03 "read/write 只能使用当前 Workspace mount" 的字面边界；模型获得工作区外路径。
  后续对这类路径的 env 文件操作仍会被容器拒绝，所以影响有限——但和 P2-1 同根因，
  修复时一并处理，可把临时目录收敛到工作区作用域。
- Fix: 与 P2-1 一起把临时文件协议重定向到工作区；`PATH_METHODS` 与 pi `FileSystem`
  接口逐方法对齐（删除 `rename`/`copyFile` 等不存在方法），并加注释说明为何 temp 方法特殊处理。

## Diagnosis

P2-1 与 P3 共享同一根因：沙箱 Proxy 的 `PATH_METHODS` 名单基于"第一个参数是路径"的启发式，
没有覆盖 pi `FileSystem` 接口里"创建并返回路径"的方法（`createTempDir`/`createTempFile`），
导致 pi 内置 bash 的长输出协议（系统 temp + appendFile）被硬边界拦死。
P2-2 是独立的只读命令白名单过宽：`find` 的破坏性子命令没有参与判定。

## Open Questions

1. `matchRule` 的 `method` 类型当前实现是 `toolName === rule.pattern`
   （`src/runtime/permissions/policy-engine.ts`），与契约注释"服务.方法"的语义对应关系
   取决于 M3 MCP 工具命名；S07 RED 宣称覆盖 MCP method，建议 C11 落地前确认命名并补真实场景测试。
2. 工作区选择状态（`currentWorkspaceId`）只存内存，重启后 `current()` 回退最早创建的工作区
   （`workspace-service.ts` 注释已声明为设计），不属于 M2 验收范围；若产品期望记住上次选择，
   需要单独决策持久化。
3. delete 工具没有"禁止删除工作区根目录"守卫；当前删除受"高危模态 + 回收站"保护，
   是否接受由产品定（当前可接受）。

## 评审结论

2 个 P2、1 个 P3，均为真实缺陷并有运行时复现证据。修复后需 fresh review 复验，
再进入 M2 Electron E2E 与探索式 QA。

## [Review] Report Card

| Field | Value |
|-------|-------|
| Status | FINDINGS |
| Summary | 3 findings（2 P2 + 1 P3），运行时复现 |

### Metrics
| Metric | Value |
|--------|-------|
| P1 | 0 |
| P2 | 2 |
| P3 | 1 |

### Artifacts
| File | Purpose |
|------|---------|
| `.ship/tasks/tgbuddy-vertical-slices/review-m2.md` | M2 静态评审 findings 与证据 |

### Next Steps
1. **修复 findings**（dev fix round，含回归测试）
2. **Fresh review 复验**
3. **M2 Electron E2E → 探索式 QA**
