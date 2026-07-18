# 五分钟快速开始

> Extension API：v1
> English: [Five-minute quick start](./quick-start.en.md)
> 参考：[Manifest](./manifest.md) · [生命周期](./lifecycle.md) · [CLI](./cli-testing-debugging.md)

本指南创建一个 React Webview 右侧栏扩展。你不需要 Kun 源码，也不需要使用 Electron 或 Kun 的内部 IPC。

## 1. 准备环境

需要：

- 一个支持 Extension API v1 的 Kun 安装；
- Kun CLI 可执行文件 `kun`；
- 当前受支持的 Node.js LTS 和 npm；
- 一个用于 Manifest 身份的 publisher，例如 `acme`。

先确认工具：

```bash
kun --version
kun extension --help
node --version
```

## 2. 创建项目

下面是独立项目的公网 registry 路径。先检查脚手架和模板依赖是否真的已发布：

```bash
npm view create-kun-extension version
npm view @kun/extension-api version
npm view @kun/extension-react version
npm view @kun/extension-test version
```

只有当前模板所需的命令都返回版本时才继续。`E404` 表示配置的 registry
还没有独立开发所需的产物，此时请使用仓库内的
[扩展示例](../../examples/extensions/README.md)，不要把仓库相对 `file:` 路径写进
需要移植的项目。`kun` CLI 来自 Kun 安装；npm 上无 scope 的同名 `kun` 包不是
Kun Agent CLI。

```bash
npx create-kun-extension hello-sidebar \
  --template react \
  --publisher acme \
  --name hello-sidebar
cd hello-sidebar
npm install
```

可选模板为 `node`、`webview` 和 `react`。脚手架会生成最小权限 Manifest、独立 Node/Webview 入口（模板需要时）、build/test/validate/pack 脚本和对应版本的文档链接。

生成项目的核心布局类似：

```text
hello-sidebar/
  kun-extension.json
  README.md
  LICENSE
  src/host/extension.ts
  src/webview/index.html
  src/webview/main.tsx
  package.json
  tsconfig.host.json
  tsconfig.webview.json
  vite.config.ts
```

构建产物目录和完整性文件由打包脚本生成，不要手工编辑最终 `.kunx`。

## 3. 理解最小 Manifest

React 模板会声明 Node 入口和 Webview 文档。下面是关键字段的缩略示例；以脚手架生成文件和同版本 JSON Schema 为准：

```json
{
  "$schema": "https://kun.dev/schemas/extensions/manifest/v1.json",
  "manifestVersion": 1,
  "apiVersion": "1.0.0",
  "publisher": "acme",
  "name": "hello-sidebar",
  "version": "0.1.0",
  "displayName": "Hello Sidebar",
  "engines": { "kun": ">=0.1.0" },
  "main": "dist/extension.js",
  "browser": "dist/webview/index.html",
  "activationEvents": [
    "onView:hello"
  ],
  "contributes": {
    "commands": [
      { "id": "refresh", "title": "Refresh greeting" }
    ],
    "views.rightSidebar": [
      {
        "id": "hello",
        "title": "Hello",
        "entry": "dist/webview/index.html",
        "localResourceRoots": ["dist/webview"]
      }
    ]
  },
  "permissions": [
    "commands.register",
    "ui.views",
    "webview"
  ],
  "stateSchemaVersion": 1
}
```

扩展完整 ID 是不可变的 `publisher.name`，这里为 `acme.hello-sidebar`。贡献在宿主中解析为 `extension:acme.hello-sidebar/hello`；命令和其它注册项同样由宿主绑定到扩展命名空间，不要在 payload 中自报另一个扩展 ID。

## 4. 实现并释放资源

脚手架的 `src/host/extension.ts` 导出 `activate(context)`，并把注册返回的 `Disposable` 加入 `context.subscriptions`：

```ts
import type { ExtensionContext } from '@kun/extension-api'

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.add(
    await context.commands.registerCommand('refresh', async () => {
      await context.ui.postMessage({
        channel: 'hello',
        payload: {
          type: 'greeting',
          text: 'Hello from the Kun Extension Host'
        }
      })
      return { accepted: true }
    })
  )
}

export async function deactivate(): Promise<void> {
  // context.subscriptions is disposed by the Host.
}
```

不要导入 Kun 源码、Electron、`window.kunGui` 或私有 HTTP/RPC。View 使用框架中立 bridge；React 模板通过 `ExtensionViewProvider` 和公开 Hooks 接收主题、locale、状态及消息。

## 5. 构建和测试

```bash
npm run build
npm test
npm run validate
```

`validate` 必须检查同一份生成 Schema、入口文件、贡献引用、权限、引擎/API 兼容和本地资源。修复所有 error；warning（例如已弃用 API 或 Direct DOM 风险）也应在发布前处理或明确接受。

开发测试不需要打包：

```bash
kun extension install --development .
kun extension reload acme.hello-sidebar
kun extension doctor acme.hello-sidebar
```

开发目录保持原位，不会复制到安装目录，也不会被 Kun 自动 reload。每次重新构建后显式执行 `reload`。如果本机 CLI 的参数形式有变化，以 `kun extension <command> --help` 显示的同版本语法为准。

## 6. 打包并侧载

```bash
npm run pack
kun extension install ./dist/acme.hello-sidebar-0.1.0.kunx
kun extension list
kun extension doctor acme.hello-sidebar
```

安装前，Kun 会在受保护窗口显示来源、ID、版本、SHA-256、签名状态、贡献和权限。Node 或 Direct DOM 权限会显示额外高风险说明。确认后才会原子安装并选择该版本。

打开 Kun，在 Code 模式右侧竖向图标栏中直接选择 **Hello**，Kun 会把它作为独立的右侧工作区标签打开。只渲染图标和标题不会激活 Node 入口；真正打开 View 时 `onView:hello` 才触发激活并建立一个身份绑定的 View Session。

## 7. 查看日志与清理

```bash
kun extension logs acme.hello-sidebar
kun extension disable acme.hello-sidebar
kun extension uninstall acme.hello-sidebar
```

卸载默认只删除包注册和代码，保留扩展状态、日志和账号引用。删除这些数据是另一个需要明确确认的操作。

## 下一步

- 添加工作台命令和设置：[工作台贡献点](./workbench.md)
- 在 View 内持久化状态或联网：[权限与资源](./security-and-resources.md)
- 从侧栏启动 Kun Agent：[Agent Runs 与工具](./agent-and-tools.md)
- 发布 `.kunx`：[打包与 Index](./packaging-and-index.md)
