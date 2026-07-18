# 发布、故障排查与 API Changelog

> Extension API：v1
> English: [Release, troubleshooting, and API changelog](./release-troubleshooting-changelog.en.md)
> 相关：[CLI 与测试](./cli-testing-debugging.md) · [版本与迁移](./versioning-and-migrations.md)

本页是发布 `.kunx` 的最后门槛，也是用户/开发者诊断扩展故障的起点。公开 API 变更必须同步更新这里的 Changelog、类型、Schema、兼容矩阵和中英文文档。

## 发布检查表

### 0. Kun 平台公开发布门禁

本节由 Kun 发布负责人执行，不能由某个扩展作者的测试替代。任一项未通过时，Extension Platform 不得作为公开功能发布：

- [ ] 内部平台 gate 已移除；不存在用于隐藏完整 Extension Platform 的 build/env/settings 开关，`kun extension`、`/v1/extensions/*`、Extension Center 和已授权 workbench contribution 在正式构建中可达。
- [ ] Canonical supported-version list、Runtime diagnostics、CLI validator 和 Host admission 使用同一 API/Manifest 版本源；v1 只执行 current major 1（没有 previous major），`N > 1` 时必须同时执行 current `N` 与 retained-SDK previous `N-1` Host adapter conformance。
- [ ] Current/previous negotiation fixture、future/removed major 拒绝、minor capability negotiation、RPC admission、migration crash recovery 和 rollback fixture 全部通过；旧 Manifest 被接受不能替代上一 major 的真实 Host 行为适配。
- [ ] 源码树外的临时 clean project 只从 `.tgz` 安装打包后的 `@kun/extension-api`、React bindings、test harness 与 Kun CLI，不使用 workspace/repo alias；它完成 typecheck、View Manifest、Agent call、tool、streaming Provider 和 CLI validate/pack/install/list/doctor/uninstall。
- [ ] UI 外观包、MCP、Skill 保留自己的目录、配置、Marketplace/设置入口、运行时 Provider 与测试；未被 `.kunx` registry 重解释、迁移或删除。
- [ ] 原有 Kun runtime 的 health、thread/turn、HTTP/SSE replay、approval、user-input、usage、workspace 与 provider behavior 非回归；仍只有一个 `kun serve` Agent runtime。
- [ ] 打包资源包含 Extension Host runner、CLI、SDK runtime、Manifest Schema/compatibility fixtures、全部 scaffolder templates、Extension Webview/protected-surface preload 和所需生产依赖；after-pack 缺一项即失败。
- [ ] Node 22/npm 10 的 clean checkout 在没有 `node_modules`、`packages/extension-api/dist`、`kun/dist` 和 `out` 时可直接完成 `npm ci`；bootstrap 必须先构建 public Extension API，再安装 Kun 的独立依赖树并编译 Kun，lockfile 必须能被 release runner 的 npm 版本重现。
- [ ] macOS、Windows、Linux 的 release job 都运行 `npm run check:extension-release-gate` 并生成可安装 artifact；各平台先完成 packaged Node runtime 的本地 `.kunx` install、Webview Session API、Agent tool、headless tool、custom Provider/account 和 uninstall smoke，再完成真实 Chromium desktop E2E；Linux 还必须在 upload 前直接执行最终 x86_64 AppImage。
- [ ] Daily frontier 预发布和本地 GitHub/R2 release helper 受同一顺序约束；任一 release gate、packaged Node runtime smoke 或 desktop Chromium smoke 失败时，artifact upload、latest promotion 与公开发布都不得继续。
- [ ] Electron/Webview 安全基线已在当前 pinned Electron 上复验：继承的开发/runtime override 已清除；只接受 packaged renderer 与精确 `kun-extension://` Webview target；真实 CDP contribution 点击、body marker、`Reflect.ownKeys` 桥接面、完整 Theme 与 runtime View state round-trip、无 `kunGui`/Electron/Node、Host filter 阻断下 loopback canary 零请求、user-gesture popup 被拒且无新 target，以及 protocol confinement、sender/session binding、protected consent 与 content-script exclusion 均通过。
- [ ] 发布证据记录已填写 commit、CI run、三平台 artifact/smoke、兼容/legacy 回归结果与 reviewer；`Blocked` 或没有链接的项目不能记为完成。

自动化门禁用 `npm run check:extension-release-gate` 执行：它运行门禁自身单测、源码树外 tarball acceptance、current/previous 策略以及选定的 UI Plugin、MCP、Skill、单 runtime 和 legacy Provider 行为测试；静态结构检查与 after-pack 资源断言仍作为补充。v1 的 executable conformance 只有 major 1；首次发布 v2 前，门禁会 fail closed，直到保留的 v1 SDK 位于 `packages/extension-api-compat/v1` 且 `scripts/fixtures/extension-api-conformance/v1.mjs` 能真实执行 v1 Host adapter 行为。

每个平台打包后必须依次运行两层基础 smoke：`npm run smoke:packaged-extensions -- --resources <app-resources>` 从真实 `app.asar.unpacked` 以 packaged Node runtime 完成 `.kunx` lifecycle、Kun Webview Session API、headless/Agent tool、custom Provider/account、doctor 和 uninstall；`npm run smoke:packaged-extension-desktop` 则以隔离 HOME/userData 正常启动 host-native Electron，经 CDP 点击 smoke contribution 并检查真实 Chromium Webview 安全边界。其 fixture 只显式允许动态 canary origin，并对隔离 guest 绕过资源协议的独立 CSP，使 Host request filter 成为被测控制。同步子进程与 process-tree cleanup 各自有硬超时；脚本验证 runtime/CDP 端口关闭，且不会对已退出 launcher 的旧 PID 发信号。Linux 无显示环境使用 `xvfb-run`。两种 Linux desktop smoke 前，CI 只在临时 runner 上启用存在的 user namespace 内核开关，并要求 `unshare --user --map-root-user /bin/true` 通过；这段固定准备不接收 artifact 路径或输入。`afterPack` 把真实 Electron 改名为 `<executable>.electron-bin`，在原名写入固定产品 launcher：普通 GUI 无条件前置 `--disable-setuid-sandbox`，`ELECTRON_RUN_AS_NODE=1` 的 Kun CLI 原样旁路；绝不使用 `--no-sandbox`，现代 user namespace 与 seccomp sandbox 仍然启用。`appImage.executableArgs` 只影响 `.desktop`，不能替代直接启动入口。随后运行 `npm run smoke:packaged-extension-appimage`：唯一原生 x64 产物以自身 `--appimage-extract` 解压到全新空目录，拒绝 `AppRun`、resources、embedded `app.asar`、产品 launcher、ELF payload 和唯一 root desktop entry 的 symlink 或越界，并要求精确的 `Exec=AppRun --disable-setuid-sandbox --no-first-run %U`。验证后的 resources 只来自同一最终产物且不追加外部 `app.asar`；实际 GUI 测试不注入 sandbox flag，而是清除继承的 `APPDIR`/`APPIMAGE`，设置 `APPIMAGE_EXTRACT_AND_RUN=1`，直接启动 AppImage 本体。Node 编排的子进程均使用 `shell: false`；产物 launcher 本身是内容经过精确校验的固定 `/bin/sh` 脚本。提取、同步 CLI、CDP 与 cleanup 阶段各自有界，CI AppImage step 另有 10 分钟总兜底，但本地命令不宣称单一严格总时限。未来 deb/rpm 或 `app.relaunch()` 必须重新进入 launcher 或显式保留 flag，不能默认使用指向 `.electron-bin` 的 `process.execPath`。用户直接运行 AppImage 依赖可用的 unprivileged user namespace；若启动失败，先运行 `unshare --user --map-root-user /bin/true` 诊断，再由管理员调整 userns/AppArmor policy，绝不能建议 `--no-sandbox`。前一层使用 `ELECTRON_RUN_AS_NODE`，不能证明桌面 Chromium；AppImage 层也不替代 headless/runtime flow；`linux-unpacked` 通过也不能替代最终 AppImage。自解压让 CI 不依赖 FUSE，但不证明 FUSE mount 执行或安装器行为。工作流配置和门禁通过都不是 Windows/Linux 原生执行证据；这些层也不能模拟另一个操作系统的安装器、可访问性或系统 Credential Store，因此 artifact 安装与原生平台证据必须由对应 macOS、Windows、Linux CI/实机取得。

PR 检查必须在三种原生 runner 上完成上述 smoke，且只验证、上传临时 artifact，不创建 Release。最后一个 smoke 成功后才可运行 `npm run evidence:extension-native`；生成的三平台 JSON 证据必须绑定完整 commit、GitHub run/attempt、规范 artifact、bytes 和 SHA-256，并随 artifact 上传。证据生成对缺失、多余、错误架构、目录和 symlink fail closed。macOS PR 使用不含发布秘密的 ad-hoc 签名；正式发布记录仍必须来自 Developer ID 签名、公证和 stapled ticket 均通过的受保护工作流。

可下载的 `kun-video-editor-*.kunx` 必须先于 Linux 原生 lifecycle smoke 打包，并把这个精确的普通文件依次用于 validate、install、activation、render、uninstall，且上传前复核 SHA-256 未变化；stable 与 daily publish 下载后还会再次校验该 archive。手工发布在任何构建前要求 tracked 与 untracked 工作区均干净。Windows 发布会 fetch 远端 tag，并要求它与本地 `HEAD` 指向同一 commit；将 draft 公开或把 R2 `latest` 推广前，还会下载该 tag 的完整 Release assets，统一校验三份 evidence JSON、六个原生安装包、唯一版本/commit、每个 size/SHA-256、所需 FFmpeg 能力和唯一 `.kunx`。所有以 `Kun-` 命名的 Release asset 必须命中六个 final artifact 或同版本 canonical blockmap allowlist，其他扩展名、架构、大小写或版本全部拒绝。因此缺少 Linux evidence 时，`--publish`/`-Publish` 与 `--r2-promote`/`-PromoteR2` 都必须失败；R2 推广还显式要求 mac、win、linux 三份 manifest，不能生成缺平台的 `latest`。macOS 单平台脚本的 `--r2` 只上传 metadata，并拒绝推广；推广必须由三平台校验后的 Windows 路径执行。手工发布清理会删除旧 evidence 和 `.kunx`，因为 evidence 生成刻意使用 create-only 语义。

#### 发布证据记录

| 证据 | 状态（Pass/Blocked/N/A） | Commit、CI run、artifact 或报告链接 | Reviewer/日期 |
| --- | --- | --- | --- |
| Automated release gate、external tarball project 与 current/previous conformance |  |  |  |
| Legacy UI Plugin/MCP/Skill 与 Kun runtime regression |  |  |  |
| macOS package/resource/Node runtime/Chromium desktop smoke |  |  |  |
| Windows package/resource/Node runtime/Chromium desktop smoke |  |  |  |
| Linux package/resource/Node runtime/Chromium desktop/final AppImage smoke |  |  |  |
| Migration、rollback、headless tool 与 custom Provider/account |  |  |  |

### 1. Identity 与版本

- [ ] `publisher.name` 与既有发布身份完全一致；没有把 rename 当普通更新。
- [ ] Package `version` 是新的合法 SemVer，Index 不覆盖已有版本 bytes。
- [ ] `manifestVersion`、`apiVersion`、`engines.kun`、`stateSchemaVersion` 分别准确。
- [ ] 已在目标 Kun current/previous API major 范围测试。
- [ ] 使用已弃用 API 时已有迁移；release note 写 replacement/removal horizon。

### 2. Manifest 与权限

- [ ] `kun extension validate` 无 error，warning 已修复或明确评估。
- [ ] Entry、activation event、contribution/command/tool/provider/auth 引用一致。
- [ ] Headless contribution 有 `main`，browser-only 不声称 headless。
- [ ] 权限最小化；hostname/provider/workspace scope 不使用不必要的宽范围。
- [ ] 新增 permission、Provider input capability、Node/DOM/secret-read 有清晰风险说明并触发 renewed consent。

### 3. 生命周期与可靠性

- [ ] `activate` 在 deadline 内返回，不等待网络/模型/用户。
- [ ] 所有 command/listener/tool/provider/timer/subscription/View registration 都可 dispose。
- [ ] Cancel/dispose 幂等；terminal 后不提交晚到结果。
- [ ] Queue、stream、cache、log 和 response 都有 bytes/items/time 上限。
- [ ] Host crash、timeout、circuit-open 不影响 Kun/其它扩展。
- [ ] 可能有副作用的 unknown outcome 不自动重试。

### 4. UI 与安全

- [ ] 声明式 control 使用宿主组件；复杂 UI 在 Webview，不注入 Kun React tree。
- [ ] Webview 无 Node/custom preload/direct network/remote script/eval，CSP 与 protocol resource confinement 通过。
- [ ] Theme、locale、zoom、keyboard、screen reader、focus restore、高对比/低动画通过。
- [ ] View close/guest crash/workspace switch/disable 清理 session。
- [ ] Direct DOM 只有无法替代时存在；声明 `hostDom`、isolated world、protected surface exclusion、selector failure containment。
- [ ] Credential/permission/approval/secret flow 只用 protected surface 和 Host consent token。

### 5. Agent、工具与 Provider

- [ ] Agent 只访问 own thread，budget clamp、sequence replay、steer/cancel/gate 已测试。
- [ ] Profile 只加 instruction overlay，不改 stable system prefix/policy。
- [ ] Tool 参数/输出/sideEffects/idempotency 准确，ApprovalGate/user input 不可绕过。
- [ ] Tool catalog canonicalization、epoch/drift/progressive discovery 已测试。
- [ ] Provider probe/listModels/所有 stream event/usage/tool-call/cancel/backpressure 通过。
- [ ] Explicit selected Provider/account/model 不可用时无 silent fallback。
- [ ] Provider 完整模型请求数据披露清晰，错误/日志不含 prompt/secret。

### 6. 账号、状态和数据

- [ ] Multiple account、missing/expired/interaction-required、rename/delete 已测试。
- [ ] API key/OAuth PKCE/device/refresh 通过 protected Account Broker；Webview 无 raw secret。
- [ ] Custom signer 的 secret-read 最小范围且审计/清除内存。
- [ ] Global/workspace/View state 不含 secret，遵守 quota。
- [ ] State migration 对所有 namespace 事务化，失败/crash recovery/rollback fixture 通过。
- [ ] Unavailable Provider 保留 binding/account，不删除 credential、不改绑。

### 7. 测试与文档

- [ ] Typecheck、unit/integration、SDK harness、example smoke 通过。
- [ ] GUI 关闭后的 headless tool/Provider/account path 通过。
- [ ] macOS、Windows、Linux 验证 `.kunx` 路径/ZIP/资源。
- [ ] Packaged Electron Webview/Direct DOM security E2E 通过。
- [ ] Manifest/Index JSON snippets、links/anchors、中英文件/heading/snippet 对齐。
- [ ] README/LICENSE/API reference/compatibility matrix/migration/Changelog 与 SDK 一致。
- [ ] 外部 clean project 只用 published SDK/CLI 能 build/test/pack/install。

### 8. 包与发布

- [ ] `.kunx` 包含 Manifest、integrity、README、LICENSE、entries/assets，无 secret/link/无关文件。
- [ ] SHA-256、可选签名、Index entry identity/version/engine/API/permissions 完全一致。
- [ ] 在 isolated profile 完成 install → activate → disable → rollback（如适用）→ uninstall。
- [ ] Index 使用 HTTPS exact-version immutable URL；发布不会触发自动 update 检查。
- [ ] 支持渠道知道如何收集 `doctor --json` 与脱敏 logs。

## 故障排查

先执行：

```bash
kun extension validate /path/to/source-or-package --json
kun extension doctor <publisher.name> --json
kun extension logs <publisher.name> --json
```

按顺序检查 admission → enablement/permission → lifecycle/health → resource/session → business operation。不要用关闭验证、开启 Webview Node、修改 runtime token 或实现 Provider fallback 来“修复”。

### 常见问题表

| 现象 | 重点检查 | 正确处理 |
| --- | --- | --- |
| 包无法安装 | Manifest path、integrity、ZIP path/link/collision/size、source HTTPS | 修复包并重新 pack；不关闭 validator |
| 显示 incompatible | `engines.kun`、`manifestVersion`、`apiVersion` major/capability | 安装 compatible Kun/扩展版本或按 migration guide 迁移 |
| 升级后要求重新确认 | 新 permission/input capability/signature/source 变化 | 审阅差异；不能沿用旧 consent 自动通过 |
| 扩展安装但看不到 View | global/workspace enablement、trust、`when`、`ui.views`/`webview`、entry | 修正 Manifest/grant/context；打开 View 才激活 |
| 命令不存在 | `commands` 声明、activation event、运行时 register/dispose、ID namespace | 对齐 local ID 和 `commands.register` |
| Activation timeout | `activate` 内网络/模型/用户等待、同步重任务 | 快速注册后返回，把工作移到 handler |
| Host repeatedly crashes/circuit-open | last error、memory/protocol limit、process log、restart count | 修崩溃/超限，显式 reload/re-enable；不无限自动重启 |
| Webview 白屏 | `kun-extension://` path、resource root/MIME/CSP、View Session、guest crash | 修 resource/build/CSP；不能开启 Node/remote script |
| Webview fetch 失败 | `connect-src 'none'`、`network:<hostname>`、Broker URL/redirect | 使用 Network Broker 和精确 grant；不要 direct fetch |
| Direct DOM 失效 | Kun UI 变化、private selector、surface match、permission | 容错退出并更新扩展；优先迁移到 stable View/action |
| Account 列表无秘密 | 这是预期行为 | 使用 authenticated fetch；仅 Node custom signer 申请 secret-read |
| Account interaction-required | expired/revoked refresh、需要 login/unlock、headless | 在 protected UI 重新认证；headless 不自动打开 GUI |
| Provider 不可用且没有 fallback | disable/uninstall/circuit/binding/model capability | 修复 exact binding/Provider 后显式重试；这是隐私保证 |
| Provider stream protocol error | sequence、event kind、tool fragment、payload、terminal、backpressure | 使用 SDK types/test harness，保证一个 terminal 和 ack |
| Agent 看不到 foreign thread | 这是 owner isolation | 用 extension-owned thread；没有隐式 adopt API |
| Agent 停在 approval/user input | 等待真实受保护用户交互 | 不能用 steer/Webview/content script 回答/批准 |
| Tool permission denied | invocation-time workspace/network/account/tool grant 被撤销 | 恢复明确 grant 或让工具失败；Catalog membership 不等于授权 |
| Tool unknown outcome | Host 在可能副作用后崩溃 | 人工核查外部系统；非幂等调用不要自动重试 |
| Catalog drift | 已 pinned tool Schema 与 live registry 不一致 | 新 thread 或 idle boundary 新 epoch；不要热改 prefix |
| Migration failed | from/to、namespace、quota、timeout、backup/commit marker | 修 forward migration；旧版本/状态应保持可用 |
| Rollback refused | 无 compatible state snapshot | 保持当前版本；发布向前修复，不能猜 reverse migration |
| Uninstall 后数据仍在 | 默认保留 state/log/account reference | 通过独立数据删除流程确认影响后清理 |
| Linux 打包在 `v8-primitive.h` 的 `V8_EXPORT` 处失败 | Electron native rebuild 命令是否先有 `-DV8_DEPRECATION_WARNINGS=1`、后有 `-UV8_DEPRECATION_WARNINGS` | 必须通过仓库的 `electron-builder.config.cjs` 打包并保留后置 `-U`；不要关闭 `npmRebuild` 或删掉 native module |

### Admission 失败

查看 doctor 中每个版本维度，而不是只看 package version。入口代码未执行是正确的 fail-closed 行为。Future API、过旧 API（当前 major 的 N-2）、unknown Manifest 或 engine range 不匹配必须选择 compatible artifact，不能强制加载。

### Activation/Host 故障

定位 activation cause、deadline、PID、last structured error、memory/message/concurrency/stream limit 与 circuit。模块顶层异常和 `activate` reject 都算不健康启动。修复后显式 `reload`；side-effect call 不会因为重启自动重放。

### Webview/Bridge 故障

确认 resource URL 属于自己的 selected version/resource root，CSP 不含被拒 remote/inline code，sender/session 未 stale，payload 在 Schema/size/rate 内。Workspace switch/disable 后旧 session 消息被拒绝是正常行为。

### Provider/Account 故障

检查 coherent provider + account + model binding、account status、Provider Host health、network grant、模型 capability 和 stream terminal。Authentication error 只需展示 account reference/status；不要输出 credential。Headless interaction-required 应交回可操作 continuation，不挂起。

### State/Rollback 故障

Migration 失败不能手工编辑 committed state 或 package directory。保留 backups/diagnostics，在修复版本中添加 deterministic forward migration。Rollback 只使用 retained compatible snapshot。

## 安全地收集支持信息

建议用户提供：

```bash
kun --version
kun extension doctor <id> --json
kun extension logs <id> --json
```

再附：扩展 `.kunx` SHA-256、source type、复现步骤、workspace trust/enablement（不需要 workspace 内容）、期望/实际 terminal error code。

默认输出会 redact 已知 secret、authorization、runtime/consent token 和完整 prompt，但公开前仍人工检查业务 metadata。不要索要 `.env`、Credential Store、API key、OAuth token、完整聊天/附件或未脱敏 crash dump。

## API Changelog

Changelog 记录公开 Extension API，而不是 Kun 内部重构。每项包含：API version、关联 Kun release line、Added/Changed/Deprecated/Removed/Fixed/Security、迁移动作和最早 removal major（适用时）。

下面的 public surface 快照由文档门禁从 package 入口、公开 export 和可达 `.d.ts` 计算。只有在本节已经解释兼容性影响后才更新快照；不能把更新 hash 当成 Changelog 条目。

<!-- BEGIN GENERATED SDK PUBLIC SURFACE SNAPSHOTS -->
<!-- sdk-surface-snapshot @kun/extension-api@1.2.0 sha256:b30724f4cdc3c9c1a989794a3a120e385c394a8fc6341e27a27742dabf429fbb -->
<!-- sdk-surface-snapshot @kun/extension-react@1.2.0 sha256:e2099a64dc22c05056dca0c599bafdfb22702b6d57e9b60edd2154b165323322 -->
<!-- sdk-surface-snapshot @kun/extension-test@1.2.0 sha256:386c2beca46c240f957af2c92925c410a6d801a3bcc9f87697944d9f6d23337e -->
<!-- END GENERATED SDK PUBLIC SURFACE SNAPSHOTS -->

### v1.2.0 — 媒体调度、本地分析与项目交换

Compatible Kun: 待随同一 release line 锁定；在 public package、canonical supported-version
list 和三平台 release gate 全部完成前，不得把扩展 Manifest 提前声明为 `apiVersion: 1.2.0`。

Added:

- `webview.external` 高风险权限：允许经过工作区权限审核的 View 在无 Kun preload 的隔离子 Webview 中显示远程 HTTPS 网站；顶层导航还必须匹配显式 `network:<hostname>` 授权。
- `MediaApi.createCacheTarget()`：由 Host 为 waveform、thumbnail、filmstrip、proxy、proof 与 preview 分配 disposable opaque 输出授权；扩展只选择有界格式和 purpose，不选择 cache path。
- `MediaStartFfmpegJobRequest.scheduling` 与 `MediaJobScheduling`：提供 `background` / `user` / `interactive` / `export` priority、1–3 次尝试和有界 retry base delay。Host 保持并发、排队和 transient 分类的最终权威。
- `application/x-otio+json` text output：允许最多 2 MiB 的有界 OTIO JSON 作为 text-only durable job 原子导出，并校验 root、结构界限与不透明 `kun-media://` target reference。
- `MediaApi.getAudioAnalysisCapabilities()` 和 `startAudioAnalysisJob()`：以 owner-scoped durable job 提供本地 `silence`、`beat-grid` 与 `sync-features`，结果携带 source fingerprint、算法 provenance、`local: true` 与 `networkUsed: false`。
- `MediaApi.getVisualModelStatus()`、`installVisualModel()`、`analyzeVisualFrames()` 和 `embedVisualQuery()`：提供可验证 bundled adapter receipt、真实有界 frame decode、可解释 visual feature 与明确 unsupported-query 结果；不声称通用语义模型。
- `MediaApi.startArchiveJob()`：用 opaque input/output handle、规范 archive-relative path 和有界 inline text 创建 core-owned deterministic ZIP job，返回 digest 与新 readable generated-media handle。
- `UiApi.attachComposerContext()`：已认证 View 可把有界、无路径的结构化 selection 显式挂到匹配 workspace 的主会话输入框；Host 补充 extension/version/View/workspace provenance，成功建 turn 后仅消费一次。
- `@kun/extension-test` 增加 cache target、调度/retry、OTIO、audio analysis、visual adapter、archive、取消和 restart fixture，以覆盖相同的公开 Schema 与 owner fence。

Changed:

- `ViewContribution.showInRightRail` 是默认 `true` 的可选布尔字段。右侧栏 View 可设为 `false`，继续由扩展管理页或命令打开，但不在 Code 右侧图标栏常驻；既有 Manifest 无需迁移。
- `MediaApi.readText()` 的公开 `MAX_MEDIA_TEXT_BYTES` 从 512 KiB 提升到 2 MiB，并继续要求严格 UTF-8、调用者可收紧的 `maxBytes`、opaque handle 与无路径结果。
- SRT/VTT text output 仍保持单项 192 KiB；全部 text output 总量上限为 2 MiB。纯文本、媒体与 OTIO 输出继续共同 staging、校验、提升或回滚。
- FFmpeg Job 现在由全局有界 priority/FIFO gate 排队。只有显式 transient 且已完整回滚的尝试可 backoff 重试；取消、普通失败和 unknown side effect 不自动重试。Idempotency 绑定完整规范请求而不只绑定友好 key。
- `MediaApi.getCapabilities()` 的 allowlist feature 扩展到 H.265、ProRes/FFV1、更多 audio codec、color/effect filter、silence primitive 与 muxer；返回值仍不含 executable path。
- Public fail-closed View-safe method catalog 增加上述可由认证 View 调用的方法；注册、任意 worker、secret reveal 与 credential mutation 仍不在其中。

Fixed:

- 排队和 retry backoff 可在 process spawn 前取消；运行中取消会等待 process tree 退出、staging 清理与 reservation 释放，terminal fence 拒绝晚到输出。
- 非终态 FFmpeg、音频分析和 archive 尝试在 Kun 重启后明确投影为 `interrupted` 并回滚不完整事务；已 durable 完成的输出保持原终态。

Security:

- 外部网站 guest 强制关闭 Node、Electron、Kun bridge、嵌套 Webview、设备权限和下载；初始导航、redirect 与 popup 使用授权 hostname allowlist，cookie 只进入 extension-ID 隔离的持久 partition。现有普通 Webview 继续拒绝全部外部导航。
- 音频与视觉分析只接收 owner/workspace-bound opaque handle 和有界参数；固定 Host profile 执行真实本地解码，结果记录算法/模型 identity，不接受 path、URL、filter、command 或隐式 cloud fallback。
- Bundled visual package 的 manifest、payload、签名和 install receipt 全部校验；当前 adapter 只提供可解释颜色/亮度/边缘 feature，无法支持任意语义时返回 `VISUAL_QUERY_UNSUPPORTED`，不生成伪 embedding。
- Archive entry 拒绝绝对路径、反斜线、`.`/`..`、重复项、symlink escape 和 input/output alias；OTIO export 拒绝外部 `target_url`。所有输出留在 private staging，直到原子终态提交。
- Composer context 只接受有界、无绝对路径的 JSON reference；Main 对当前 guest main frame、View contribution、精确扩展版本、workspace trust 和 `ui.actions` 重新鉴权。扩展不能提供 provenance，payload 只进入 user message content，不进入稳定 system prefix。
- Provider-neutral generation 不新增 secret-bearing Media API 或任意 Provider URL。Bundled 示例在没有已批准 broker 时返回 `unavailable`；provider permission、媒体上传和费用 authority 必须继续由 Host receipt 与公开 Network/Account/Provider 边界承担。

Migration:

- 既有 Webview 无需迁移。只有确实需要完整远程网站的扩展才新增 `webview.external` 和精确 network host，更新后会触发 renewed consent；普通 brokered fetch 继续使用 Network API。
- 既有 v1.1 扩展无需 source migration；新增字段与方法是 additive。使用新方法前更新 SDK、声明精确 media/jobs/workspace permission，并进行 capability negotiation。
- 使用新增方法的扩展应声明 `apiVersion: 1.2.0` 并随兼容 Kun Host 分发；Host 仍会协商 v1.1 与 v1.0 Manifest，不要求 source migration。

### v1.1.0 — Brokered media、durable job 与 generated artifact

Added:

- `media.read`、`media.process`、`media.export` 和 `jobs.manage` 最小权限。
- `MediaApi` 的受保护 picker、不透明 handle/stat、normalized probe、短期 View resource lease、release 和 brokered FFmpeg job 契约。
- `MediaApi.readText()` 以不透明 handle 读取最多 512 KiB 的 Host 授权 UTF-8 文本；`MediaApi.getCapabilities()` 返回 FFmpeg、ffprobe、libx264、AAC 与可选字幕 filter 的有界能力快照，扩展可在 picker/job 前给出可执行的 fallback。
- Brokered FFmpeg job 新增可选、有界的 `textOutputs`，用于 Host 授权的 UTF-8、SRT 与 WebVTT sidecar，并与媒体输出共同原子提交或回滚；没有 FFmpeg input/output/argument 时也可执行纯文本 durable job，因此 standalone subtitle export 不依赖 FFmpeg。既有调用无需迁移。
- `JobsApi` 的自有 job get/list/cursor subscription/cancel 契约、bounded progress/event/result、显式 interrupted state；不提供通用 `jobs.start` 或扩展 worker 注册。
- Tool 和 terminal job result 顶层 `generatedArtifacts`，以及不携带本地路径的 artifact/media-handle result-preview reference。
- `media.performArtifactAction()`：由已认证交互式 View 发起，对可用 generated artifact 执行 open/reveal；既有 media 调用无需迁移。
- `@kun/extension-test` 中确定性的 fake media/jobs、可配置 media capability、纯文本 job、权限失败、restart/cancellation control、executable-unavailable 行为和 artifact fixture。
- 公开且 fail-closed 的 View-safe method catalog，用于 Host boundary drift 检查。
- 可选、有界的 Manifest `localizations` 覆盖和 `resolveExtensionManifestLocale()`，用于 Host 渲染的扩展 metadata 与声明式显示字段。既有 Manifest 仍有效，基础文案始终作为 fallback；覆盖不能改变身份、权限、激活事件、可执行路径、Schema 或 Agent instructions。

Changed:

- `@kun/extension-api`、`@kun/extension-react` 和 `@kun/extension-test` 一起升级到 1.1.0。Manifest v1 与 API v1.0.0 在 major 1 内继续被接受；已有 v1.0 扩展无需 source migration。
- `ToolResult.generatedArtifacts` 和新增的 `ResultPreviewSource` artifact 字段均为可选，因此 v1.0 result envelope 与 relative-path preview 保持原有形状。

Security:

- 公开 media 契约只携带 opaque handle 与 lease，不携带绝对路径。交互式 picker/resource 方法在缺少受保护 surface 时显式失败；broker 契约不声称 trusted Node extension code 是操作系统 sandbox。
- Artifact open/reveal 请求只携带 opaque artifact ID 与 action。Main 从已认证 View Session 派生 owner、精确扩展版本和 workspace，且不返回本地路径。
- FFmpeg 创建只接受 argument array 与具名 input/output handle，并把执行交给 core-owned durable job；公开 API 不暴露 executable override、shell、process object 或 arbitrary job worker。

Compatibility notes:

- `SUPPORTED_EXTENSION_API_VERSIONS` 依次为 `1.1.0`、`1.0.0`；v1.0 Manifest 在当前 major 上协商，不需要 breaking adapter。
- Media/job 方法要求新的显式 permission 和 Host v1.1 capability。既有 v1.0 方法、Manifest 和 result source 仍然有效。

### v1.0.0 — Initial stable API

Added:

- `.kunx`、Manifest v1、integrity、registry、local/dev/HTTPS Index v1、atomic install 与 manual rollback。
- `@kun/extension-api` framework-neutral lifecycle、commands、UI、storage、network、Agent、tools、Providers、authentication contracts。
- `@kun/extension-react` 与 `@kun/extension-test`。
- Stable workbench contribution IDs、sandboxed Webviews 和高风险 unsupported Direct DOM。
- Extension-owned Agent Runs/threads、replayable events、budgets、profiles 与 pinned tool catalog epochs。
- Namespaced tools，经 Kun ToolHost/ApprovalGate 执行。
- Complete normalized streaming model Provider、multiple accounts、API key/OAuth PKCE/device flow、Credential Store 与 no-fallback routing。
- Current + previous API major compatibility policy、transactional state migration 和 bilingual developer documentation。
- 独立双语 API Reference，以及对 heading/snippet/link/anchor、公开 export 和 `.d.ts` fingerprint 的机器门禁。
- `kun extension create/validate/pack/install/list/enable/disable/uninstall/rollback/doctor/logs/reload`。
- `validate`/`pack` 的 manifest allowlist 与可重复安全 `--include`/`--ignore` 相对路径规则。
- Host 持久化的声明式 configuration：global/workspace 隔离、optimistic revision、change event、SDK/React API、Schema/quota 校验与 secret-like key 拒绝。
- 受保护账号 rename/API-key replacement、显式 workspace trust、带数据披露的 Provider/model/account 选择，以及分离的跨平台 packaged Node runtime smoke 与真实 Chromium desktop Webview E2E。

Fixed:

- `ui.showNotification()` 现在由受信工作台显示，即使没有 View Session 也不会静默丢失；它等待用户 action/关闭并向原始调用返回 action `id`/`undefined`，同时在取消、45 秒超时、工作台 lease 失效、停用和退出时清理。
- `FakeWebviewService` 可记录通知并用 `respondToNextNotification()` 为测试脚本确定性返回 action 或关闭结果；这是对既有 v1 返回契约的测试支持，不要求迁移。

Security:

- Sender/identity-bound brokers、protected consent windows/tokens、Webview Node-off sandbox/CSP、secret redaction、resource limits 和 per-extension crash containment。
- Network/Account/Index 的生产 fetch 对全部 DNS 答案执行 special-use 地址拒绝，并把获准地址 pin 到单次连接；OAuth device/token/refresh 使用同一策略，redirect 仍逐跳手动重验。
- Pack 默认不遍历 project root，并拒绝选中集合中的 VCS/dependency、dotenv、credential/private-key、nested package、link 和 source-root escape。
- Node Host 明确为 trusted current-user code，不声明为 OS sandbox。
- OAuth/device 交互材料只进入 Main-owned protected surface；Node/Webview session projection 均脱敏，认证材料同时受 network permission、Provider `credentialHosts` 和 manual redirect 检查。
- 通知 action/关闭只接受 Chromium trusted user activation；Direct DOM 合成点击不能伪造另一个扩展的用户选择，通知也不作为特权审批 surface。

Compatibility notes:

- v1 为当前首个 major，只支持 API major 1。
- Raw host DOM/CSS/React selectors 不受 v1 SemVer 保证。
- Appearance packs、MCP 和 Skills 保持独立，未迁移到 Extension API。
- v1 不提供任何自动 extension update check/prompt/download/install。

### 后续条目模板

```markdown
### vX.Y.Z — YYYY-MM-DD

Compatible Kun: <release/range>

Added:
- ...

Changed:
- ... (backwards compatible in a minor)

Deprecated:
- `<symbol>` -> use `<replacement>`; earliest removal: vN

Fixed:
- ...

Security:
- ...

Migration:
- Required developer/user action, or “None”.
```

Breaking type、method、event、permission meaning 或 required behavior 只能进入新 major。任何 Deprecated/Removed 都必须同步 type declaration、validator warning、migration guide、兼容 fixture 和中英文页面。
