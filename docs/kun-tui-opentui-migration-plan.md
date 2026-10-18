# Kun TUI 迁移到 opentui 的修改计划

状态:已实现(2026-10-18,分支 `codex/kun-tui-opentui` 合入 develop)。下文保留原计划,
实现与计划的差异见"实现记录"。

## 实现记录

- 渲染层:`@opentui/core` / `@opentui/solid` 0.6.6 + `solid-js` 1.9.12,JSX 只在
  `kun/src/tui/app/**` 中,由 `vite.tui.config.ts` 编译为 `dist/tui/app/main.js`;
  pi-tui 依赖及其全部壳层/对话框文件已删除。
- UI 无关层:`session/*`(ChatSession,键位、手势、历史、补全、页面栈、scrollback 计划)、
  `pages/*`(各页面模型,输出 `PageView`)、`transcript-model.ts`(带 `settled` 的条目)、
  `scrollback-plan.ts`、`markdown-blocks.ts`;JSX 只负责渲染,单测不依赖原生库。
- 屏幕模型:`split-footer` + `capture-stdout`,已完成条目经 `ScrollbackSurface` 逐条写入
  原生 scrollback;流式 Markdown 按段落/列表/表格/代码块提交,只有增长中的尾部留在实时
  区域。全屏页面使用 Alternate Screen,返回时恢复内联偏移。宽度变化后(防抖 200ms)
  清屏并清除已保存行,再按新宽度重放对话(与参考实现一致)。
- 新增 `/transcript`(`Ctrl+O`)完整 transcript 页;`/details` 改为"对新输出展开工具详情"。
- Node 26:没有修改各平台 launcher,也没有把 Node 26 打进安装包。`kun tui` 在当前解释器
  不支持 `node:ffi` 时交接给 Node 26 子进程(`tui-node.ts`):依次查找 `KUN_TUI_NODE`、
  `<resources>/tui-node`、仓库 `.cache/tui-node`、`~/.kun/runtime/tui-node`、`PATH`,
  都没有时下载官方 26.12.0 并按 `SHASUMS256.txt` 校验(`KUN_TUI_NODE_DOWNLOAD=0` 关闭)。
  原因:macOS 安装包已接近 `check-package-size` 的 DMG 280 MiB 预算,随包 Node 约增加
  40+ MiB。Runtime/Manager 子进程通过 `KUN_PACKAGED_RUNTIME_EXECUTABLE` /
  `KUN_HOST_NODE_EXECUTABLE` 继续使用原解释器。
- 打包校验:`after-pack.cjs` 断言 `dist/tui/app/main.js`、`@opentui/core`、`@opentui/solid`、
  `solid-js` 与目标平台的 `@opentui/core-<platform>-<arch>`;`ensure-kun-install.cjs` 同步。
- 测试:新增 transcript-model、scrollback-plan、markdown-blocks、text-field、autocomplete、
  pages、graph-page、ChatSession 单测;`pty-smoke.test.ts` 改为在 xterm 模拟屏上断言,
  经交接路径在 Node 26 下运行(找不到 Node 26 时跳过)。未单独增加 Node 26 的 vitest
  project,组件渲染由 PTY 冒烟覆盖。

## 0. 结论摘要

1. opencode2 的 TUI(`packages/tui`)建立在 `@opentui/core` 0.5.17 + `@opentui/solid`
   + `@opentui/keymap` + `solid-js` 1.9.12 之上;原生渲染核心是 Zig 写的 `libopentui`,
   通过 FFI 调用。主运行时是 Bun,Node 路线是副通道。
2. 迁移本身可行,Kun 的 TUI 已经把 UI 无关层(client/SSE/state/controller/commands)
   和 pi-tui 渲染层分开,前者可以原样保留,只重写渲染层(约 30 个文件、1.1 万行)。
3. 有一个硬前置必须先解决:**opentui 在 Node 下需要 Node >= 26.4 并带
   `--experimental-ffi`**。Kun 安装版的 TUI 目前通过 Electron 43 内置的 Node 24.18
   运行(macOS/Linux),Electron 42-46 nightly 全部仍是 Node 24.x,不能等 Electron。
   推荐做法是让 TUI 进程改跑随包分发的 Node 26,Runtime 子进程继续用 Electron Node
   (Windows 启动器今天已经是"TUI 用系统 Node、Runtime 用 Electron"的结构)。
4. Kun 的"内联、不切 Alternate Screen、保留原生 scrollback"原则可以保留:opentui 提供
   `screenMode: "split-footer"` + `ScrollbackSurface`,opencode 的 `mini` 模式正是这样做的。
5. 构建链要加一步:Solid JSX 必须由 `babel-preset-solid`(`generate: "universal"`,
   `moduleName: "@opentui/solid"`)编译,`tsc` 做不到,需要给 `kun/src/tui` 增加 vite 构建。
6. 总工作量约 8-11 人周,分 7 个阶段,每个阶段有独立验收标准。

## 1. opencode2 TUI 分析

### 1.1 技术栈与运行时

| 项目 | 事实 | 来源 |
| --- | --- | --- |
| 渲染库 | `@opentui/core` 0.5.17(Zig 原生核心 + FFI),`@opentui/solid` 0.5.17,`@opentui/keymap` 0.5.17 | `package.json` catalog |
| UI 框架 | SolidJS 1.9.12(peer 精确版本),JSX 编译目标 `@opentui/solid` universal runtime | `packages/tui/tsconfig.json` `jsxImportSource` |
| 主运行时 | Bun >= 1.3;`bunfig.toml` preload `@opentui/solid/preload` 做运行时 JSX 转换 | `packages/tui/bunfig.toml` |
| Node 运行时 | Node 26.4.0 SEA,`--experimental-ffi --use-system-ca`,vite + `vite-plugin-solid` 打包,原生资源抽到 `OTUI_ASSET_ROOT` | `packages/cli/script/build-node.ts`,`vite.node.config.ts`,`src/node/target.ts` |
| 原生依赖 | `@opentui/core-<platform>-<arch>` optionalDependencies 提供 `libopentui.{dylib,so,dll}`;`web-tree-sitter` peer 做语法高亮 | npm 元数据 |
| 测试 | `bun:test` + `@opentui/core/testing`(`testRender`、`captureCharFrame`、`mockMouse`、`ManualClock`) | `packages/tui/test/**` |

### 1.2 入口与组装

- CLI 入口 `packages/cli/src/commands/handlers/default.ts` 解析服务连接后调用
  `run()`(`packages/tui/src/app.tsx`)。
- `run()`:`createCliRenderer({ externalOutputMode: "passthrough", targetFps: 60,
  exitOnCtrlC: false, useKittyKeyboard: {}, useMouse, autoFocus: false })` →
  `renderer.waitForThemeMode()` → `render(<Providers><App/></Providers>, renderer)`,
  Effect scope 负责 renderer/clipboard/finalizer 的释放,`SIGHUP` 时 destroy renderer。
- Provider 树约 30 层:Log/Exit/Epilogue/App/Paths/Storage/Lifecycle/TerminalEnvironment/
  Startup/Clipboard/Args/Config/Keymap/Toast/Route/Client/Permission/Data/Location/
  SessionTabs/SessionTerminals/Theme/Local/PromptStash/Dialog/Frecency/PromptHistory/
  PromptRef/EditorContext/Attention/UpdateNotification/Panel/Plugin。
- `<App/>` 根布局是一个全屏 `<box>`,内部按 `route.data.type` 切换 `Home`/`SessionFrame`/
  `PluginRoute`,叠加 `DevToolsBar`、`StartupLoading`、`Reconnecting`、`MigrationOverlay`、
  `Toast`。

### 1.3 值得照搬的架构模式

| 模式 | 位置 | 说明 |
| --- | --- | --- |
| 路由即 store | `context/route.tsx` | `createStore<Route>` + `reconcile`,`home`/`session`/`plugin` 三种路由 |
| 事件流到 store | `context/client.tsx`,`context/data.tsx` | SSE 事件进 `createGlobalEmitter`,`createData` 把快照和事件投影成 solid store |
| 对话框栈 | `ui/dialog.tsx` | `dialog.replace(() => <X/>)`,进入 `modal` 模式,Esc/Ctrl+C 统一关闭,关闭后恢复焦点 |
| 通用选择器 | `ui/dialog-select.tsx` | 模糊搜索、分组、footer 动作、键位绑定一体化 |
| 键位分层 | `context/keymap.tsx` | `Keymap.createLayer(() => ({ mode, enabled, commands, bindings }))`,mode 栈,leader,命令面板与 slash 共用同一命令表 |
| 主题 | `context/theme.tsx`,`theme/*` | JSON 主题 + 终端 OSC 探测 dark/light + syntax style |
| 终端能力 | `app.tsx` | 终端标题、鼠标选择复制、右键复制、链接点击、`renderer.suspend()/resume()` 做 Ctrl+Z 与外部编辑器 |
| 内联模式 | `mini/runtime.lifecycle.ts`,`mini/scrollback.*` | `screenMode: "split-footer"` + `footerHeight`,完成的内容用 `createScrollbackSurface().commitRows()` 提交到原生 scrollback,底部 footer 为 retained 区域 |
| 实验开关 | `component/dialog-experiments.tsx` | 永久基础设施,实验毕业只删 gate |

### 1.4 不适合直接照搬的部分

- `routes/session/index.tsx` 3630 行、`component/prompt/index.tsx` 2013 行,违反 Kun 的
  700 行门槛,需要按职责拆分重写。
- 插件系统、session tabs、terminal pane(依赖 opencode-pty)、Effect 运行时、
  `@opencode/client` 数据层都与 Kun 协议无关,不迁移。

## 2. Kun TUI 现状

### 2.1 结构

- 渲染库 `@earendil-works/pi-tui` 0.81.1:组件接口是 `render(width): string[]` +
  `handleInput(data: string)`,应用自己做行级差分;`ScrollbackPreservingTerminal`
  过滤 `CSI 3 J` 和鼠标上报开启序列,保证内联和原生选择。
- `kun/src/tui` 共约 2.6 万行(含约 8 千行测试)。
- UI 无关层(保留不动):`client*.ts`、`sse.ts`、`state*.ts`、`controller*.ts`、
  `commands.ts`、`keymap.ts`(配置解析)、`persistence.ts`、`user-input.ts`、
  `graph-mode.ts`、`file-mentions.ts`(解析部分)、`clipboard-image.ts`、`pasted-paths.ts`、
  `operations.ts`、`activity.ts`、`layout.ts`、`markdown-code.ts`、`options.ts`、
  `gui-catalog-startup.ts`、`legacy-model-connections.ts`。
- pi-tui 依赖层(需要重写,30 个文件):`application-{base,input,overlays,routes}.ts`、
  `chat-root.ts`、`transcript*.ts`、`subagent-*.ts`、`render-*.ts`、`visual-system.ts`、
  `pi-common.ts`、`pi-terminal.ts`、`pi-app.ts`、以及 `command-dialogs`、`session-dialogs`、
  `runtime-dialogs`、`connect-dialog*`、`model-dialog`、`graph-dialog`、`provider-quota`、
  `usage-report` 等约 25 个 `Component & Focusable` 类。
- 状态流:`TuiController.subscribe(state => ...)` 单向推送 `TuiControllerState`;
  `PiTuiApplicationBase.run()` 里统一把 state 分发给 root、overlay、popup 并
  `requestRender()`。

### 2.2 启动与安装形态

- `serve-entry.js` → `agent-cli.ts` → `runTuiCommand()`(`kun/src/tui/index.ts`),
  懒加载 `pi-app.js`;先解析连接(client-owned Runtime 或 `--url`/`--no-start`)。
- macOS launcher `resources/bin/kun`:`ELECTRON_RUN_AS_NODE=1 exec Kun.app/Contents/MacOS/Kun serve-entry.js "$@"`。
- Linux launcher:`KUN_CLI_ENTRY=1` 分支同样用 Electron 内置 Node。
- Windows `bin\kun.cmd`:`tui` 走 PATH 上的 `node`(要求 >= 22.19),并设置
  `KUN_PACKAGED_RUNTIME_EXECUTABLE` 让 Runtime 子进程仍由 Electron 启动
  (`kun/src/cli/shared-runtime.ts`、`persistent-host.ts`)。
- `MINIMUM_TUI_NODE_VERSION = '22.19.0'` 同时出现在 `kun/src/tui/index.ts` 与
  `scripts/after-pack-launchers.cjs`。
- 测试:逻辑测试为主;`pty-smoke.test.ts` 用 `node-pty` 跑真实 CLI 并断言不出现
  `\x1b[?1049h`;`provider-quota.test.ts`、`usage-report.test.ts` 直接调用 `.render()`。

## 3. 硬约束与决策点

### 3.1 运行时版本(阻塞项,必须先定)

核对结果:

- `@opentui/core` `engines`: `bun >= 1.3.0`,`node >= 26.4.0`;Node 路径通过
  `require("node:ffi")` 加载 `libopentui`,失败时退化为 "FFI not available" 后端,
  `createCliRenderer()` 无法工作。`bun-ffi-structs` 的错误信息明确写着
  "Node.js 26.1+ with node:ffi enabled (--experimental-ffi)"。
- 本机验证:`ELECTRON_RUN_AS_NODE=1 electron --experimental-ffi` 和系统 Node 25.2.1 都报
  `bad option: --experimental-ffi`。
- Electron 官方 releases.json(2026-10-16):E42 24.19、E43 24.22、E44 24.22、
  E45 beta 24.22、E46 nightly 24.22。Electron 内置 Node 26 在可预见的发布周期内不会到来。
- opentui 官方运行时支持页:Node Core 测试只覆盖 macOS arm64、Linux x64、Windows x64;
  SEA/打包测试只覆盖 Linux x64。

方案比较:

| 方案 | 做法 | 优点 | 代价 / 风险 |
| --- | --- | --- | --- |
| A. 随 GUI 分发 Node 26(推荐) | 打包时按平台下载官方 Node 26.x 到 `resources/node/`,launcher 对 `tui` 子命令改用它并加 `--experimental-ffi`;Runtime 子进程继续通过 `KUN_PACKAGED_RUNTIME_EXECUTABLE` 用 Electron | 用户零配置;版本可控;与 opencode Node 路线一致 | 每平台增加约 50 MB 未压缩体积;macOS 需要对 Node 二进制与 `libopentui.dylib` 签名公证;需要 after-pack 与 release 工作流改动 |
| B. 要求系统 Node >= 26.4 | 沿用 Windows 现有 "找 PATH 上的 node" 逻辑扩展到三平台 | 不增加包体积;开发期立即可用 | Node 26 要到 2026-10 才转 LTS,大多数用户没有;macOS/Linux 用户体验退化 |
| C. 随包分发 Bun | TUI 单独用 Bun 运行 | opentui 主路线,功能最全 | Bun 约 90 MB;Kun 代码(node-pty、better-sqlite3 等)全部按 Node 假设;两个运行时并存维护成本高 |
| D. 等 Electron 内置 Node 26 | 不动 launcher | 无额外体积 | 时间不可控(至少 2027 年) |

推荐:A 为主,B 为开发期和兜底(找不到随包 Node 时尝试系统 Node >= 26.4,否则给出清晰错误)。
Node 26 的 `--experimental-ffi` 仍是实验特性,计划中要锁定具体小版本并在 CI 做冒烟。

附带约束:TUI 进程改跑 Node 26 后,**不得** 加载为 Electron ABI 编译的原生模块
(`better-sqlite3`、`@computer-use/nut-js` 等)。需要用一个导入图检查脚本保证
`kun/dist/tui/**` 的静态/动态 import 不触达这些包(与 `check-packaged-runtime-dependencies.cjs`
同类)。Windows 现状已经证明 TUI 进程走纯 Node 可行。

### 3.2 内联(split-footer)还是全屏(alternate-screen)

- Kun 的产品原则(`docs/kun-tui.md`、`pty-smoke.test.ts`):内联、不切 alt screen、
  原生 scrollback 和拖选复制可用。
- opentui `ScreenMode = "alternate-screen" | "main-screen" | "split-footer"`;
  split-footer 模式下 `footerHeight` 可动态调整,`createScrollbackSurface()` 可把渲染好的
  行提交到 scrollback;`externalOutputMode: "capture-stdout"` 可把子进程 stdout 也进 scrollback。
- 推荐:
  - 默认 `split-footer`:已完成的 transcript 项通过 `ScrollbackSurface.commitRows` 写入
    scrollback(保留原生滚动和选择);进行中的 turn、活动行、composer、快捷栏放在 footer。
  - 独占页面(Sessions/Models/Connect/Approval 等)把 `footerHeight` 临时放大到整屏,
    或切换到 `alternate-screen` 再切回;两种方式在 Phase 0 spike 里实测后二选一。
  - 保留 `/mouse` Pointer 模式语义:`renderer.useMouse` 默认 false,Pointer 模式才开。

### 3.3 构建与类型检查

- `kun/` 现在只用 `tsc -p tsconfig.build.json` 产出 `dist/`。Solid JSX 需要 babel
  (`babel-preset-solid`,`generate: "universal"`,`moduleName: "@opentui/solid"`),
  opencode 的 Node 产物用 `vite` + `vite-plugin-solid` 完成这一步。
- 根仓库已有 `vite` 6、`@babel/core` 7.29;缺 `vite-plugin-solid`、`solid-js`、
  `@opentui/*`,需要加到 `kun/package.json`。
- 方案:新增 `kun/vite.tui.config.ts`,入口 `kun/src/tui/app/main.tsx`,`ssr` 构建、
  `target: "node26"`、依赖全部 external(`@opentui/*`、`solid-js`、`kun` 内部模块以相对
  路径引用 `dist/`),产物 `kun/dist/tui/app.mjs`。`tsc` 对 `.tsx` 只做类型检查
  (`jsx: "preserve"`、`jsxImportSource: "@opentui/solid"`),`tsconfig.build.json` 排除
  `src/tui/app/**/*.tsx` 的 emit。
- `kun/src/tui/index.ts` 必须保持对 opentui 的懒加载(`await import('./app/main.js')`),
  这样 `kun serve`、`kun run`、GUI 侧的 Runtime 在 Node 24 下不受影响。
- 700 行门槛:所有新文件按职责拆分,不复制 opencode 的巨型文件。

### 3.4 测试基础设施

- opentui 组件测试依赖 `@opentui/core/testing`,同样需要 Node 26 + `--experimental-ffi`。
- 方案:vitest 增加一个 `tui-app` project(`include: src/tui/app/**/*.test.tsx`,
  `poolOptions.forks.execArgv: ['--experimental-ffi']`,vite 配置复用 `vite-plugin-solid`),
  并在 Node < 26.4 时整体 `skip` 并打印原因;CI 新增 Node 26 作业专门跑这组测试和
  PTY smoke。
- 现有逻辑测试(controller/state/client/sse/keymap 等)不受影响。

### 3.5 Windows

- `kun.cmd` 已经使用系统 Node;改为优先 `resources\node\node.exe`(随包),否则要求
  系统 Node >= 26.4。错误信息里的 `winget install --id OpenJS.NodeJS.22` 要改成 26。
- opentui Windows x64 有官方 Node 测试通道,arm64 只有 Bun 1.4 通道,需在 Phase 0 实测。

## 4. 目标架构

### 4.1 目录规划(`kun/src/tui/`)

```
tui/
  index.ts                 入口(保留),懒加载 app/main.js
  options.ts, client*.ts, sse.ts, state*.ts, controller*.ts, commands.ts,
  keymap.ts, persistence.ts, user-input.ts, graph-mode.ts, operations.ts,
  activity.ts, layout.ts, markdown-code.ts, clipboard-image.ts, ...   (保留)
  app/
    main.tsx               createCliRenderer + render(<Providers/>) + 生命周期/信号
    renderer-options.ts    screenMode/footerHeight/kitty/mouse 配置与 Node 版本守卫
    context/
      controller.tsx       TuiController -> solid store 桥(reconcile),useController()
      keymap.tsx           TuiKeymap 配置 -> @opentui/keymap 绑定与 leader
      theme.tsx            kun/ocean/mono 三套主题 -> RGBA token;dark/light 探测
      dialog.tsx           独占页面栈(替代 primaryRoutes + ExclusiveRouteHandle)
      toast.tsx            替代 controller.notify 的显示层
      route.tsx            welcome | chat | exclusive(kind)
      terminal.tsx         suspend/resume、外部编辑器、交互终端、标题、OSC52
    ui/
      page-frame.tsx       breadcrumb + 分隔 + footer 动作(对应 visual-system.pageFrame)
      select-list.tsx      通用可搜索列表(对应 selectionRow + Input)
      masked-input.tsx     凭据输入
      spinner.tsx, status-glyph.tsx, context-gauge.tsx
    routes/
      welcome.tsx          renderKunWelcome
      chat/
        index.tsx          split-footer 编排:scrollback 提交 + retained 区域
        transcript/        item-row.tsx, exploration-group.tsx, thinking.tsx,
                           tool-call.tsx, subagent-row.tsx, approval-review.tsx,
                           attachment-row.tsx, scrollback-commit.ts
        activity-row.tsx, graph-progress-row.tsx
        composer/          editor.tsx(textarea)、autocomplete.tsx、attachments.tsx、
                           metadata.tsx、paste.ts、shortcut-footer.tsx
      exclusive/
        sessions.tsx, models.tsx, connect/(每步一个文件), commands.tsx,
        variants.tsx, agent-mode.tsx, goal.tsx, permission.tsx, timeline.tsx,
        skills.tsx, help.tsx, inspection.tsx, approval.tsx, user-input.tsx,
        usage.tsx, quota.tsx, subagents.tsx, subagent-popup.tsx, graph-board.tsx
```

### 4.2 概念映射表

| pi-tui 实现(现状) | opentui/solid 实现(目标) |
| --- | --- |
| `Component.render(width): string[]` | JSX `<box>/<text>/<markdown>`,yoga 布局,`useTerminalDimensions()` |
| `handleInput(data: string)` + `matchesKey` | `Keymap.createLayer` 命令绑定;文本输入由 `<textarea>/<input>` 自带 |
| `TUI.setFocus()` / `Focusable` | `renderable.focus()`,`autoFocus: false` 下显式管理 |
| `ChatRoot.primaryRoutes` + `ExclusiveRouteHandle` | `context/dialog.tsx` 栈 + `route` store |
| `tui.showOverlay()`(subagent/graph 弹窗) | `position="absolute"` + `zIndex` 的 `<box>` 或 `Portal` |
| `Editor`(多行、历史、autocomplete、bracketed paste) | `<textarea onSubmit>` + 自写 autocomplete 弹层 + `PasteEvent` |
| `Input` | `<input>`;遮罩输入自写(复用 `masked-text` 思路) |
| `Markdown` + `markdownTheme` + `highlightTerminalCode` | `<markdown syntaxStyle>` + `<code>`(tree-sitter);mono 主题下关闭高亮 |
| `truncateToWidth` / `visibleWidth` / `wrapText` | `<text wrapMode="word"|"none" truncate>`;`layout.ts` 的 `cellWidth` 仅用于纯文本场景 |
| `visual.*` ANSI 着色 | theme token(RGBA)+ `TextAttributes` |
| `animationTimer` 80ms 全量重绘 | `<spinner frames interval>`,局部 signal |
| `parseSgrMouseEvent` + 行号反推 | `onMouseUp/onMouseDown` 挂在具体 `<box>` 上 |
| `ScrollbackPreservingTerminal` | `screenMode: "split-footer"`,无需过滤序列 |
| `InlineStreamTerminal`(测试) | `@opentui/core/testing` `testRender` |
| `controller.notify()` | toast(短通知)+ activity 行右侧(状态) |
| `terminal.setTitle('Kun')` | `renderer.setTerminalTitle()` |
| `tui.stop()` 后 spawn shell/editor,再 `tui.start()` | `renderer.suspend()` / `resume()` |
| `ProcessTerminal` 的 Kitty 识别 | `useKittyKeyboard` 配置;`events: true` 时才有 release 事件 |

### 4.3 状态桥接

`TuiController` 不改接口。新增 `context/controller.tsx`:

- `const [state, setState] = createStore(controller.state)`;
  `controller.subscribe(next => setState(reconcile(next, { key: 'id' })))`。
- 大对象(`projection.items`、`childRuns`)按稳定 id reconcile,避免整棵树重渲染。
- 组件通过 `useController()` 直接调用 controller 方法(submit/interrupt/openThread 等)。
- `quitRequested` 变为 true 时由 `main.tsx` 触发 `destroyRenderer()` 并结束 `run()`。

### 4.4 键位桥接

- `keymap.ts` 继续解析 `~/.kun/tui.json`(格式本就兼容 OpenCode)。
- 新增适配:`TuiKeymap` 的 `action -> bindings[]` 转成 `@opentui/keymap` 的
  `config.keybinds.get(id)` 形状;leader 用 `registerTimedLeader`;
  `preventDefault/fallthrough` 语义映射到 binding 属性。
- 命令表与 slash 命令表合并:`commands.ts` 的 `TUI_COMMAND_DEFINITIONS` 同时产出
  命令面板条目、slash 自动补全和键位命令,避免三份清单。

## 5. 分阶段计划

### Phase 0 - 可行性 spike(3-5 天,产出 go/no-go)

目标:在不改动产品代码的前提下验证所有阻塞假设。

1. 安装 Node 26.4.x,在一个临时目录(不进仓库)用 `@opentui/core` + `@opentui/solid`
   写最小 demo:split-footer、`createScrollbackSurface().commitRows`、`<textarea>`、
   `<markdown>`、`renderer.suspend()/resume()`、`setTerminalTitle`、鼠标开关。
2. 用 vite + `vite-plugin-solid`(universal)构建该 demo 为 Node 产物并运行,确认不需要
   `@opentui/solid/preload` 运行时转换。
3. 在 macOS arm64、Linux x64、Windows x64(ConPTY)上各跑一次;Windows arm64 记录结果。
4. 验证 `@opentui/core/testing` 在 vitest + `--experimental-ffi` 下可用。
5. 验证 "TUI 进程为 Node 26,子进程 `kun serve` 为 Electron":用现有
   `KUN_PACKAGED_RUNTIME_EXECUTABLE` 路径启动本地包并跑一轮对话。
6. 评估 `web-tree-sitter` 在 Node 下的 parser worker 与 wasm 资源路径。

验收:以上 6 项全部通过;否则回到 3.1 重新选方案(例如暂缓迁移)。

### Phase 1 - 工具链与运行时(4-6 天)

修改点:

- `kun/package.json`:新增 `@opentui/core`、`@opentui/solid`、`@opentui/keymap`、
  `solid-js`(精确版本,与 opentui 对齐);devDependencies 新增 `vite-plugin-solid`;
  `build` 脚本在 `tsc` 后执行 `vite build -c vite.tui.config.ts`;`engines` 保持 22.19
  (Runtime 侧不变),TUI 版本要求单独定义。
- `kun/tsconfig.json`:增加 `jsx: "preserve"`、`jsxImportSource: "@opentui/solid"`;
  `tsconfig.build.json` 排除 `src/tui/app/**/*.tsx`。
- `kun/vite.tui.config.ts`:见 3.3。
- `kun/vitest.config.ts`:增加 `tui-app` project(3.4)。
- `kun/src/tui/index.ts`:`MINIMUM_TUI_NODE_VERSION` 改为 `26.4.0`,并检查
  `process.execArgv`/`NODE_OPTIONS` 是否含 `--experimental-ffi`,缺失时给出可执行提示。
- `scripts/after-pack-launchers.cjs`:macOS/Linux/Windows 三个 launcher 对 `tui`
  子命令优先使用 `resources/node/<bin>`(随包 Node 26),否则尝试系统 Node >= 26.4,
  其他子命令保持 Electron 路径;Node 进程设置 `KUN_PACKAGED_RUNTIME_EXECUTABLE`。
- 新增 `scripts/prepare-bundled-node.cjs`(参考 opencode `build-node.ts` 的校验和下载逻辑)
  与 `electron-builder.config.cjs` 的 `extraResources`;macOS 签名列表加入 Node 二进制与
  `libopentui.dylib`;`verify-packaged-macos-native-architecture.cjs` 覆盖新二进制。
- `scripts/ensure-kun-install.cjs` `REQUIRED_PATHS`:去掉 pi-tui(Phase 6 才删依赖,
  这里先加 opentui 路径);`check-packaged-runtime-dependencies.cjs` 允许
  `@opentui/core-*` 可选包按平台缺失。
- 新增 `scripts/check-tui-import-graph.mjs`:保证 `kun/dist/tui/**` 不引用 Electron ABI 原生模块。
- 根 `package.json`:`dev:tui` 改为 `node --experimental-ffi ./kun/dist/cli/serve-entry.js tui`,
  并在 `scripts/` 里加 Node 版本守卫;`.github/workflows` 新增 Node 26 作业。

验收:`npm run build:kun` 产出 `kun/dist/tui/app.mjs`;`npm run dev:tui` 在 Node 26 下
启动一个只显示 "hello" 的 opentui 画面并能 Ctrl+C 退出;`kun serve` 在 Node 24 下行为不变;
打包后的 macOS/Windows/Linux 启动器可以进入同一画面。

### Phase 2 - 应用骨架与最小对话闭环(5-8 天)

新增 `app/main.tsx`、`context/*`、`ui/page-frame.tsx`、`routes/welcome.tsx`、
`routes/chat/index.tsx`、`composer/editor.tsx`、`activity-row.tsx`、`shortcut-footer.tsx`。

功能范围:欢迎页(文字 `KUN`、用途说明、Workspace/Model/Mode/Version、三个起点)、
composer(单输入框、provider/model · effort · mode 元数据、Enter 发送、Ctrl+J 换行、
Ctrl+C/Ctrl+D 双击退出、Esc 中止)、活动行(Sending/Waiting/Thinking/Responding/
工具/子代理/重试/重连阶段与耗时、上下文 gauge)、流式 assistant 文本以最简形式进入
transcript、toast 通知、终端标题、SIGTERM/SIGHUP 清理。

验收:`pty-smoke.test.ts` 的前半段(欢迎页、Ctrl+T、Ctrl+X N 建线程、输入、resize、
Ctrl+C 中止、退出后终端恢复)在新实现上通过;不出现 `\x1b[?1049h`。

### Phase 3 - Transcript 完整呈现(6-10 天)

迁移 `transcript.ts`、`transcript-items.ts`、`transcript-exploration.ts`、
`subagent-components.ts`、`render-utils.ts` 的全部视觉规则:

- 每个 assistant turn 归入一个 `Kun` 分组;Thinking 默认折叠,`/thinking` 全局展开,
  Pointer 模式下单击标题切换单条。
- 工具调用一行动作/对象/耗时,`Ctrl+O` 展开 `├ input` / `└ output`;
  只读探索调用聚合为 `Exploring/Explored`(默认 12 条 + 剩余数)。
- Subagent 紧凑摘要;审批 review 行;附件元数据行(`Image/File`、大小、尺寸)。
- scrollback 提交策略:item 到达 `completed` 且其所属 turn 不再变化时提交;
  进行中的 turn 保留在 footer 区域;`/clear` 与 `Ctrl+L` 的语义在 split-footer 下重新定义
  (`resetSplitFooterForReplay`)。
- 代码块用 `<code>` + tree-sitter,mono 主题退化为纯文本。

验收:`state.test.ts` 不变;新增 transcript 快照测试(`captureCharFrame`)覆盖分组、
折叠、展开、exploration 聚合、附件行;长会话(1 万 item)内存与 CPU 基线记录。

### Phase 4 - 独占页面与对话框(10-15 天)

按使用频率顺序迁移,每个页面一个文件、复用 `page-frame` 与 `select-list`:

1. Commands 面板(`Ctrl+P`)、Sessions(搜索/固定/归档/删除确认)、Help。
2. Models(provider/account 分组)、Variants、Agent/Plan/Graph/Goal 模式。
3. Connect 向导(目录、Custom provider 多步、API key/Token Plan 遮罩输入、ChatGPT device
   code、Grok PKCE 回调粘贴、Claude SDK 安装检测、官方 CLI 授权时 `suspend()`)。
4. Approval、UserInput(单选/多选/文本)、Permission、Inspection(Status/Context/
   Queue/MCP)、Timeline/Jump、Skills。
5. Usage、Provider quota、Subagents 列表、Subagent 实时弹窗、Graph board 弹窗。

验收:每个页面有一个 `testRender` 测试覆盖打开、键盘导航、Esc 返回和焦点恢复;
`docs/kun-tui.md` 中列出的所有 slash 命令和键位在命令面板里可见且可执行。

### Phase 5 - 高级终端交互(4-6 天)

- Pointer 模式(`Ctrl+X P`、`/mouse`):`renderer.useMouse` 开关;Thinking/Subagent/
  Graph 进度行的点击用 `onMouseUp`。
- 粘贴:`PasteEvent` 处理路径粘贴(`pasted-paths.ts`)、空 bracketed-paste 触发剪贴板图片;
  `Cmd+V`/`Ctrl+V`/`Alt+V`/`Ctrl+X V` 与 `/paste` 走同一路径。
- 外部编辑器(`Ctrl+G`、`/editor`)、交互终端(`/terminal`)、`Ctrl+Z` 挂起:
  统一用 `renderer.suspend()`/`resume()`。
- OSC52 复制、`/export`、`/share` 保持现有 `operations.ts`。
- 重连遮罩、更新提示、键位配置错误提示。

验收:`pty-smoke.test.ts` 全量通过;手工清单覆盖 macOS Terminal/iTerm2、VS Code 终端、
Windows Terminal、Linux GNOME Terminal。

### Phase 6 - 清理、文档与发布门禁(5-8 天)

- 删除 pi-tui 依赖层文件与 `@earendil-works/pi-tui` 依赖;`pi-terminal.test.ts` 等
  随之删除;`ensure-kun-install.cjs` 更新。
- `docs/kun-tui.md` / `kun-tui.en.md`:更新"基于 opentui"、Node 26 要求、split-footer
  说明、键位表;`docs/kun-architecture.md` 的 TUI 分发段落补充随包 Node;根 `AGENTS.md`
  的 "Kun Runtime Notes" 增加 TUI 构建与运行时约束。
- release 工作流:Node 26 下载缓存、校验和、签名公证、`smoke-packaged-cli.cjs` 增加
  `kun tui --help` 与 PTY 冒烟。
- `npm run check:file-lines`、`typecheck`、`test`、`build`、`dist:mac:arm64` 全绿;
  develop 已知基线红测不计入。

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `--experimental-ffi` 仍是实验特性,Node 小版本可能改 API | TUI 启动失败 | 锁定 Node 小版本并随包分发;CI 冒烟;保留 pi-tui 分支一段时间可回退 |
| opentui 0.5.x API 变动快 | 升级成本 | 精确锁版本;参考 opencode `upgrade-opentui` 脚本做受控升级 |
| macOS 签名/公证新增 Node 二进制与 dylib | 发布阻塞 | Phase 1 就在 `dist:mac:signed` 上验证 |
| 包体积增加约 50 MB/平台 | 下载与更新体验 | 评估只对 TUI 用户按需下载 Node(首次 `kun` 时下载并校验)作为备选 |
| Windows arm64 无 Node 通道 | 该平台 TUI 不可用 | 明确不支持并给出提示;等待 opentui 更新 |
| split-footer 的 scrollback 提交语义与 Kun 的折叠/展开交互冲突(已提交的行不能再改) | Thinking/工具展开只能作用于未提交内容 | 只提交已完成且不再可交互的 turn;展开能力保留在当前 turn,历史 turn 用 `/timeline` 查看 |
| tree-sitter worker 在 Node 下的资源路径 | 代码高亮失效 | Phase 0 验证;失败时退化为 highlight.js 文本着色 |
| 60 fps 渲染循环的空闲 CPU | 笔记本续航 | `targetFps: 30`,空闲时无动画不重绘 |
| 700 行门槛 vs 复杂页面 | 代码组织 | 按 4.1 目录预先拆分,review 时执行 `check:file-lines` |

## 7. 工作量估算

| 阶段 | 估算 |
| --- | --- |
| Phase 0 spike | 3-5 天 |
| Phase 1 工具链与运行时 | 4-6 天 |
| Phase 2 骨架与最小闭环 | 5-8 天 |
| Phase 3 Transcript | 6-10 天 |
| Phase 4 页面与对话框 | 10-15 天 |
| Phase 5 高级交互 | 4-6 天 |
| Phase 6 清理与发布 | 5-8 天 |
| 合计 | 37-58 人日(约 8-11 人周) |

## 8. 明确不做的事

- 不引入 Effect、opencode 插件系统、session tabs、terminal pane、`mini` 的完整实现。
- 不把 Runtime(`kun serve`)或 GUI 迁到 Node 26 或 Bun。
- 不改变 TUI 与 Runtime 之间的 HTTP/SSE 协议、线程/设置/凭据数据格式。
- 不在源码中引用设计参考项目的名称。
