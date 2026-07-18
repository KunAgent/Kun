# 工作台贡献点、命令、设置与 UX

> Extension API：v1
> English: [Workbench contributions, commands, settings, and UX](./workbench.en.md)
> 相关：[Manifest 贡献点](./manifest.md#贡献点) · [Webview 与 Direct DOM](./webview-and-dom.md)

Kun 的工作台使用一个 typed `ContributionRegistry` 组合内置与扩展 UI。扩展声明“放在哪里、显示什么、调用哪个命令”，宿主负责真正渲染、排序、焦点、可访问性和生命周期。扩展 React 组件不能直接挂进 Kun React tree。

对于用户可直接进入的扩展 UI，v1 的规范入口是 `views.rightSidebar`：每个可见 View 用自己声明的 `icon` 注册到 Code 模式右侧竖向图标栏，并在主会话旁打开独立标签和隔离 Webview。Kun 不提供额外的工具菜单或“所有扩展”拼图菜单。`views.leftSidebar`、`views.auxiliaryPanel`、`views.editorTab` 和 `views.fullPage` 仍保持 v1 Schema 与命令打开兼容，但新扩展不应把它们作为默认可发现入口。

## 身份和命名空间

- 内置项：`builtin:<id>`。
- 扩展项：`extension:<publisher.name>/<local-id>`。
- 命令、View、设置和其它贡献的 local ID 必须满足 Schema，并在对应类别内唯一。
- 扩展不能声明 `builtin:`，也不能覆盖另一个扩展或内置贡献。

例如 `acme.issues` 的本地 View `backlog` 会解析为：

```text
extension:acme.issues/backlog
```

布局只持久化 fully-qualified ID 和宿主 layout metadata。版本更新删除 View 时，宿主忽略失效引用并选择合法 fallback；uninstall 会清掉该扩展的 layout 引用，不影响其它面板。

## 支持的 UI 位置

| Manifest 键 | 宿主位置 | 推荐用途 |
| --- | --- | --- |
| `views.containers` | Activity/sidebar 容器 | 将一组相关 View 归类 |
| `views.leftSidebar` | 左侧栏（兼容） | 已有 v1 扩展的导航、项目树 |
| `views.rightSidebar` | 右侧栏（规范入口） | 扩展工具、状态、编辑器和工作流面板 |
| `views.auxiliaryPanel` | 辅助面板（兼容） | 已有 v1 扩展的日志、任务、长表格 |
| `views.editorTab` | 编辑区 Tab（兼容） | 已有 v1 扩展的文档、可视化 |
| `views.fullPage` | 工作台全页（兼容） | 已有 v1 扩展的复杂仪表盘；不用于 protected flows |
| `actions.topBar` | 顶部操作区 | 高频全局/当前工作区命令 |
| `actions.composer` | 对话 Composer | 附加上下文、启动扩展工作流 |
| `actions.message` | 消息操作 | 对已授权消息执行操作 |
| `message.resultPreviews` | 工具/结果预览 | 对扩展结果提供安全复杂渲染 |
| `settings` | 设置页面 | 结构化、非秘密配置 |
| `contextMenus` | 支持的宿主上下文菜单 | 针对文件、消息或工作区上下文的命令 |
| `notifications` | 宿主通知中心 | 有界、可访问、可归因通知 |

未知位置会验证失败，不会作为“任意组件插槽”处理。扩展不得指定屏幕绝对坐标、覆盖 consent/credential/approval surface，或强迫自己排在受保护内置控制之前。

## View 声明

```json
{
  "views.rightSidebar": [
    {
      "id": "issues",
      "title": "Issues",
      "icon": "assets/issues.svg",
      "entry": "dist/webview/index.html",
      "when": "workspaceOpen",
      "order": 100
    }
  ]
}
```

- `entry` 必须是完整性清单中的本地资源，并位于声明的 resource root。
- label/title/description 是不可信纯文本，不能包含可执行 HTML。
- icon 必须是包内允许类型；应在浅色/深色主题和 Retina 下清晰。
- 每个 `showInRightRail` 未设为 `false` 的可见 `views.rightSidebar` View 会在 Code 模式右侧图标栏获得直接入口，并拥有独立顶层标签；没有 icon 时宿主使用可访问的 fallback，不会执行扩展代码来生成图标。设为 `false` 的 View 仍可由扩展管理页或命令打开，但不会常驻该图标栏。
- `when` 只决定 visibility/enablement，不授予权限。
- `order` 只在宿主分组内参与排序；同优先级按 fully-qualified ID 稳定排序。
- 多实例只在 contribution contract 明确允许时创建，每个实例有独立 View Session。

仅渲染 title/icon 不激活扩展。打开 View 后，宿主检查兼容、enablement、workspace trust 和权限，再触发 `onView:<id>`。

右侧 View 与主 Agent 协作时，应把能力注册为扩展工具，并把“当前项目”等有界指针放在 `storage.workspace`。主 Agent 通过工具读取和修改权威状态，View 通过宿主消息刷新；两者不能共享 React state、DOM、runtime token 或私有 Electron IPC。默认随 Kun 安装的 [`kun-video-editor`](../../examples/extensions/kun-video-editor/) 展示了这一模式。

## 命令

声明：

```json
{
  "commands": [
    {
      "id": "refresh",
      "title": "Refresh issues"
    }
  ]
}
```

注册：

```ts
context.subscriptions.add(
  await context.commands.registerCommand('refresh', async args => {
    const workspace = context.workspaceContext
    // Validate business input and perform bounded work.
    void args
    return { refreshed: true, workspaceId: workspace?.id ?? null }
  })
)
```

要求：

- Manifest 声明和运行时注册 local ID 必须一致；
- 需要 `commands.register`；
- workspace metadata 从只读 `context.workspaceContext` 获取；命令参数只含公开 Schema 数据，不能相信其中自报的扩展身份；
- 参数与返回值必须通过公开 Schema，且受 payload/时间限额；
- action/menu 只能引用同扩展命令或文档明确公开的宿主命令；
- 引用另一个扩展的 private command 会验证失败；
- handler error 以扩展、版本、命令和 workspace 归因并脱敏显示。

命令不应直接表示审批结果、账号秘密或 `request_user_input` 答案。敏感操作必须经过 Host-owned protected flow。

## Actions 与 Context Menu

Action 使用宿主组件渲染。典型声明包含：

- local `id`；
- command 引用；
- `title`、可选 icon；
- host-defined `group`、`order`；
- `when`。

需要 `ui.actions`，命令本身还需要 `commands.register`。宿主负责：

- keyboard navigation、focus ring、accessible name；
- 文本截断、tooltip、disabled/busy 状态；
- 确认样式和受保护确认的转接；
- 同位置的稳定排序；
- 主题和高对比度适配。

不要用多个相邻 action 模拟复杂 UI；超过一个简单操作时，使用 View/Webview。

## 结果预览上下文

当成功的工具结果包含带 MIME type 的生成文件时，Kun 会打开匹配的 `message.resultPreviews` View，并在 guest 完成绑定后投递一条 session-bound host message：

- channel：`kun.resultPreview.open`；
- payload：`{ schemaVersion: 1, threadId, turnId, result }`；
- `result`：有界的 `sourceId`、规范化 `mimeType`，以及可选的安全 `name`、`attachmentId`、workspace-relative path、byte size、width 和 height。

该 payload 不包含 absolute path、preview data URL、文件字节、runtime token 或 credential。读取所引用的内容仍需通过正常的 attachment/workspace permission 与 Broker 操作。请通过 `context.ui.onDidReceiveMessage` 监听，不要依赖 Electron guest IPC channel。

## 设置

Settings contribution 只用于非秘密、结构化配置。一个 Section 声明稳定 `id`、`title`、global/workspace `scope`（默认 workspace）、`order`，并在 `properties` 中为每个 field 声明：

- 稳定 local key；
- type、default、enum/range 等受限 Schema；
- title/description。

Node Host 和 Webview 使用同一个宿主持久化 API；不要另建 `localStorage` 副本：

```ts
const mode = await context.configuration.get<'safe' | 'fast'>('general', 'mode')

context.subscriptions.add(
  context.configuration.onDidChange((change) => {
    if (change.sectionId === 'general' && change.key === 'mode') {
      console.log('mode changed', change.value)
    }
  })
)

await context.configuration.update('general', 'mode', 'safe')
const declaredKeys = await context.configuration.keys('general')
```

`sectionId` 和 key 必须来自本扩展 Manifest。宿主根据 section 的 scope 选择 global 或当前显式信任的 workspace namespace，应用 default/type/enum/range/length 与大小限制，并用 revision 防止两个设置界面静默互相覆盖。`@kun/extension-react` 的 `useConfiguration(sectionId, key)` 使用同一后端。

账号 API key、OAuth token、cookie、client secret 不得写入 settings；常见 snake_case、kebab-case 和 camelCase secret key 会被拒绝。使用[受保护账号流程](./providers-and-accounts.md#账号创建与认证)。大型二进制、缓存或频繁变化数据使用 Storage API，而不是 settings。

设置更新必须：

- 经过宿主 Schema 验证；
- 只影响本扩展命名空间；
- 产生版本化 change event；
- 不用 label 作为持久化 key；
- 对旧 key 的删除/迁移遵守公开状态迁移规则。

## 通知

需要 `ui.notifications`。通知由宿主从声明式数据渲染，只允许有界纯文本、severity 和已声明命令操作。通知应：

- 明确指出扩展来源；
- 可用 keyboard/屏幕阅读器关闭；
- 不包含秘密或完整 prompt；
- 不用于重复 update 提醒（v1 不自动检查扩展更新）；
- 对可恢复错误提供一个明确动作，例如打开日志或重新认证。

Guest 不能直接请求 Chromium notification permission。

运行时通知使用 `context.ui.showNotification()`。它不是 Chromium 通知，也不要求扩展先打开一个 View：Kun 在受信工作台中显示有界纯文本，并把用户选择的 action `id` 精确返回给原始调用；关闭、超时、扩展停用或 Kun 退出时返回 `undefined`。纯 headless 运行没有受信工作台，调用会立即返回 `undefined`，不会等待 45 秒；GUI 异常断开后，心跳 lease 过期也会关闭未决通知。

```ts
const selected = await context.ui.showNotification({
  id: 'provider-unavailable',
  title: '模型供应商暂不可用',
  message: '请重新连接账号后重试。',
  severity: 'warning',
  actions: [{ id: 'retry', title: '重试' }]
})

if (selected === 'retry') await retryConnection()
```

每个扩展最多同时保留 8 条、全局最多 64 条运行时通知；默认 45 秒超时。工作台一次最多展开 5 条，其余按队列逐步显示。action 只返回声明的本地 `id`，不会替扩展执行命令；宿主只接受 Chromium 标记为可信的真实用户点击，Direct DOM 的合成 `.click()` 会被拒绝。通知 action 仍不是审批、身份确认或秘密授权入口；特权或其他受保护操作必须继续调用对应的 protected consent API，并由 Main-owned protected surface 完成真实用户确认。Manifest `contributes.notifications` 则是宿主直接渲染的声明式通知，其 action 通过 Manifest 中声明的 command 执行；两者不要混用。

## `when` 与 Context Keys

`when` 是封闭表达式，不执行 JavaScript。仅使用目标 API 版本公开的 context keys，例如工作区是否打开、当前 workbench mode、selection capability 或已协商能力。未知 key 解析为 unavailable。

设计原则：

- 用 `when` 隐藏完全不相关的 action；权限不足时宿主仍在 Broker 再检查；
- 不把秘密、文件内容、用户文本放进 context key；
- 不依赖 raw DOM 状态；
- context 变化时允许宿主关闭不再合法的 session；
- 在 handler 内再次验证业务前置条件，处理 stale click race。

## Enablement、权限和工作区 Trust

Contribution 只有同时满足以下条件才出现：

1. 包与 Kun/API/Manifest 兼容；
2. selected version 完整性通过；
3. 全局和当前 workspace 都启用；
4. workspace trust 允许；
5. contribution 所需权限全部被授予；
6. `when` 为 true。

权限撤销立刻阻止新调用。UI 可能同时在收起，但 stale invocation 仍必须被 Broker 拒绝。启用扩展后新增/变更工具不会静默改变正在运行 thread 的 tool catalog，详见[工具 Catalog](./agent-and-tools.md#工具-catalog-与缓存稳定性)。

## UX 与可访问性要求

- 使用宿主 theme token，不读取私有 CSS variable。
- 支持 host locale、zoom、reduced motion 和 high contrast。
- View container 必须有宿主可访问名称和 focus boundary。
- View 关闭后焦点返回来源控制；不要把焦点留在已销毁 guest。
- 重要操作提供清晰 loading、cancel、empty、error 和 reconnect 状态。
- 长列表虚拟化；不要用无限 Webview 高度破坏布局。
- 文案应说明扩展/Provider 所有者和数据流，不伪装为 Kun 核心提示。
- 不把敏感确认放进普通 workbench DOM；它不能生成有效 consent token。

## 故障与清理

View crash 显示有界、可恢复的扩展归因 placeholder，不拖垮主 renderer。disable、uninstall、workspace switch 或 View close 会 dispose session、pending calls 和 subscriptions。卸载后，宿主删除 stale layout 引用但默认保留 extension data。

使用 `kun extension doctor <id>` 检查贡献注册、缺失权限、无效 entry 和布局故障；使用 `kun extension logs <id>` 查看已脱敏的命令/View 诊断。
