# Kun 空闲内存占用分析与优化计划

日期: 2026-10-08
测量对象: `dist/Kun-0.3.10-mac-arm64-unzipped/Kun.app`(packaged, arm64, develop 近期构建)
测量机器数据: `~/.kun/data` 8.6 GB(threads 5.6 GB / 2529 个线程, observability 2.0 GB, index.sqlite3 193 MB),
`kun-settings.json` 306 KB, 启用 9 个第三方 Agent harness profile, 1 个 stdio MCP(playwright)。

## 1. 结论(TL;DR)

"打开应用什么都不做就占 2-3 GB"不是单一内存泄漏,而是四件事叠加:

1. **进程数量多,且每个 Node 进程都用 Electron 二进制跑**。空闲状态有 11 个常驻进程,
   其中 5 个是 `ELECTRON_RUN_AS_NODE` 的 Node 进程(manager、runtime、2 个进程组守护、schedule-mcp),
   每个空跑底价 58 MB(系统 node 为 38 MB)。常驻合计 1.1-1.5 GB。
2. **空闲时三进程之间的本地 HTTP RPC 流量很大**(manager 每 10 秒发出 18-27 MB,启动头 5 分钟 1.4 GB),
   每一次请求都 JSON 序列化 + zod 双向校验,产生大量短命垃圾。V8 为此把新生代撑到 56-60 MB/进程,
   RSS 在 GC 周期间剧烈震荡(runtime 205-502 MB,manager 175-442 MB,main 170-345 MB)。
   "GC 刚回收完"和"马上又涨回去"之间差 600-700 MB,用户看到的通常是高点。
3. **harness 就绪探测每 5 分钟拉起真实 CLI**。proof TTL 5 分钟、到期前 90 秒重验,
   重验时同时 spawn `claude` x2(各约 200 MB)、`agy models`(100 MB)、`codex`(70 MB)、`devin` x2(80 MB),
   瞬时多出约 650 MB,树总量从 1.5 GB 跳到 1.8 GB,之后再回落。这个脉冲永不停止。
4. **Electron main 进程急切加载了与当前功能无关的重依赖**:
   Lark SDK 被加载了两份(lib 5.3 MB + es 5.2 MB,堆里是两条 10.2 MB 源码字符串)、KaTeX、
   `react-dom/server`、一个 3.4 MB UMD 包(xlsx)、pdfjs、sharp、ssh2、node-pty 等,
   main 堆中 40 MB 是模块源码字符串,外加 code/closure 约 35 MB。

修完 P0 + P1 预计常驻从约 1.5 GB 降到 0.8-0.9 GB,并消除 650 MB 的周期性脉冲;
P2(架构项)可再压到 0.6 GB 左右。详见第 5 节。

## 2. 实测数据

### 2.1 进程树 RSS(第二次启动,约 4.5 分钟空闲,20 秒间隔三次采样)

| 进程 | RSS | 说明 |
| --- | --- | --- |
| electron-main | 222 / 307 / 291 MB | heap used 111 MB(GC 后),external 25-36 MB |
| kun-service-manager | 252 / 439 / 429 MB | heap used 80 MB(GC 后),GC 前 246 MB |
| kun-runtime | 362 / 442 / 477 MB | heap used 162 MB(GC 后),GC 前 222 MB |
| renderer | 83 / 93 / 96 MB | heap 51 MB,无需优化 |
| gpu / network | 38 / 22 MB | Electron 固定开销 |
| pgroup-guard(main 的) | 42 MB | `owned-process-guard.ts`,Electron-as-Node |
| pgroup-guard(runtime 的) | 45 MB | 同一脚本第二份 |
| schedule-mcp | 46 MB | `claw-schedule-mcp-node-entry`,runtime 的 stdio MCP 子进程 |
| playwright-mcp(npx + node) | 22 + 15 MB | 启动即 spawn,首次启动时 44 + 37 MB |
| **合计** | **1.51 / 1.51 / 1.52 GB** | harness 重探测瞬间 1.80 GB |

harness 重探测瞬间多出的子进程: `claude` 209 MB + 194 MB,`agy models` 101 MB,
`codex` 69 MB,`devin acp` 53 MB,`devin auth status` 27 MB。

### 2.2 空闲回环流量(nettop,10 秒增量,三次)

| 进程 | bytes_in | bytes_out |
| --- | --- | --- |
| manager | 1.5-2.9 MB | **18.5-27.4 MB** |
| electron-main | **12.7-21.9 MB** | 0.05-1.3 MB |
| kun-runtime | 5.9-6.3 MB | 1.8-2.0 MB |

即 manager 每秒向外推 2-2.7 MB,其中大部分流向 main。首次启动头 5 分钟 runtime 从 manager 共拉取 1.42 GB。

### 2.3 CPU 采样(inspector,40 秒,空闲)

- runtime: busy 4-8%。按包含时间排序的应用代码热点依次是
  `performManagerRequest`、`remote-room-store.call/list/get`、`remote-thread-store.list/get`、
  `runtimeInfoJsonResponse -> info -> rebuildCapabilities -> buildCapabilities`、
  `runtime-maintenance-slices.runAttachmentSlice`、`room-peer-runner.tick`、
  `agent-memory-coordinator.tick -> scrubForgottenAgentMemory -> isForgotten`。
  非应用代码里 undici fetch + zod parse 占了可计时间的大头。
- manager: busy 8.7%。热点是 `jsonResponse`、zod parse、`crypto hash update`、
  `room-store-sqlite.document/list`、`writePersistedManagerState`。它基本在给 main/runtime 当 JSON 文件服务器。
- main: busy 3.9%。

### 2.4 堆快照要点

- runtime(162 MB 自身大小): 源码字符串 25 MB(含 2.4 MB 的 Claude Agent SDK cli.js 文本、
  `@cursor/sdk`/MCP SDK chunk 各 0.5-0.6 MB、skill markdown 每份两拷贝),code 23 MB,
  closure 23 MB(86 万个,zod v4 schema 为主),object properties 31 MB。
  **4,358 个存活 Timeout + 4,336 个 `AbortSignal.timeout` 信号**:
  `managerClientRequestSignal` 用 `AbortSignal.any([AbortSignal.timeout(t), admission.signal, signal])`,
  Node 会把挂了监听器的 timeout 信号放进全局强引用集合 `gcPersistentSignals`,
  直到计时器真正到期才释放。数据面默认超时是 30 s(`MANAGER_USAGE_REQUEST_TIMEOUT_MS`),
  timeline/highestSeq 是 120 s,因此已完成的请求仍以每秒几十个的速度积累在堆里。
- manager(80 MB): 5 条 1.3-1.5 MB 的 base64 PNG(`Object.data_base64`,1280x720 截图,来自 room 文档),
  一条 0.6 MB 的 GUI 设置文档字符串,其余是 zod/模块代码。
- main(111 MB): 源码字符串 40.2 MB(Lark SDK 10.2 MB x 2、主 bundle 3.8 MB、UMD 3.4 MB、
  KaTeX 1.1 MB、react-dom-server 0.8 MB、axios 0.4 MB、uniffi/cua 0.2 MB、@oozcitak 0.2 MB),
  `JSArrayBufferData` 16.8 MB(178 块)。
- renderer(51 MB): 13.4 MB 外部脚本字符串 + 11 MB code,数据对象很少。

### 2.5 启动期行为(日志)

- 首次启动 `POST /v1/runtime/config/apply` 被调用 3 次(5.5 s / 9.5 s / 10.1 s),第二次启动 1 次(3.4 s)。
  每次 apply 都重新探测 officecli(`--version`、`--output-schema-crc`)并重建 MCP providers,
  导致 schedule-mcp 子进程在首分钟内被杀掉重拉 4 次(PID 73781 -> 73948 -> 74893 -> 75199)。
- `GET /v1/harnesses` 3.2 s,随后对每个 harness 做 `updates`/`updates/check`。
- renderer 启动时拉了 4 个线程的 timeline(`GET /v1/threads/*/timeline` 各 0.5-0.9 s)。
- 第一次 `KUN_READY` 出现在启动后 85 s,第二次 66 s。

## 3. 根因分析(按贡献排序)

### R1 空闲 RPC 风暴 -> GC 震荡(约 600-700 MB 的"高点 - 低点"差)

1. **main 每次 `store.load()` 都整份拉取设置文档**。`JsonSettingsStore.loadOnce()` 先
   `documentBackend.read()` 取回完整 306 KB 的 value 再比对 revision,命中缓存也已经传输+解析过一遍。
   main 里有 115 处 `store.load()`,很多在定时器或每个 runtimeRequest 前触发。
   这是 main 每 10 秒收 13-22 MB 的来源,也是 manager 热点里 `crypto hash update` 的来源。
   设置里 `schedule.tasks` 占 122 KB、`provider` 59 KB,文档本身也过大。
2. renderer `shared-business-storage` 每 1 秒轮询 `shared-client-state:get`(8.5 KB 文档)-> main -> manager。
3. runtime 空闲循环: rooms runtime idle tick 15 s(拉 room 列表和文档,文档内含 base64 截图),
   `agent-memory-coordinator.tick -> scrubForgotten -> isForgotten` 逐条 RPC,
   maintenance slices 的 `listPage`,`remote-thread-store.list`(2529 条摘要,文本列合计 2 MB,
   含 search_text/preview)。
4. main 的 runtime watchdog 每 10 s `GET /v1/runtime/info`,而 `runtimeInfoJsonResponse` 每次调用都
   `rebuildCapabilities()` 重新构造整份 capability manifest。
5. 以上每一跳都是 JSON.stringify -> HTTP -> JSON.parse -> zod.parse,manager 和 runtime 两端各一次。

### R2 harness 就绪探测拉起真实 CLI(周期性 +650 MB)

`kun/src/harness/harness-readiness.ts`: `PROOF_TTL_MS = 5 min`,`PROOF_REFRESH_AHEAD_MS = 90 s`;
renderer `harness-store.ts` 以 `READINESS_REFRESH_AHEAD_MS = 75 s` 对齐轮询。
结果是只要 Agent Center/composer 曾加载过 harness 列表,运行时就每 3.5-5 分钟对 9 个 profile 全量重验,
重验方式是真实拉起 `claude`/`codex`/`agy`/`devin` 并等待输出。

### R3 进程数量与 Electron-as-Node 底价(约 250 MB 纯基础设施)

| 进程 | 作用 | 是否必须独立进程 |
| --- | --- | --- |
| pgroup-guard x2 | 看护进程组、owner 死亡时清理 | 否,两份完全相同的脚本;main 的 guard 可以覆盖 runtime 的子进程 |
| schedule-mcp | 把 GUI 的计划任务能力作为 stdio MCP 暴露给 runtime | 否,可以 in-process 或懒启动 |
| playwright-mcp | 用户配置的 stdio MCP | 否,可以在首次工具调用时再 spawn |
| manager | 数据面所有者/租约仲裁 | 当前架构需要,但读路径不必经过它 |

Electron 二进制当 node 用的空跑 RSS 是 58 MB,系统 node 是 38 MB;5 个这样的进程光底价就约 290 MB。

### R4 main 进程急切加载重依赖(约 80-100 MB)

静态 import 链(`main-ready-services` / `main-ready-ipc-full` -> `register-app-ipc-handlers` -> 各 service):

- `@larksuiteoapi/node-sdk`: `claw-runtime*.ts`、`feishu-streamer.ts`、`personal-agent-im-service.ts` 共 6 处静态 import。
  堆里有两份 10.2 MB 源码字符串,说明 lib(CJS) 与 es(ESM) 两个入口都被加载(ESM 包装 + 直接 require 混用)。
  即便用户没有启用飞书渠道也会加载。
- `katex`、`react-dom/server`(`write-export-service.ts`,被 `conversation-export-service` 静态引入)。
- `xlsx`(`office-workspace-semantic-service` 被 `register-app-file-ipc-handlers` 静态引入)。
- `pdfjs-dist`(`write-pdf-text-service` 有 `loadPdfJs` 懒加载,但 `write-retrieval-index/ranking`、paper 服务静态 import 了该模块的其他导出)。
- `sharp`(6 处静态 import)、`ssh2`(remote-ssh IPC)、`node-pty`(terminal IPC)、`@trycua/cua-driver`、`electron-updater`。

### R5 启动期重复 apply 与子进程重启

首次启动 3 次 `config/apply`(startup-settings + renderer 首帧触发的设置保存),每次都重探 officecli、
重建 MCP providers(杀掉并重拉 stdio 子进程)。这不直接占常驻内存,但使启动期 RSS 峰值和耗时都翻倍,
并让 schedule-mcp/playwright 在首分钟反复 spawn。

### R6 `AbortSignal.timeout` 的保留与超时常量

见 2.4。4.3k 个 Timeout + AbortSignal + 闭包约 5-10 MB,但它同时反映了 RPC 频率。
把默认 30 s / 120 s 的数据面超时和"请求完成后不清理计时器"组合起来,就是一个与请求速率成正比的常驻集合。

### R7 数据目录膨胀(磁盘,影响扫描成本)

`observability/model-http` 1.2 GB、`observability/trajectory` 753 MB 无保留策略;threads 5.6 GB。
usage 索引已全部回填(2529/2529),所以当前空闲流量不是回填造成的,但每次 `GET /v1/usage` 0.5-1.2 s,
`thread guardian` 每 6 小时全量扫描,事件索引重建每 12 小时。

## 4. 优化计划

每项给出:改动点 / 涉及文件 / 预期收益 / 验证方式。收益为本机估算,以第 6 节脚本实测为准。

### P0(1-2 周,低风险,直接消掉脉冲与大半震荡)

**P0-1 设置文档条件读取 + 文档瘦身**
- 改动: `ManagerRevisionedDocumentClient.read()` 增加 `knownRevision` 参数,manager 路由
  `GET /v1/documents/:key?knownRevision=N` 在 revision 相同时只返回 `{revision}`;
  `JsonSettingsStore.loadOnce()` 传入已缓存 revision。manager 侧改为 revision 变更时推送
  (复用现有 SSE/notify 通道)而不是让 renderer 每秒轮询 `shared-client-state`;
  `shared-business-storage` 的 1 s 轮询降为事件驱动 + 15 s 兜底。
  把 `schedule.tasks` 的运行历史从设置文档拆到独立存储(设置只保留定义)。
- 文件: `kun/src/manager/manager-client.ts`、`kun/src/manager/service-manager-router.ts`(642 行附近)、
  `src/main/settings-store-class.ts`、`src/renderer/src/lib/shared-business-storage.ts`、
  `src/main/schedule-runtime*.ts`。
- 收益: main 入向流量从 1.5-2 MB/s 降到 <50 KB/s;main 与 manager 的 RSS 震荡幅度减半(估 -150 MB 高点)。
- 验证: nettop 10 s 增量 main `bytes_in` < 1 MB;main 新生代 `space_size` 从 56 MB 回落到 <32 MB。

**P0-2 harness 就绪探测改为懒验证**
- 改动: 空闲时不再按 TTL 自动重验。proof 过期只是标记"需重验",真正探测延后到
  (a) 用户打开 Agent Center/composer 的 harness 菜单,(b) 发送前选中该 harness,(c) 显式"重新检测"。
  探测结果(含 `expiresAt`)持久化到 `~/.kun/data/harness-readiness.json`,跨重启复用,
  启动时不再对 9 个 profile 全量探测。探测命令优先用 `--version`/`auth status` 一类轻命令,
  需要拉起完整 CLI 的探测限并发 1 并复用 `harness-pool` 已存在的会话。
  renderer `scheduleReadinessExpiry` 只负责 UI 过期显示,去掉到期自动 `loadHarnesses(true)`。
- 文件: `kun/src/harness/harness-readiness.ts`、`kun/src/server/routes/register-harness-routes.ts`、
  `src/renderer/src/store/harness-store.ts`(525-560 行)、`kun/src/session/harness-pool.ts`。
- 收益: 消除每 3.5-5 分钟 +650 MB 的脉冲;启动期少 3 s 的 `GET /v1/harnesses` 和一轮 CLI 拉起。
- 验证: 空闲 15 分钟内 `pgrep -f "claude --output-format stream-json|agy models|codex -c"` 为空。

**P0-3 MCP/officecli/apply 去重**
- 改动: 启动期把 `startup-settings` apply 与 renderer 首帧的设置保存合并为一次
  (`runtimeSupervisor.enqueueSettingsApply` 已有 coalesceKey,扩大合并窗口到 runtime ready 后 3 s);
  `applyConfig` 内只有 `capabilities.mcp` 发生变化时才 `buildMcpToolProviders`,
  否则复用旧 providers;officecli 的 `--version`/`--output-schema-crc` 结果按二进制 mtime 缓存。
  stdio MCP 改为懒连接:启动只加载上次缓存的 tool catalog(`mcp-tool-provider` 已有 catalog 结构),
  首次工具调用或用户打开 MCP 面板时再 spawn。
- 文件: `kun/src/server/runtime-composition-config.ts`(293-348、505-548 行)、
  `kun/src/adapters/tool/mcp-tool-provider.ts`、`src/main/main-runtime-startup-flow.ts`、
  `src/main/main-runtime-settings.ts`。
- 收益: 常驻 -40 MB(playwright)起,用户每多配一个 stdio MCP 多省 40-100 MB;启动期不再反复杀拉子进程。
- 验证: 日志中单次启动 `config/apply` 仅 1 次;`pgrep -f playwright-mcp` 在未使用浏览器工具前为空。

**P0-4 RPC 超时信号改为可清理**
- 改动: `managerClientRequestSignal` 用 `AbortController` + `setTimeout(unref)` 实现超时,
  请求 settle 后 `clearTimeout` 并移除对 admission/外部 signal 的监听;
  `resolveManagerDataRequestTimeoutMs` 的默认值从 30 s 降到 10 s,仅 timeline/usage 聚合保留长超时。
- 文件: `kun/src/manager/manager-client-lifetime.ts`、`kun/src/manager/manager-client-support.ts`、
  `kun/src/manager/remote-data-store-request.ts`。
- 收益: runtime 堆 -5-10 MB,去掉 4k 个常驻 Timeout;更重要的是能用"存活 Timeout 数"当 RPC 频率的回归指标。
- 验证: 堆快照里 `Timeout` 实例 < 200。

**P0-5 runtime/info 与 rooms tick 降噪**
- 改动: `rebuildCapabilities()` 结果按 config generation 缓存,`info()` 直接复用;
  rooms runtime 在没有活跃房间/没有 UI 订阅时停表(或 idle tick 60 s),
  room 文档的 list/peek 走不含 `data_base64` 的 projection,图片按需读取。
  `agent-memory-coordinator.tick` 的 `scrubForgotten` 改为仅在 memory 有变更时触发。
- 文件: `kun/src/server/runtime-composition-config.ts`(138 行)、`kun/src/server/routes/runtime-info.ts`、
  `kun/src/rooms/room-runtime.ts`(47-48、305-346 行)、`kun/src/rooms/room-peer-runner.ts`、
  `kun/src/manager/remote-room-store.ts`、`kun/src/agents/agent-memory-coordinator.ts`。
- 收益: runtime 入向流量从 0.6 MB/s 降到 <0.1 MB/s;manager 堆里 7 MB base64 消失。

### P1(2-4 周,中等改动)

**P1-1 main 进程重依赖懒加载**
- Lark SDK: 只在存在启用的飞书渠道时 `await import('@larksuiteoapi/node-sdk')`;统一只走一个入口
  (建议 `lib/index.js`,并在 `electron.vite.config.ts` 的 externalize 规则里确认不会被 ESM/CJS 双重解析),
  把类型 import 改成 `import type`。
- `react-dom/server` + `katex`: 仅在导出/渲染时动态加载(`write-export-service`、`conversation-export-service`)。
- `xlsx`、`pdfjs-dist`、`sharp`、`ssh2`、`node-pty`、`@trycua/cua-driver`: 全部改为按需 `import()`,
  IPC 注册只注册 handler 不引入实现模块(用 `() => import('./service').then(m => m.fn(...))`)。
- 文件: 见 3.R4 列表;加一个 `scripts/check-main-eager-deps.mjs` 用 `node --import`/esbuild metafile
  列出 main 入口静态可达的 node_modules,作为门禁。
- 收益: main 常驻 -60-90 MB(源码字符串 40 MB + code/closure),启动更快。
- 验证: 堆快照 "source-code" 字符串桶 < 12 MB;模块缓存中不含 larksuite/katex/react-dom 直到功能被触发。

**P1-2 进程合并**
- 两个 pgroup-guard 合一: runtime 启动时通过环境变量拿到 main 侧 guard 的 IPC 句柄/控制目录,
  `owned-process.ts` 在有外部 guard 时不再 spawn 自己的;或把 guard 换成更轻的方案
  (macOS/Linux 用 `kqueue`/`prctl(PR_SET_PDEATHSIG)` + 进程组 kill,仅 Windows 保留脚本)。
- schedule-mcp in-process: runtime 已经能直接调用 GUI(`workbench-bridge`),把计划任务工具做成
  runtime 内置 tool provider,通过现有 HTTP 调回 main,不再作为 stdio MCP 子进程。
- 文件: `kun/src/process/owned-process.ts`、`kun/src/process/owned-process-guard.ts`、
  `src/main/claw-schedule-mcp-config.ts`、`src/main/claw-schedule-mcp-server.ts`、`kun/src/workbench-bridge/`。
- 收益: 常驻 -90-140 MB。
- 验证: 空闲进程树里 Electron-as-Node 进程从 5 个降到 2 个(manager + runtime)。

**P1-3 数据面传输瘦身**
- `remote-thread-store.list` 默认返回轻量 projection(不含 `search_text`、`preview` 全文、`todos_json`),
  需要全文时显式传 `fields`;`listPage` 作为 maintenance 的唯一入口并记录游标。
- zod 校验只在 manager 边界做一次,runtime 端对 manager 响应用 `z.lazy` 的 passthrough 或类型断言
  (两端是同一构建产物,契约由 buildId 保证)。
- 文件: `kun/src/manager/remote-thread-store.ts`、`kun/src/manager/shared-data-store-implementation.ts`、
  `kun/src/manager/remote-data-stores.ts`、`kun/src/adapters/hybrid/hybrid-thread-store.ts`。
- 收益: 每次 list 从约 3-4 MB 降到 <300 KB;manager/runtime 新生代回落。

**P1-4 V8 参数与进程内观测**
- 给 manager/runtime/guard/MCP 子进程统一加 `--max-semi-space-size=16`(先测 8 与 16 的 GC 频率差异),
  对 guard 与 schedule-mcp 加 `--max-old-space-size=64`。
- `GET /v1/runtime/info` 增加 `memory` 字段(各进程 rss/heapUsed、子进程数、pending timers),
  日志每 5 分钟打印一行,方便用户反馈时直接定位。
- 文件: `src/main/kun-process.ts`(buildKunServeArgs)、`kun/src/process/owned-process.ts`、
  `kun/src/server/memory-pressure-monitor.ts`(已有 snapshot 函数可复用)。

### P2(长期 / 架构)

**P2-1 读路径绕过 manager**: runtime 对 `index.sqlite3`/`events.jsonl` 的只读访问直接走本地文件
(sqlite WAL 允许多读者),manager 只保留写入仲裁、租约和跨进程通知。这是消除 RPC 风暴的根本解,
也让 P1-3 的大部分 projection 工作变成可选项。涉及 `runtime-factory-storage.ts`、
`shared-data-store-implementation.ts`、`hybrid-thread-store.ts` 的读写拆分。

**P2-2 数据保留策略**: `observability/*` 按大小/天数轮转(默认 500 MB 或 14 天),
threads 冷归档(90 天未访问的 events.jsonl 压缩),`GET /v1/usage` 走预聚合表而不是 189k 行扫描。

**P2-3 CI 内存基线**: 在 packaged smoke 里加"启动后 3 分钟空闲,进程树 RSS 总和 < 1.0 GB、
Electron-as-Node 进程数 <= 2、无 harness CLI 子进程"的断言,防止回归。

## 5. 预期收益汇总(本机估算)

| 项 | 常驻 RSS 变化 | 峰值/脉冲变化 |
| --- | --- | --- |
| P0-1 设置文档条件读取 | -100 ~ -150 MB(main+manager 震荡幅度) | 高点 -150 MB |
| P0-2 harness 懒验证 | 0 | **-650 MB 周期脉冲** |
| P0-3 MCP/apply 去重 | -40 MB(每个 stdio MCP 再 -40~-100) | 启动峰值 -200 MB |
| P0-4/P0-5 RPC 降噪 | -30 ~ -60 MB | 高点 -100 MB |
| P1-1 main 懒加载 | -60 ~ -90 MB | 启动更快 |
| P1-2 进程合并 | -90 ~ -140 MB | |
| P1-3 传输瘦身 | -50 ~ -100 MB(新生代回落) | |
| **P0+P1 合计** | **约 1.5 GB -> 0.8-0.9 GB** | **1.8 GB -> <1.0 GB** |
| P2-1 读路径直连 | 再 -100 ~ -200 MB | |

## 6. 验证方法与回归门槛

本次测量用到的方法都可以脚本化(建议放到 `scripts/mem/`):

1. **进程树 RSS**: 从 `Kun.app/Contents/MacOS/Kun` 的 pid 递归 `pgrep -P`,`ps -o rss=,command=`,
   每 20 s 一次,至少 2 分钟;注意 manager/runtime 的 `process.title` 是 `kun-service-manager`/`kun-runtime`,
   按命令行 grep 会漏掉它们。
2. **回环流量**: `nettop -P -L 4 -d -s 10 -J bytes_in,bytes_out -p <main> -p <manager> -p <runtime>`,
   看 10 s 增量。门槛: manager `bytes_out` < 2 MB/10 s。
3. **inspector**: `kill -USR1 <pid>` 打开 9229,或 `open -n Kun.app --args --inspect=9230 --remote-debugging-port=9231`
   采 main/renderer;用 CDP 的 `Profiler`、`HeapProfiler.takeHeapSnapshot`、
   `process.getBuiltinModule('node:v8').getHeapSpaceStatistics()`。
   门槛: 各进程 `new_space.space_size` < 32 MB;runtime 堆中 `Timeout` 实例 < 200;
   main 堆 "source-code" 字符串 < 12 MB。
4. **子进程脉冲**: 空闲 15 分钟内对 `claude|codex|agy|devin` 子进程计数为 0。
5. **启动期**: `kun-*.log` 中单次启动 `config/apply` 次数 == 1,officecli `startup` 行 == 1,
   schedule-mcp 的 PID 全程不变。

## 7. 风险与注意事项

- P0-1 的条件读取要保证 revision 比较与写入竞争安全(写入仍走 `write(expectedRevision)`),
  且推送通道断开时要有兜底轮询。
- P0-2 改变了"harness 就绪状态始终新鲜"的假设:发送前如果 proof 过期需要先探测,要给 composer 一个
  可见的"检测中"状态而不是静默等待;Agent Center 的"检测中"徽标逻辑(见 memory 中的 refresh-ahead 修复)需同步调整。
- P0-3 懒连接 MCP 时,工具目录快照可能过期;首次调用失败需回退到 connect + 重新列工具。
- P1-1 的动态 import 会把首次使用的延迟从启动期移到首次操作,导出/飞书/终端首次使用会慢 0.2-1 s,可用预热策略(应用 ready 后 30 s 空闲时预加载已启用功能的模块)缓解。
- P1-2 合并 guard 时要保留 Windows 路径(当前 guard 脚本里有 Windows 专用逻辑),并确保 runtime 异常退出时其子进程仍被清理。
- 以上测量在 2529 个线程、8.6 GB 数据目录的机器上完成;线程少的用户震荡幅度会小一些,
  但 R2(harness 脉冲)、R3(进程底价)、R4(main 急切加载)与数据量无关。
