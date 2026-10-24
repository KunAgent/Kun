# Gen UI 与 MCP Apps 实现计划

状态:P0-P3 已实现(2026-10-19,Lab 开关默认关闭);P1.5 与 P4 未做。实际实现与本计划的差异见第 15 节。
目标是让 Kun 的 Agent 在桌面会话里直接生成可交互界面(Gen UI),
并作为 MCP Apps 宿主运行第三方/内置的交互页面,其中第一个完整应用是可由 Agent 与用户共同编辑的画布。

参考:一个开源桌面 Agent 的 v3.15.1 实现(宿主协议、沙箱、Gen UI、五个示例应用)。下文只记录可借鉴
的机制,源码、Skill、提示词和类名中不出现参考产品名称。

## 0. 结论速览

- **分三层能力,一套沙箱。** L0 是现有的受治理可视化(`render_chart`、`show_visualization`,只接受数据);
  L1 Gen UI:Agent 写 HTML 片段,桌面在会话内用沙箱渲染,可保存控件状态并由用户发起追问;
  L2 MCP Apps 宿主:任何在工具 `_meta.ui.resourceUri` 声明 `ui://` 页面的 MCP server 都能在会话卡片
  或右侧面板里运行页面,页面可调用本 server 的工具、给下一轮附上下文;L3 是内置画布 MCP App。
  L1 与 L2 共用 Electron Main 的同一个沙箱宿主、同一个窗口级页面管理器。
- **页面协议用官方 `@modelcontextprotocol/ext-apps`(2.0.x,MIT)。** 它的 peer 依赖是
  `@modelcontextprotocol/core|client` v2,与 `kun/` 现用的 `@modelcontextprotocol/client@2.2.0` 同代。
  宿主侧用 `ext-apps/app-bridge`,页面侧不需要 Kun 专属 SDK;为其它 MCP Apps 宿主写的页面可直接运行。
  Kun 扩展能力只放 `hostCapabilities.experimental["kun/…"]`。
- **Gen UI 走工具,不走 Markdown 指令。** 新增 `render_widget` 工具(与 `render_chart` 同路径:工具项
  → 投影 → 会话块),HTML 快照存入内容寻址的 artifact store。好处是事件持久化、重放/分叉/恢复、
  TUI/IM/移动端降级全部沿用现有链路,不需要解析"已完成消息里的指令"。
- **画布以标准 MCP App 交付。** 随应用分发一个 `managedBy: 'kun:canvas'` 的 stdio MCP server,
  页面是打包好的 Excalidraw 编辑器,文档仍存放在现有 `.kun-whiteboards/<boardId>/`,
  工具按元素 ID 做带 `expectedRevision` 的增量操作。它同时是宿主协议的验收用例。
- **命名。** "UI 插件"在 Kun 已指形象工坊皮肤包(`docs/UI_PLUGINS.md`),"Apps in Rooms"指远程 MCP 连接。
  本功能对外叫 **Gen UI** 与 **MCP App**,侧栏页面叫 **App 面板**;代码目录用 `app-surfaces`、`gen-ui`、`mcp-apps`。
- **全部先挂 Lab 开关,默认关闭**:`lab.genUi.enabled`、`lab.mcpApps.enabled`。

## 1. 参考实现拆解

### 1.1 Gen UI

| 环节 | 参考实现做法 | Kun 取舍 |
| --- | --- | --- |
| 生成 | Skill 教模型把 HTML 片段(无 `<html>/<head>/<body>`)写到会话专属输出目录,并在最终回复里单独一行写 `::visualize{"path":"…","mode":"wide"}` | 改为 `render_widget` 工具;保留"片段 + 宿主外壳"的写法 |
| 加载 | 回复完成后宿主读文件(有界、拒绝符号链接),以 `contentKind: "gen-ui"` 登记沙箱,内存分区 | 从 artifact store 读快照,同样走内存分区 |
| 外壳 | 宿主在作者脚本前注入:转义后的状态快照、页面桥、主题变量、CSS 工具类;作者脚本后注入组件库 | 同,主题变量映射到 Kun 公开 token |
| 第三方库 | CSP 只放行固定 CDN 白名单;D3、Lucide、Floating UI 的固定 CDN URL 在请求闸门内映射到随包文件,按清单哈希校验 | 同,且优先离线(国内网络下 CDN 不可靠) |
| 页面 API | `widgetState`、`setWidgetState({modelContent, privateContent})`(合计 ≤16 KiB)、`sendFollowUpMessage({prompt,title})`、`openExternal({href})`、`set_globals` 事件 | 同名语义,挂在 `window.kun` |
| 状态进上下文 | 只有 `modelContent` 作为 `<untrusted_gen_ui_state>` 附在下一次用户输入后,总量 ≤64 KiB | 用 `kun_context_block` 注入,不进稳定前缀 |
| 追问 | 有原生手势(5 秒一次性 token)直接发,否则弹确认;只读/失效会话不能发;改状态永不自动开回合 | 同 |
| Tweak | 页面用对象绑定注册滑块/颜色/开关/选择,宿主统一渲染调节面板、重置、原始效果预览和显式提交 | 放到 P1.5 |

### 1.2 MCP Apps 宿主

- **握手与能力**:Agent 对每个 MCP server 的 `initialize` 宣告
  `extensions["io.modelcontextprotocol/ui"].mimeTypes = ["text/html;profile=mcp-app"]`,否则按官方模板写的
  server 只注册纯文本工具。
- **工具元数据**:`_meta.ui.resourceUri`(兼容旧扁平键 `ui/resourceUri` 与 `openai/outputTemplate`),必须
  `ui://` 开头、≤2048 字符,非法则整个 UI 描述作废;`_meta.ui.visibility` 缺省 `["model","app"]`,不含
  `model` 的工具不进模型工具表;`_meta.ui.surface` 把工具结果路由到某个侧栏面板。
- **资源**:`text/html;profile=mcp-app`,HTML ≤16 MiB,页面读资源 ≤8 MiB 且有 MIME 白名单;资源
  `_meta.ui.csp` 声明 `connectDomains/resourceDomains/frameDomains/baseUriDomains`,未声明一律不放行。
- **沙箱结构**:webview 加载宿主自有的 shell 页(独立 origin),shell 再用 iframe 加载插件 HTML(另一个
  origin,`frame-ancestors` 只允许 shell)。官方 `App` 默认向 `window.parent` 发消息,所以需要这一层
  iframe;shell 只把 JSON-RPC 原样转发到宿主 renderer 的 MessagePort。guest 固定
  `contextIsolation/sandbox/webSecurity`,禁 Node、webviewTag、弹窗、对话框、表单提交。
- **页面能力**:`callServerTool`(只能调本 server,沿用 Agent 的权限与审批)、`readServerResource`、
  `listServerResources`、`sendMessage`、`updateModelContext`(进输入区可见可删的上下文,不立即发送)、
  `createSamplingMessage`(App 内调用当前任务模型,结果不进主对话)、`registerTool`(活页面向模型提供工具)、
  `requestDisplayMode`(inline ↔ fullscreen=侧栏)、`sendSizeChanged`、`openLink`、`downloadFile`、
  `sendLog`;扩展的 `widgetState`、资源订阅、surface、CSP 放宽(`unsafe-eval`/`wasm-unsafe-eval`)。
- **初始结果上限**:`structuredContent` 64 KiB、页面元数据 16 KiB、`content` 32 KiB,超限省略并标记。
- **生命周期**:窗口级页面管理器统一管理 Gen UI 与 MCP 页面;最多 64 个活页面;离屏连续 5 分钟回收,
  侧栏展示中或有审批/调用在途时不回收;卡片/侧栏只登记锚点,inline ↔ 侧栏移动保留同一个 guest,
  不重读资源、不重新握手;失败/取消的工具只保留普通工具卡,不占页面。

### 1.3 画布示例(Excalidraw)

插件自己的 MCP server 用 SQLite 按工作区保存文档与 revision;模型工具 `create_diagram`、`open_diagram`、
`read_scene`、`apply_operations`(带 `expectedRevision` 与幂等 `operationId`)、`export_diagram`;仅页面工具
`commit_scene`、`list_diagrams`、`save_copy`、`save_image`。用户框选元素后"引用选区到对话",经
`updateModelContext` 变成输入区的插件上下文,发送时 Agent 才收到。单文档 ≤5000 元素/6 MiB,资源随包离线。

## 2. Kun 现状:可复用资产与缺口

| 能力 | 现有实现 | 缺口 |
| --- | --- | --- |
| 受治理可视化 | `kun/src/adapters/tool/chart-tool-provider.ts`、`conversation-visualization-tool-provider.ts`;渲染 `ChartRenderer.tsx`、`ConversationVisualizationCard.tsx`;投影 `kun-mapper-tools.ts`、`chat-projection-reducer.ts`、`derive-turn-sections.ts`;Lab `lab.conversationVisualization.enabled` | 只接受结构化数据,不能表达模拟器、可调参数、原型 |
| 沙箱 webview | 扩展 View:`src/main/extensions/extension-webview-security.ts`(`will-attach-webview` 守卫)、`extension-view-sessions.ts`(View Session 绑定 owner/nonce)、`extension-resource-protocol.ts`(`kun-extension://`)、`src/preload/extension-view.ts`(窄 bridge) | 只服务已安装包内文件;没有"内存 HTML 实例 + 按实例 CSP";没有 shell+iframe 结构与 MessagePort 转发 |
| 原型 webview | `src/main/services/prototype-embed-registry.ts`(file:// 白名单,`kun-proto` 分区) | 只适合工作区文件;无 bridge |
| MCP 客户端 | `kun/src/adapters/tool/mcp-transport.ts`(只声明 `elicitation`)、`mcp-types.ts`(描述符已有 `_meta`)、`mcp-tool-runtime.ts`(`createMcpLocalTool` 原样返回 `result`,`structuredContent` 能保留) | 未宣告 UI 扩展;工具 `_meta.ui` 被丢弃;`visibility: ["app"]` 工具仍会进模型;无页面专用的资源读取/工具调用路由 |
| 回合外工具执行 | `kun/src/server/routes/kun-tools-mcp.ts` 经 `KunToolBridgeHost` 走规范 ToolHost | 要求线程有运行中回合;页面在回合结束后点按钮也要能调用 |
| 画布 | `src/renderer/src/whiteboard/*`(Excalidraw 0.18,渲染进程内),工具 `design_apply_excalidraw`/`design_open_excalidraw`,文档在 `.kun-whiteboards/<boardId>/` | 私有协议,只能在 Kun 自己的 renderer 里驱动;不是 MCP App |
| 右侧面板 | `src/renderer/src/extensions/contribution-ids`、`components/workbench/code-right-tabs-state.ts`、`useWorkbenchExtensionSurfaces.ts` | 需要新的贡献 ID 族 `mcp-app:<server>:<surface>` |
| 输入区上下文 | `packages/extension-api/src/composer-context.ts`(≤8 个附件,引用 ≤16 KiB)及 design/write 的 composer context | 可直接承载 `updateModelContext` |
| 动态上下文 | `kun/src/prompt/kun-prompt-context.ts` 的 `kun_context_block`、`TurnClientSurface` | 可承载 Gen UI 状态与输出目录,不碰稳定前缀 |
| 内置 Skill / MCP | `resources/bundled-skills/*`;`kun/src/contracts/builtin-mcp.ts` 的 `managedBy` 托管条目 | 新增 `gen-ui` Skill 与 `kun:canvas` server |

## 3. 目标与非目标

目标:

1. G1 Gen UI:Agent 在 GUI 会话中生成可交互页面,内联显示,可展开到侧栏,状态可保存并参与下一轮。
2. G2 MCP Apps:兼容官方 MCP Apps 规范的 server 无需改动即可在 Kun 内联/侧栏运行,能力按协商声明。
3. G3 可编辑画布:Agent 画初稿、用户手改、引用选区让 Agent 局部修改,双方共享同一份持久文档。
4. G4 安全:页面拿不到 Node、`window.kunGui`、运行时令牌、任意文件或网络;工具调用沿用现有审批。
5. G5 降级:TUI、CLI、IM、移动端、旧客户端看到普通工具记录与文字摘要,不声称"已显示界面"。

非目标(本计划内不做):Web/移动端渲染交互页面、多人实时协作、页面发布/分享为网站、替代
`render_chart`(结构化图表仍优先用它)、在扩展 manifest 中声明 MCP App(可作为后续)。

## 4. 总体架构

```text
kun serve                               Electron Main                        Renderer
---------------------------------       ---------------------------------    -----------------------------------
render_widget 工具 + HTML 快照          kun-app:// 协议(shell/guest 两个    AppPageManager(窗口唯一,容量/回收)
Gen UI 状态存储 + context block           origin,按实例 CSP,no-store)        AppPagePlane(webview 浮层定位到锚点)
MCP: UI 扩展宣告、工具 _meta.ui          AppSandboxRegistry(内存 HTML、     GenUiCard / McpAppCard / App 面板
  归一化、visibility 过滤                  owner webContents、分区、凭证)     GenUiBridgeHost(私有 JSON-RPC)
/v1/mcp-apps/*:资源读取、页面工具        will-attach-webview 加固             McpAppHost(ext-apps AppBridge)
  调用、sampling、实例凭证               MessagePort 交给 shell preload       composer context 芯片、追问确认
内置 kun:canvas stdio MCP App            手势 token、截图复制                 Lab 开关与设置
```

数据流:

- **Gen UI**:模型调用 `render_widget` → runtime 校验、存 artifact、返回 `{genUi:{artifactId,sha256,title,mode}}`
  → mapper 投影成 `gen_ui` 块 → 卡片可见时 renderer 经 IPC 取 HTML → Main 登记实例(注入外壳)
  → webview 挂到浮层 → 页面 `setWidgetState` → renderer → `PUT /v1/threads/:id/gen-ui/state`
  → 下一轮 runtime 把 `modelContent` 拼成 `kun_context_block kind="gen-ui-state" authority="reference"`。
- **MCP App**:`tools/list` 时归一化 `_meta.ui` 存进工具记录 → 调用完成后工具项带
  `mcpApp:{serverId,resourceUri,surface?,toolCallId}` → renderer 请求实例 → runtime 签发实例凭证并读取
  `ui://` 资源 → Main 登记、按资源 CSP 生成响应头 → renderer 建 `AppBridge`,转发 tool-input/tool-result
  → 页面 `callServerTool` → renderer → `/v1/mcp-apps/tools/call`(审批、审计)→ 原始 `CallToolResult` 返回页面。

## 5. P0 统一沙箱宿主

### 5.1 协议与结构

- 在 `src/main/privileged-schemes.ts` 注册 `kun-app`(standard/secure/stream,不 bypassCSP)。
- URL:shell `kun-app://shell-<instanceId>/`,guest `kun-app://guest-<instanceId>/index.html`。两者不同 origin;
  `instanceId` 只含 `[A-Za-z0-9-]`(CSP host-source 字符集,非法直接拒绝,避免 `frame-ancestors` 静默失效)。
- shell 是 Kun 自有的静态页(构建进 `out/`),CSP `default-src 'none'; script-src 'self'; frame-src kun-app:`;
  它创建 guest iframe,把 preload 交来的 MessagePort 与 iframe 的 `postMessage` 双向转发,**不解析协议**。
- 为什么不用 renderer 里直接放 iframe:渲染进程 CSP `script-src 'self'` 会被 srcdoc/blob iframe 继承,
  内联脚本全部失效(写作原型已踩过);webview 还带来独立进程和分区。
- 全部实例响应 `Cache-Control: no-store`,协议 handler 每次校验 origin、实例路径和登记状态。

### 5.2 Main 模块(新目录 `src/main/app-sandbox/`)

| 文件 | 职责 |
| --- | --- |
| `app-sandbox-registry.ts` | 实例登记:`kind: 'gen-ui' | 'mcp-app'`、HTML、CSP、分区、ownerWebContentsId、线程/server 绑定、运行时凭证;上限 64;撤销时先关端口再把 guest 导航到 `about:blank` |
| `app-sandbox-protocol.ts` | `kun-app://` handler:shell 静态资源、guest HTML(注入外壳后)、Gen UI vendor 映射 |
| `app-sandbox-csp.ts` | 由资源 `_meta.ui.csp` 生成 CSP;缺省 `default-src 'none'`、`connect-src 'none'`、`form-action 'none'`;`unsafe-eval`/`wasm-unsafe-eval` 仅在资源 `_meta["kun/csp"]` 声明时放行 |
| `app-sandbox-guest-policy.ts` | 在 `extension-webview-security.ts` 的 `will-attach-webview` 中新增 `kun-app:` 分支:校验 owner、分区、实例;强制安全 WebPreferences,删除 `allowpopups` 等参数 |
| `app-sandbox-gestures.ts` | guest 输入事件产生 5 秒一次性手势 token,供追问、外链、下载校验 |
| `app-sandbox-ipc.ts` | `appSandbox:register|dispose|attach-port|copy-image`;schema 放 `src/shared/app-sandbox-contract.ts` |

分区:Gen UI 用内存分区 `kun-genui`(状态靠 runtime 恢复,不靠浏览器存储);MCP App 用
`persist:kun-app-<hash(serverIdentity)>`,同一 server 的页面共享 localStorage,卸载 server 或"清除数据"时
先停全部 guest 再 `clearStorageData`。权限请求(camera/microphone/geolocation/clipboardWrite)默认拒绝,
P4 再按资源声明 + 受保护确认放开。

### 5.3 Renderer 页面管理(新目录 `src/renderer/src/app-surfaces/`)

- `app-page-manager.ts`:窗口唯一;按逻辑键(workspace、thread、kind、server、resource、toolCallId 或 surfaceId)
  去重;容量 admission 串行,活页面上限 32(webview 是独立渲染进程,参考 Kun 的空闲内存治理,比参考实现的 64 更保守);
  离屏 5 分钟回收;侧栏展示或有调用在途时不回收。
- `app-page-plane.tsx`:所有 webview 挂在一个不随卡片卸载的浮层里,**从不 reparent**(Electron webview
  移动 DOM 会重载 guest),用 `ResizeObserver` + rAF 把 webview 定位到卡片/侧栏锚点并按滚动容器裁剪。
  inline ↔ 侧栏只是换锚点,同一个 guest、不重新握手。
- 坐标:应用 `body` 有 `zoom: 0.82`,锚点矩形与 webview 尺寸必须统一用 `getBoundingClientRect()` 换算,不能混用
  `clientWidth`。
- 高度:默认 240px,范围 [80, 1200](Gen UI 自然流可到 10000px);hostContext 只回传宽度与 `maxHeight`,
  避免高度回环;布局按帧合并。

验收:单测覆盖 CSP 生成、实例 ID 校验、guest 拒绝路径(未知实例/分区不符/owner 不符)、撤销顺序;
`npm run dev` 下用一个静态 fixture 页面验证 shell→iframe→MessagePort 往返。

## 6. P1 Gen UI

### 6.1 Runtime(`kun/`)

- 合约 `kun/src/contracts/gen-ui.ts`:`GenUiRenderInputSchema`
  `{ title: string≤120, html?: string, path?: string, mode?: 'inline'|'wide', replaces?: string }`,`html` 与 `path` 二选一;
  HTML ≤1 MiB(模型生成内容),快照上限 5 MB;`GenUiWidgetStateSchema` `{modelContent, privateContent}`
  合计 ≤16 KiB,仅 JSON 值;路径 schema 拒绝 `..`、NUL、换行,文件名小写连字符 `.html`。
- 工具 `kun/src/adapters/tool/gen-ui-tool-provider.ts`:`render_widget`,`kind: 'gui'`,只读、无网络、
  `shouldAdvertise` = Lab 开关开启 **且** 本回合 `TurnClientSurface === 'gui'`。
  - `html` 模式:直接校验并写 artifact。
  - `path` 模式:只接受 Gen UI 输出根目录下的非符号链接文件,读出后写 artifact。这样模型可以用普通文件
    工具增量编辑大页面,而历史中的旧卡片仍指向当时的快照,不会被后续编辑改变。
  - 输出 `{status, summary, genUi:{artifactId, sha256, bytes, title, mode}}`;`summary` 是给 TUI/IM 的文字降级。
- 输出目录:`<dataDir>/gen-ui/<hash(workspaceIdentity)>/<threadId>/`,不写进工作区、不进 Git;文件工具的写入白名单
  需要加入这个根目录(只在 Lab 开启时)。目录路径通过 `kun_context_block kind="gen-ui-output"` 在 GUI 回合告知
  模型,不进稳定前缀。
- 状态存储 `kun/src/gen-ui/gen-ui-state-store.ts`:每线程一个 JSON(原子替换 + 现有跨进程锁),按
  `artifactId` 归档;路由 `GET|PUT /v1/threads/:id/gen-ui/state`;分叉线程时复制状态;归档/删除线程时一起清理。
- 上下文注入:下一次用户输入时,把本线程最近 N 个 `modelContent`(按卡片排序,总量 ≤64 KiB)渲染成
  `kun_context_block kind="gen-ui-state" authority="reference"`,内容按不可信数据转义 `<`。
- 模型历史:`render_widget` 的 `html` 参数在 v1 原样保留(与模型写文件的成本相同);若测得长会话 token 压力大,
  再在**写入时**决定是否以稳定摘要替代,不能事后改写历史以免破坏前缀缓存。

### 6.2 Renderer

- 投影:`kun-mapper-tools.ts` 识别 `render_widget` 成功结果,`chat-projection-reducer.ts` 生成
  `{kind:'gen_ui', artifactId, title, mode}` 块;工具参数仍在流式生成时显示骨架(复用 `isPendingRenderChartTool` 的做法);
  `derive-turn-sections.ts` 保持"文字结论在前、可视化在后"的布局约定。
- `GenUiCard.tsx`:无边框自然流卡片;操作:展开到侧栏、复制为图片(Main `capturePage` 校验 owner 与几何)、
  在浏览器打开导出版(P1.5);`wide` 模式占满会话宽度。
- `gen-ui-bridge-host.ts`:私有 JSON-RPC(不是 MCP),方法 `kun/gen-ui/state`、`kun/gen-ui/follow-up`、
  `kun/gen-ui/open-link`、`kun/gen-ui/size`;**不提供** callTool、资源读取或文件访问。
- 追问:`sendFollowUpMessage` 先验手势 token,无手势弹确认(显示来源卡片标题与 prompt 全文);
  只读/归档线程拒绝;发送复用现有 composer `sendMessage`,忙时按现有队列语义排队;改状态永不开回合。
- 外链:只允许 `http/https`,经现有 `openExternal` 白名单;片段内锚点留在页内。

### 6.3 外壳与主题

- 页面外壳在 Main 生成:CSP + `<script>` 注入状态快照(JSON 转义)+ `gen-ui-bridge.js` + 主题变量 + 工具类 CSS,
  作者片段在中间,组件脚本(日历等)在后。
- 主题变量用一组**公开、稳定**的名字(`--background`、`--foreground`、`--card`、`--muted`、`--muted-foreground`、
  `--primary`、`--border`、`--viz-series-1..6` 等),在 Main 从 Kun 当前主题解析成具体颜色值后写入;
  不暴露 `--ds-*` 内部 token(内部 token 有未定义与 Tailwind 透明度失效的历史问题)。
- 第三方库:随包提供 D3、Lucide 等固定版本,`vendor/manifest.json` 记录版本与 SHA-256;CSP 只放行固定 CDN
  白名单,且这些固定 URL 在协议闸门内映射为本地文件,缺失即失败、不回退网络。

### 6.4 Skill

新增 `resources/bundled-skills/gen-ui/SKILL.md`(自写,不复制参考实现文本):

- 何时用:需要让用户"看到/调整/探索"才更好理解时;表格用 Markdown,静态结构用 Mermaid,
  结构化数据图表优先 `render_chart`,项目内的网页/组件需求走普通代码流程。
- 怎么写:片段、根元素唯一 ID、只用主题变量、≤1 MB、不发网络请求、用 `window.kun.widgetState` 恢复、
  有意义的交互后 `setWidgetState`、追问按钮调用 `sendFollowUpMessage`。
- 回复:文字只说结论,不宣布"生成了 HTML/组件"。

P1.5:Tweak(对象绑定的滑块/颜色/开关/选择,单组 ≤12 控件、页面 ≤64 组,宿主统一面板与显式提交)、
导出为独立 HTML(带本地状态回退)、日历等内置组件。

验收:Lab 开关开启后,"用交互页面解释正弦波,能拖动振幅和频率"生成内联卡片;刷新应用后卡片与已保存
状态恢复;点击追问按钮弹确认并在当前线程发送;TUI 同一线程只显示摘要;关闭开关后新回合不再广告工具,
历史卡片仍可渲染。

## 7. P2 MCP Apps(内联)

### 7.1 Runtime

- 合约 `kun/src/contracts/mcp-apps.ts`(纯函数、零 IO):`normalizeMcpToolUiMeta`(`resourceUri` 优先级与
  校验规则同 1.2)、`readMcpToolVisibility`、`normalizeMcpAppResourceMeta`(CSP、`prefersBorder`、尺寸提示)、
  surface ID 规则 `^[A-Za-z0-9][A-Za-z0-9_.-]*$` ≤128。
- `mcp-transport.ts` 的 `mcpClientOptions`:Lab 开启时在 capabilities 加
  `extensions: {"io.modelcontextprotocol/ui": {mimeTypes: ["text/html;profile=mcp-app"]}}`;`mcp-deferred-client.ts`
  的工具列表缓存键要包含这个能力位,避免开关前后的缓存串用。
- `mcp-tool-runtime.ts`:`createMcpLocalTool` 只为 `visibility` 含 `model` 的工具建模型工具;MCP 工具检索目录
  同样过滤;所有工具的 UI 描述保存在连接状态里。工具结果输出增加 `mcpApp` 字段(serverId、resourceUri、
  surface、preferredDisplayMode);给模型的投影只用 `content`(无文本 content 时才退回有界的
  `structuredContent` 摘要),投影必须确定性,保证缓存稳定。
- 新路由 `kun/src/server/routes/mcp-apps.ts`:
  - `POST /v1/mcp-apps/instances`:按 `{threadId, serverId, resourceUri, toolCallId|surfaceId}` 签发实例凭证
    (绑定连接代际,重连/配置变更即失效),同时读取 `ui://` 资源;HTML ≤16 MiB,MIME 只收
    `text/html;profile=mcp-app` 或 `text/html`,超限拒绝不截断。
  - `POST /v1/mcp-apps/resources/read|list`:只读本 server;解码 ≤8 MiB;MIME 白名单。
  - `POST /v1/mcp-apps/tools/call`:目标 server 由凭证固定;工具 `visibility` 必须含 `app`;执行走
    规范 ToolHost 策略(只读/幂等注解自动,其余进审批);**不要求线程有运行中回合**,无回合时审批以受保护
    确认框呈现;结果原样返回页面;记录 `mcp_app_tool_call` 审计事件,但不写入模型历史。
- 远程工作区与移动端不宣告该能力,继续显示普通 MCP 工具卡。

### 7.2 Renderer

- 依赖:根 `package.json` 加 `@modelcontextprotocol/ext-apps@2.0.x` 与 `@modelcontextprotocol/core@2.x`(版本与
  `kun/` 对齐);只引用 `ext-apps/app-bridge`。
- `mcp-apps/mcp-app-host.ts`:每个活页面一个 `AppBridge`,传输层是 MessagePort;握手期限 15 秒;
  `hostCapabilities` 按实际实现声明(P2:`serverTools`、`serverResources`、`openLinks`、`message`、
  `updateModelContext`、`logging`,`experimental["kun/surface"]`);`hostContext` 带 theme、locale、
  displayMode、`availableDisplayModes`、容器尺寸。
- 事件:页面连接后补发 `tool-input` 与 `tool-result`(按 1.2 的上限截断并标记);模型取消时发
  `tool-cancelled`;工具失败、取消或 `isError` 只显示普通工具卡,不占页面。
- `McpAppCard.tsx`:嵌在 MCP 工具卡下方,标题栏显示 server 与工具名、"在侧栏打开"、重试。
- `updateModelContext`:转成 composer context 附件(复用扩展 composer context 的 ≤8 个、≤16 KiB 规则),
  显示为"<App 名> 上下文"芯片,可删除;发送时才进入回合。
- `sendMessage`:与 Gen UI 追问相同的手势/确认规则。

验收:用 `@modelcontextprotocol/server` + `ext-apps/server` 写一个 fixture server(工具带 UI、一个 app-only 工具、
一个资源),Electron 冒烟脚本断言:握手成功、初始结果到达、app-only 工具不出现在模型工具表、页面调用工具
走审批、`openLink` 只接受 https、卸载卡片后 5 分钟回收。

## 8. P3 App 面板与可编辑画布

### 8.1 App 面板(surface)

- MCP server 可在 `initialize` 后由 Kun 读取的配置(MCP 配置条目新增可选 `ui.surfaces`,或 server 的
  `_meta`)声明面板:`{id, title, resourceUri, availability: 'session'}`;工具 `_meta.ui.surface` 把结果路由到面板。
- 右侧面板贡献 ID 族 `mcp-app:<serverId>:<surfaceId>`,接入 `code-right-tabs-state.ts` 与
  `useWorkbenchExtensionSurfaces.ts`;面板按 workspace + thread 隔离,同一面板跨工具调用复用同一个活页面。
- `preferredDisplayMode: fullscreen` 每次实际工具调用只消费一次,不覆盖用户"收起"的选择。

### 8.2 内置画布 MCP App(`kun:canvas`)

- 形态:随应用分发的 stdio MCP server,`managedBy: 'kun:canvas'`(仿照 `builtin-mcp.ts` 的托管条目),
  Node 入口放 `src/main/canvas-mcp/`,页面用 Vite 打成单文件 HTML 作为 `ui://kun-canvas/editor.html` 资源。
- 文档:沿用 `.kun-whiteboards/<boardId>/`,`scene.excalidraw` + `revision.json`;写入串行化、带文件锁,
  保证房间白板、设计模式和 MCP 画布看到同一份文档。
- 模型工具:`canvas_create(title, elements?)`、`canvas_open(boardId|path)`、`canvas_read(boardId, elementIds?)`
  (返回元素摘要,不回传整份大 JSON)、`canvas_apply(boardId, expectedRevision, operationId, operations[])`
  (按元素 ID 增/改/删,冲突返回最新 revision)、`canvas_export(boardId, format, path, overwrite?)`。
- 仅页面工具:`canvas_commit`(用户手改的整份草稿,带版本冲突检查)、`canvas_list`、`canvas_save_image`
  (页面导出 PNG/SVG,server 校验工作区内路径)。
- 页面:复用 `src/renderer/src/whiteboard/excalidraw-apply.ts` 与持久化归一化逻辑;收到 `tool-result` 后按
  revision 应用;用户编辑去抖后 `canvas_commit`;框选后右键"引用选区到对话" → `updateModelContext`;
  撤销/重做只属于当前活页面。
- 现有 `design_apply_excalidraw` 保留,P3 完成后再评估是否让房间与设计模式改走同一 server。

验收:"画一个 API、缓存和数据库的架构图并标出请求方向" → 侧栏打开可编辑画板;拖动节点后显示已保存;
选中缓存节点引用到对话并发送"改成双节点,其余布局不变" → Agent `canvas_read` 后 `canvas_apply`,
只改相关元素;导出 PNG 到工作区,覆盖需显式确认;重启应用后文档与 revision 不丢。

## 9. P4 高级能力

| 能力 | 做法 | 注意 |
| --- | --- | --- |
| Sampling | `oncreatesamplingmessage` → `/v1/mcp-apps/sampling`,用当前线程模型,只接受文本与受限图片,`includeContext` 仅 `none` | 结果不进主对话;计入用量;可取消 |
| 页面提供工具 | 页面 `registerTool` 的工具**不直接进模型工具表**(会破坏工具目录稳定与前缀缓存);改为一个稳定代理工具 `app_tool_call{pageId, tool, arguments}`,活页面的工具清单通过 `kun_context_block` 告知 | 页面关闭即注销;调用去重、终态不可再写 |
| widgetState 扩展 | `ui/set-widget-state`,初值经 `hostContext["kun/widgetState"]` 下发,仅内存 | 不是持久存储 |
| 资源订阅 | `resources/subscribe` 透传,通知只发给对应实例 | server 也须支持 |
| downloadFile | 原生保存对话框,需手势 | 只接受嵌入资源或本 server 资源 |
| 原生权限 | 资源声明 + 受保护确认 + 系统授权 | 绑定实际 guest,失效页面的确认不能授权新页面 |
| 扩展分发 | Kun 扩展 manifest 声明自带 MCP App | 复用扩展权限审核 |

## 10. 设置与开关

- `src/shared/app-settings-kun-lab-defaults.ts` 增加 `genUi: {enabled:false}`、`mcpApps: {enabled:false}`;
  同步修改 `app-settings-types-kun-runtime.ts`、`app-settings-kun-merge.ts` 与 `.strict()` patch schema
  (漏掉会导致设置同步循环)。
- 设置 → 实验室新增两张卡片,复用 `settings-section-lab-conversation-visualization.tsx` 的布局;
  MCP 设置里显示每个 server 是否提供 App 页面,并提供"清除 App 页面数据"。
- 文案进全部 locale;中文复数键注意 `_other` 规则。

## 11. 安全与隐私清单

- 页面身份只认 Main 建立的实例绑定(owner webContents、分区、凭证),不信任页面自报的 ID。
- 页面不能拿到 Node、Electron、`window.kunGui`、运行时 bearer token、账号信息或任意文件路径。
- Gen UI 不能调用任何工具;MCP App 只能调用本 server 且 `visibility` 含 `app` 的工具,沿用审批。
- 所有进入模型的页面内容(`modelContent`、`updateModelContext`)都标记为不可信引用数据。
- 发消息、打开外链、下载都要求原生手势或受保护确认;状态变更永不自动开回合。
- CSP 默认拒绝网络;Gen UI 只放行固定静态域并本地映射;MCP App 只放行资源声明的域。
- 日志只记 server、资源 URI、实例 ID 和错误码,不记用户文档或页面内容。

## 12. 风险

| 风险 | 缓解 |
| --- | --- |
| 内存:每个 webview 是独立渲染进程 | 活页面上限 32、离屏回收、Gen UI 用内存分区;接入现有空闲内存基线测量 |
| 前缀缓存:新工具、动态目录、页面工具 | 工具只在 Lab 开启时广告;目录与状态走 `kun_context_block`;页面工具走稳定代理工具 |
| 包体:第二份 Excalidraw 与 vendor 库 | 画布页面与 renderer 共用 Excalidraw 构建产物;vendor 只放必要版本;复核 mac arm64 体积门禁 |
| Electron webview 移动会重载 | 浮层定位、永不 reparent |
| `body zoom: 0.82` 坐标漂移 | 统一用 `getBoundingClientRect()` 比例换算 |
| 模型滥用 Gen UI | Skill 写清楚何时不用;GUI 回合才广告;默认关闭 |
| 第三方页面兼容 | 只声明真实实现的能力;页面按 `getHostCapabilities()` 启用功能 |
| 700 行文件门禁 | 按 domain/app/adapters/components 拆模块,先写合约再接线 |

## 13. 交付顺序与改动清单

| 阶段 | 规模 | 主要改动 | 退出标准 |
| --- | --- | --- | --- |
| P0 沙箱宿主 | M | `src/main/app-sandbox/*`、`privileged-schemes.ts`、`extension-webview-security.ts`、`src/preload/app-sandbox-shell.ts`、`src/shared/app-sandbox-contract.ts`、`src/renderer/src/app-surfaces/{app-page-manager,app-page-plane}` | fixture 页面往返;guest 拒绝路径单测 |
| P1 Gen UI | M | `kun/src/contracts/gen-ui.ts`、`gen-ui-tool-provider.ts`、`kun/src/gen-ui/*`、线程状态路由、context block;renderer 投影与 `GenUiCard`;`resources/bundled-skills/gen-ui`;Lab 开关 | 第 6 节验收 |
| P1.5 | S | Tweak、导出、内置组件 | 设计稿可调参数并显式提交 |
| P2 MCP Apps 内联 | L | `kun/src/contracts/mcp-apps.ts`、`mcp-transport.ts`、`mcp-tool-runtime.ts`、`mcp-deferred-client.ts`、`routes/mcp-apps.ts`;renderer `mcp-apps/*`、composer context;ext-apps 依赖 | 第 7 节冒烟 |
| P3 面板 + 画布 | L | 右侧面板贡献 ID、`src/main/canvas-mcp/*`、画布页面构建 | 第 8 节验收 |
| P4 高级 | M | sampling、代理页面工具、订阅、下载、权限 | 逐项冒烟 |

每阶段的检查:`npm run typecheck`、相关 `vitest`、`npm run build:kun`(改动 `kun/` 时)、`npm run lint`、
`npm run check:file-lines`;P0 起新增 Electron 冒烟脚本 `scripts/smoke-app-surfaces.mjs`,并在 `npm run dev`
真实窗口里验证(webview、zoom、主题切换只在真实应用中可复现)。

## 14. 待确认

1. Gen UI 用 `render_widget` 工具(推荐)还是参考实现的"写文件 + 回复内指令"。工具方案与 Kun 的图表链路一致,
   指令方案让历史里的 HTML 更少但需要新的完成态解析与降级。
2. 画布文档是否与现有 `.kun-whiteboards/` 合并(推荐合并),还是单独存储、以后再迁移。
3. Gen UI 第三方库是否完全离线(推荐),还是先放行 CDN 白名单、之后再随包。
4. P2 是否先只支持 inline,把侧栏面板与画布合并到 P3 一起交付(推荐)。

## 15. 实现状态(2026-10-19)

已交付 P0-P3,两个 Lab 开关(`lab.genUi.enabled`、`lab.mcpApps.enabled`)默认关闭。第 14 节四项均按推荐
选择,只有画布存储例外(见下)。

### 15.1 代码位置

| 范围 | 文件 |
| --- | --- |
| 合约 | `kun/src/contracts/gen-ui.ts`、`kun/src/contracts/mcp-apps.ts`、`src/shared/app-sandbox.ts` |
| Runtime | `kun/src/gen-ui/gen-ui-store.ts`、`adapters/tool/gen-ui-tool-provider.ts`、`adapters/tool/mcp-apps-access.ts`、`server/routes/register-gen-ui-routes.ts`、`server/routes/register-mcp-apps-routes.ts`;MCP 握手、`_meta.ui` 归一化与 visibility 过滤在 `mcp-transport.ts`、`mcp-tool-runtime.ts`、`mcp-tool-search.ts` |
| Main 沙箱 | `src/main/app-sandbox/*`(registry、protocol、CSP、guards、vendor、host、service)、`extension-webview-security.ts`、`privileged-schemes.ts` |
| Preload | `src/preload/app-sandbox-shell.ts`(shell 页转发)、`src/preload/app-sandbox-api.ts`(`window.kunGui` 上的窄接口) |
| Renderer | `src/renderer/src/app-surfaces/*`(`AppSandboxFrame`、`GenUiCard`/`GenUiSurface`、`McpAppCard`/`McpAppSurface`、App 面板、composer context) |
| 画布 | `src/main/canvas-mcp/*`(stdio server 与 board store)、`src/canvas-app/*`(Excalidraw 页面,`vite.canvas-app.config.ts`、`scripts/build-canvas-app.mjs`) |
| Skill / 设置 | `resources/bundled-skills/gen-ui/`、`settings-section-lab-app-surfaces.tsx`、Lab 默认值与 merge |
| 冒烟 | `scripts/smoke-development-app-surfaces.cjs`(先 `npm run build:kun`、`electron-vite build`、`node scripts/build-canvas-app.mjs`) |

### 15.2 与计划的差异

- **页面挂载**:没有做窗口级 `AppPageManager` 与浮层 `AppPagePlane`。Gen UI webview 直接放在会话卡片里,MCP App 与
  展开的 Gen UI 放在右侧面板的 **App** 标签页(停靠,不是浮层,浮层会盖住输入区发送按钮)。Main 侧实例上限 48,
  超限先回收未挂载的实例。卡片卸载即释放 webview,重新出现时重新登记,已保存状态由 runtime 恢复。
- **时间线重挂载**:短线程(轮数不超过一页)发送新消息时,`deriveTimelineRenderedTurnCount` 曾在一帧内把最早的
  一轮隐藏,导致该轮(和其中的 webview)卸载重建。已修复为短线程始终渲染全部轮次,冒烟断言卡片实例跨发送不变。
- **页面消息传输**:shell preload 经 Main IPC 转发 `postMessage`,没有用 MessagePort;nonce 通过 `additionalArguments`
  传入,Main 按 owner webContents 和实例校验。
- **Gen UI 状态进上下文**:没有用 `kun_context_block`。`setWidgetState` 存到 runtime 后,`modelContent` 作为输入区里
  可见可删的上下文芯片随下一条消息发送(与 `updateModelContext` 同一路径),不进稳定前缀。
- **`render_widget` 的 `path` 模式**:读取工作区内的 `.html` 文件(受工作区边界限制),没有单独的 Gen UI 输出目录。
- **页面工具调用**:模型发起的 MCP 工具照常走 Kun 审批卡片。页面经 `/v1/mcp-apps/tool` 发起的调用只允许
  `visibility` 含 `app` 的工具,不开审批卡片;改为每个线程 + server 首次调用时弹一次确认(内置画布 server 免确认),
  不要求线程有运行中回合。
- **画布存储**:文档存在 `<dataDir>/canvas-boards/<boardId>.json`(revision、`expectedRevision`、`operationId` 幂等),
  没有与 `.kun-whiteboards/` 合并;房间白板与设计模式仍用原有路径。`canvas_export` 只写 `.excalidraw`,默认不覆盖。
- **原生手势**:guest 是跨进程 iframe,iframe 内的真实点击不会作为工作台 `input-event` 到达,所以追问、外链、下载
  目前总是走受保护确认。这是偏安全的降级,后续可在 shell preload 或 guest 层面补手势来源。
- **第三方库**:D3、ECharts、Lucide 固定版本随包离线,固定 CDN URL 在 Gen UI 分区内映射到本地文件,缺失即失败。

### 15.3 打包验证(2026-10-19,mac arm64)

- `npm run dist:mac:arm64` 通过体积门禁:app 713.7 / 750 MiB,zip 285.5 / 295,dmg 268.4 / 280。本功能约占 9.5 MiB
  未压缩(画布页面 7.8,Gen UI 离线库 1.7);`@modelcontextprotocol/{ext-apps,core,client}` 只被 Vite 打进 renderer
  与画布页面,放在 devDependencies,不进 `app.asar`。
- 解压后的 Kun.app 跑同一套冒烟:`node scripts/smoke-development-app-surfaces.cjs --app-executable
  <Kun.app>/Contents/MacOS/Kun --evidence <dir>`(隔离 HOME/appData、空闲端口,不影响已安装的 Kun)。8 项全部通过,
  包括从 `app.asar` 启动 `kun_canvas` server、从 `Resources/gen-ui-vendor` 离线加载固定 CDN 地址的 d3、画布字体
  从 `out/renderer/excalidraw/fonts` 加载。

### 15.4 未做

P1.5(Tweak、导出、内置组件)、P4(sampling、页面工具代理、资源订阅、`downloadFile`、原生权限、扩展分发)、
MCP 设置里的"清除 App 页面数据"、远程/移动端渲染。
