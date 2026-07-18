# Manifest 参考

> Extension API：v1
> English: [Manifest reference](./manifest.en.md)
> 机器真源：随 `@kun/extension-api` 发布的 `kun-extension.schema.json`

每个扩展包或开发目录的根必须有 `kun-extension.json`。Kun 在读取任何扩展代码或远程内容之前验证 Manifest、版本、入口、贡献、权限与资源引用。未知字段/贡献类型、无效引用和不兼容版本必须按同版本 Schema 处理，不能靠忽略字段“猜测兼容”。

## 完整骨架

```json
{
  "$schema": "https://kun.dev/schemas/extensions/manifest/v1.json",
  "manifestVersion": 1,
  "apiVersion": "1.0.0",
  "publisher": "acme",
  "name": "issue-assistant",
  "version": "1.2.0",
  "displayName": "Issue Assistant",
  "description": "Manage issues with a sidebar and Kun Agent tools.",
  "icon": "assets/issue-assistant.svg",
  "engines": {
    "kun": ">=0.1.0"
  },
  "main": "dist/extension.js",
  "browser": "dist/webview/index.html",
  "activationEvents": [
    "onView:issues",
    "onCommand:refresh",
    "onTool:create-issue"
  ],
  "contributes": {
    "commands": [],
    "views.rightSidebar": [],
    "actions.topBar": [],
    "settings": [],
    "tools": [],
    "agentProfiles": []
  },
  "permissions": [
    "commands.register",
    "ui.views",
    "ui.actions",
    "webview",
    "agent.run",
    "agent.threads.readOwn",
    "tools.register",
    "network:api.example.com",
    "storage.workspace"
  ],
  "stateSchemaVersion": 1
}
```

空数组可以省略。实际 Manifest 应只声明扩展真正需要的贡献和权限。

## 顶层字段

| 字段 | 必填 | 约束与含义 |
| --- | --- | --- |
| `$schema` | 否 | 编辑器提示用的 URL，不参与运行时兼容决策；应匹配目标 API 文档版本 |
| `manifestVersion` | 是 | Manifest 结构版本；v1 固定为整数 `1` |
| `apiVersion` | 是 | Extension API SemVer；用于能力协商，不是 npm 包版本范围 |
| `publisher` | 是 | 发布者 ID；与 `name` 组成不可变身份 |
| `name` | 是 | 扩展名称 ID；必须符合 Schema，不能使用保留身份 |
| `version` | 是 | 此 `.kunx` 包的 SemVer 版本 |
| `displayName` | 否 | 面向用户的短名称，作为不可信纯文本渲染 |
| `description` | 否 | 面向用户的说明，作为不可信纯文本渲染 |
| `icon` | 否 | 扩展 Logo 的包内相对路径；用于扩展中心等 Host 界面，建议使用方形 SVG 或至少 80×80 的 PNG |
| `localizations` | 否 | Host 渲染的 Manifest 和贡献显示文案的有界语言覆盖 |
| `license` | 否 | 简短许可证标识；发布包仍必须包含 `LICENSE` |
| `homepage` | 否 | 扩展主页 HTTPS URL |
| `engines.kun` | 是 | 兼容 Kun 版本的 SemVer range |
| `main` | 条件必填 | Node Host 入口的包内相对路径 |
| `browser` | 条件必填 | browser/Webview 入口的包内相对路径 |
| `activationEvents` | 是 | 允许启动扩展代码的静态事件；可以为空 |
| `contributes` | 是 | 静态贡献声明；可以为空对象 |
| `permissions` | 是 | 精确的字符串权限列表；可以为空数组 |
| `stateSchemaVersion` | 是 | 非负整数状态 Schema 版本；与包/API 版本独立，新扩展推荐从 `1` 开始 |
| `signature` | 否 | 当前支持的签名 metadata；用于来源证明，不代表安全审计 |

未声明顶层 `icon` 时，Host 可以兼容使用第一个声明了图标的 View 容器或主 View；都没有时显示默认占位图标。Logo 文件与其他 Manifest 资源一样，必须通过包内相对路径、完整性和受控资源协议校验。

`main` 与 `browser` 至少存在一个。任何要求 headless 的工具、Agent profile、模型 Provider、认证处理器、计划任务或后台命令都必须存在 `main`；Kun 不会用 `browser` 代替 Node 入口。

Browser-only Manifest（只有 `browser`）不能声明 `commands`、`agentProfiles`、`tools`、`modelProviders` 或 `authentication`；这些都需要 Node handler。所有 `browser` 入口都必须声明 `webview` 权限。

完整 ID 为 `publisher.name`，一旦公开不得更改。改名等同于一个新扩展，旧状态、权限、账号和 thread 不会自动转移。

`publisher` 使用小写 ASCII 字母/数字/连字符、以字母或数字开头，最长 64；`name` 和所有 local contribution ID 使用小写字母开头，之后只允许小写字母/数字/连字符，最长 64。以同版本 Schema 的正则和保留字校验为准。

## Host 渲染文案的本地化

`localizations` 把最多 32 个有界 BCP 47 语言标签映射为纯文本显示覆盖。基础 Manifest 始终是必需的 fallback，也是身份、激活事件、权限、路径、可执行 Schema 和 Agent instructions 的稳定真源。覆盖只能修改已知显示字段，且必须引用已声明的贡献、设置属性、通知操作或 Provider model。

```json
{
  "displayName": "Issue Assistant",
  "contributes": {
    "views.rightSidebar": [{ "id": "issues", "title": "Issues", "entry": "dist/index.html" }]
  },
  "localizations": {
    "zh-CN": {
      "displayName": "问题助手",
      "contributes": {
        "views.rightSidebar": {
          "issues": { "title": "问题" }
        }
      }
    }
  }
}
```

Kun 先按大小写不敏感的完整标签匹配，再逐级匹配更宽的语言标签（`zh-Hans-CN` → `zh-Hans` → `zh`），最后使用基础 Manifest。Webview 内容仍通过 `ui.getLocale` 和 `ui.localeChanged` 自行本地化；Manifest 覆盖用于侧栏 tooltip、面板/结果预览标题、扩展中心卡片和声明式设置等 Host chrome。

## 版本字段

五个版本维度彼此独立：

- `version`：扩展包版本；
- `manifestVersion`：Manifest Schema major；
- `apiVersion`：公开 Extension API SemVer；
- `stateSchemaVersion`：扩展持久化状态的整数版本；
- `engines.kun`：允许运行的 Kun SemVer range。

Kun/Host 的私有 `rpcVersion` 不写入 Manifest。不要通过提高包版本来暗示 API 或状态兼容，详细规则见[版本与迁移](./versioning-and-migrations.md)。

可选 `signature` v1 使用 `{ "algorithm": "ed25519", "keyId": "...", "value": "..." }`。它证明包声明的来源，不代表代码经过安全审计；包字节、Index SHA-256 和文件 integrity 仍分别验证。

## 入口

入口必须：

- 使用规范化包内相对路径；
- 位于完整性清单和允许资源根内；
- 不能包含绝对路径、`..` 逃逸或符号链接；
- 在 validate、pack 和安装时存在；
- 与所声明贡献的执行环境一致。

`main` 模块公开 `activate(context)`，可选公开 `deactivate()`；详见[生命周期](./lifecycle.md)。`browser` 是沙箱 View 资源入口，不是 Node 模块，也不会获得自定义 preload。

## 激活事件

v1 支持：

| 事件 | 触发时机 |
| --- | --- |
| `onStartup` | Kun runtime 启动并完成 admission 后；只用于确实需要 eager background 的 Node 扩展 |
| `onView:<id>` | 用户打开该本地 View 贡献 |
| `onCommand:<id>` | 调用该本地命令 |
| `onTool:<id>` | Kun 要调用该本地工具 |
| `onProvider:<id>` | 选择或请求该模型 Provider |
| `onAuthentication:<id>` | 需要该认证处理器 |
| `onAgentProfile:<id>` | 使用该 Agent profile |

`<id>` 是 Manifest 内本地贡献 ID。Validator 会双向检查引用：每个 View/command/tool/Provider/authentication/Agent profile 必须声明对应事件（或扩展明确使用 `onStartup`），每个非 startup 事件也必须指向真实贡献；不会把拼错的事件降级为第一个任意事件。仅展示图标、标题或设置元数据不会激活代码。不要把 `onStartup` 当作默认值。

## 贡献点

`contributes` 只接受下列 v1 键。所有本地 ID 在同类贡献中必须唯一；所有可打开的 View（包括 result preview）还共享同一个 ID namespace。`modelProviders[].authenticationProviderId` 必须指向本 Manifest 的 authentication contribution。宿主将本地 ID 解析为 `extension:<publisher.name>/<local-id>` 或等价的命名空间身份。

| 键 | 用途 | 关键声明内容 |
| --- | --- | --- |
| `commands` | 扩展命令 | `id`、`title`，参数/结果 Schema（如适用） |
| `views.containers` | Activity/sidebar 容器 | `id`、title、icon、位置/排序 |
| `views.leftSidebar` | 左侧栏 View | `id`、`title`、`entry`，可选 icon/`when`/order |
| `views.rightSidebar` | 右侧栏 View | 同上；可选 `showInRightRail` |
| `views.auxiliaryPanel` | 辅助面板 | 同上 |
| `views.editorTab` | 编辑区 Tab | 同上；宿主管理 tab 生命周期 |
| `views.fullPage` | 全页 View | 同上；不能覆盖受保护窗口 |
| `actions.topBar` | 顶部操作 | id、命令引用、`title`、可选 icon/`when`/group/order |
| `actions.composer` | Composer 操作 | 同上；只得到公开 invocation context |
| `actions.message` | 消息操作 | 同上；不能越权读取其它 thread |
| `message.resultPreviews` | 结果预览 | id、title、entry、`mimeTypes`、可选 resource roots/`when` |
| `settings` | 设置 Section/字段 | id、title、`properties`、global/workspace scope、order |
| `contextMenus` | 上下文菜单项 | id、location、命令、group/order、`when` |
| `notifications` | 声明式通知 | id、title、可选 message/severity/actions/`when`；action 含 id/title/command |
| `agentProfiles` | Agent profile | id、显示信息、instruction overlay、默认绑定/工具范围/预算/可见性 |
| `tools` | 扩展工具 | `id`、`description`、`inputSchema`；可选 `outputSchema`/sideEffects/idempotent/maxOutputBytes（1 KiB–1 MiB） |
| `modelProviders` | 完整模型 Provider | id、displayName、authenticationProviderId、model/capability 元数据 |
| `authentication` | 认证 Provider | id、认证类型和受保护流程元数据 |
| `hostContentScripts` | Direct DOM | 静态脚本/样式、允许宿主 surface、激活条件；高风险且不稳定 |

`views.rightSidebar` 是新扩展的规范可发现 UI：默认情况下，View 的包内 icon 和本地化标题会出现在 Code 模式右侧竖向图标栏，并在主会话旁打开独立标签。设置 `showInRightRail: false` 可保留可由扩展管理页或命令打开的 View，但不在图标栏常驻。其它 `views.*` 位置继续保留 Extension API v1 解析和命令路由兼容，但宿主不会为它们生成额外的聚合扩展选择器。

需要固定远程网站时，View 可声明 `externalBrowser: { presentation, sites }`。`presentation` 为 `desktop` 或 `mobile`；每个 site 只接受 `id`、`title`、可选 badge/accent 和 credential-free HTTPS `url`。这要求 `webview.external`，且每个 site hostname 必须匹配显式 `network:` grant。远程页由 Main-owned browser surface 承载，不加载扩展 `entry` 或 bridge。

### Contribution 隐含权限

Validator 从入口/贡献自动推导并强制以下最小权限；缺少时 Manifest 无效：

| 入口/贡献 | 必需权限 |
| --- | --- |
| 任意 `browser` | `webview` |
| `commands` | `commands.register` |
| `views.containers` | `ui.views` |
| 任意 `views.*` View | `ui.views`, `webview` |
| 带 `externalBrowser` 的 View | `webview.external` 和每个 site 的 `network:<hostname>` |
| `message.resultPreviews` | `ui.views`, `webview` |
| `actions.*`, `settings`, `contextMenus` | `ui.actions` |
| `notifications` | `ui.notifications` |
| `agentProfiles` | `agent.run` |
| `tools` | `tools.register` |
| `modelProviders` | `providers.register` |
| `hostContentScripts` | `hostDom` |

这些只是注册/呈现所需权限；实际 handler 仍要声明其使用的 workspace、network、account、storage 等权限。`authentication` 的账号读取/管理/use/secret 权限按具体调用检查。

最小命令：

```json
{
  "commands": [
    { "id": "refresh", "title": "Refresh issues" }
  ]
}
```

最小 View：

```json
{
  "views.rightSidebar": [
    {
      "id": "issues",
      "title": "Issues",
      "entry": "dist/webview/index.html",
      "icon": "assets/issues.svg",
      "when": "workspaceOpen",
      "order": 100,
      "localResourceRoots": ["dist/webview", "assets"]
    }
  ]
}
```

最小工具：

```json
{
  "tools": [
    {
      "id": "create-issue",
      "description": "Create an issue in the configured project",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "minLength": 1 }
        },
        "required": ["title"],
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type": { "const": "text" },
            "text": { "type": "string" }
          },
          "required": ["type", "text"],
          "additionalProperties": false
        }
      },
      "sideEffects": "external",
      "idempotent": false,
      "maxOutputBytes": 32768
    }
  ]
}
```

Contribution 的详细行为见[工作台](./workbench.md)、[Agent 与工具](./agent-and-tools.md)和[Provider 与账号](./providers-and-accounts.md)。Schema 是字段级完整参考；文档中的省略示例不能用于绕过 validator。

## `when` 条件

`when` 使用宿主定义的封闭、无副作用表达式语言和公开 context keys。它不能执行 JavaScript、读取 renderer global、DOM 或私有 store，也不能创造调用者没有的权限。未知 key/capability 解析为 unavailable。

只使用同一 API 版本文档列出的 context key 和运算符。把业务决策放进命令 handler；`when` 只负责可见/可用状态。状态变化后，宿主可能隐藏贡献并按该 contribution contract 关闭 View Session。

## 权限

v1 权限是精确字符串数组：

| 权限 | 允许的 Broker 能力 |
| --- | --- |
| `commands.register` | 注册 Manifest 声明的命令 |
| `ui.views` | 提供受控 View |
| `ui.actions` | 提供宿主渲染的 action/menu/settings controls |
| `ui.notifications` | 请求宿主通知 |
| `webview` | 创建声明的复杂 Webview UI |
| `webview.external` | 在隔离子 Webview 中显示经 `network:*` 授权的远程 HTTPS 网站（高风险） |
| `hostDom` | 注入声明的 Direct DOM content scripts（高风险） |
| `agent.run` | 创建和控制 extension-owned Agent Run |
| `agent.threads.readOwn` | 查询本扩展拥有的 thread/run 投影 |
| `tools.register` | 注册 Manifest 声明的工具 |
| `providers.register` | 注册模型 Provider |
| `accounts.read` | 读取获准范围内的脱敏账号元数据 |
| `accounts.use:<providerId>` | 使用指定 Provider 的账号句柄 |
| `accounts.manage:<providerId>` | 请求指定 Provider 的受保护账号管理流程 |
| `accounts.secrets.read:<providerId>` | Node Host 请求指定 Provider 的原始秘密；高风险、单独确认 |
| `network:<hostname>` / `network:*.example.com` | 通过 Network Broker 访问精确 hostname，或显式接受的子域 wildcard |
| `storage.global` | 使用扩展隔离的全局状态 |
| `storage.workspace` | 使用扩展隔离的工作区状态 |
| `workspace.read` | 通过 Broker 读取获准工作区 |
| `workspace.write` | 通过 Broker 写入获准工作区，仍受政策/审批限制 |

只声明最小权限。新增权限的包版本不会继承旧同意：用户必须在受保护窗口重新确认。`webview.external` 还要求显式的 `network:<hostname>` 授权；该网络授权在这里限制远程子 Webview 的顶层导航，子页面绝不会获得 Kun preload、Node 或 Electron。权限不会让普通 browser 或 content script 获得 Node/秘密，也不能绕过 Kun ApprovalGate。详见[安全与资源](./security-and-resources.md)。

## Direct DOM 声明

`hostContentScripts` 必须静态列出 `id`、`matches`、`scripts`，可选 `styles`，以及 `runAt: "documentStart" | "documentEnd"`；运行时不能请求注入未声明文件或 surface。`matches` 使用宿主 surface token，不是 URL glob：可选值为 `workbench:*`、`workbench:code`、`workbench:design`、`workbench:write`、`workbench:connect`。Settings/初始设置包含凭据和执行权限控制，始终是 protected surface；没有 `workbench:settings` matcher，`workbench:*` 也不会匹配它或其它凭据/consent 窗口。安装器会把 `hostDom` 显示为最高风险能力。

这些脚本在插件专属 isolated world 中运行，可以访问可见 DOM，但不能访问页面 JavaScript 对象、React internals、Electron、Node、`window.kunGui` 或受保护 consent/credential surface。宿主 DOM、选择器和 CSS 不属于稳定 API，详见[Webview 与 Direct DOM](./webview-and-dom.md)。

## 资源与完整性

发布包根还必须包含：

- `README.md`；
- `LICENSE`；
- `kun-extension.integrity.json`；
- 所有入口和 Manifest 引用的本地资源。

完整性清单记录包文件的 SHA-256。安装验证拒绝未声明/缺失文件、摘要不一致、路径穿越、绝对路径、link、重复/大小写碰撞路径、越界资源和超过公布限制的包。不要把秘密、令牌、私钥、开发 `.env` 或用户数据打进 `.kunx`。

## 验证

```bash
kun extension validate .
kun extension validate ./dist/acme.issue-assistant-1.2.0.kunx
```

验证错误应包含稳定诊断代码、JSON path、说明和文档链接。兼容性失败会指出具体维度（Manifest、API、Kun engine、state 或 Host negotiation），而不是只报“版本错误”。
