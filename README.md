<p align="center">
  <img src="src/asset/img/deepseek.png" width="96" alt="DeepSeek GUI 图标">
</p>

# DeepSeek GUI

[English](./README.en.md) | 简体中文

> 把 DeepSeek TUI 的本地智能体能力带进桌面窗口：聊天、读写项目、审查改动、管理 Skill/MCP 和更新，都在一个图形化工作台里完成。

[官网](https://deepseek-gui.com)

[![GitHub release](https://img.shields.io/github/v/release/XingYu-Zhong/DeepSeek-GUI?label=github)](https://github.com/XingYu-Zhong/DeepSeek-GUI/releases)
[![License](https://img.shields.io/github/license/XingYu-Zhong/DeepSeek-GUI)](./LICENSE)

DeepSeek GUI 是一个面向开发者和高频 AI 工作者的本地桌面工作台。它基于 [DeepSeek TUI](https://github.com/Hmbown/DeepSeek-TUI) 的能力，把终端里的智能体体验整理成更容易上手、更适合长期使用的应用：选择工作目录，发起任务，实时查看推理、工具调用和文件改动，并在需要时审批或回退。

这个项目的目标不是再造一个聊天壳，而是让 DeepSeek 变成一个可以稳定参与真实项目工作的桌面伙伴。

---

## 我们做了什么

- 把 DeepSeek TUI 的本地运行时封装进桌面应用，默认可以自动启动和管理。
- 做了一套完整的聊天工作台，支持多会话、实时流式输出、历史回看、中断和重新发送。
- 打通本地工作目录，让智能体可以围绕真实项目读取、编辑和创建文件。
- 做了文件变更审查视图，让每一次修改都能被看见、理解和确认。
- 做了首次引导、设置页、语言/主题/字体大小、系统通知、错误日志和更新入口。
- 做了 Skill 与 MCP 的图形化管理，让用户不用手写很多配置也能扩展智能体能力。
- 做了 Claw 后台自动化，支持飞书 / Lark 接入、独立 IM Agent、本地 webhook / relay 和定时任务。
- 提供 macOS、Windows 预构建安装包；Linux/Unix 用户可从源码自行构建。

## 功能亮点

- **桌面聊天工作台**：多会话、流式回复、推理过程、工具调用、审批请求和文件改动都在同一个界面中展示。
- **项目级工作区**：为每个任务选择本地目录，按工作区管理会话，并支持文件预览、编辑器打开和 Git 分支选择。
- **变更审查**：内联 diff 和侧边审查面板会记录智能体产生的文件改动，便于在应用内完成 review。
- **权限可控**：支持只读、工作区可写、完全访问等模式，并可配置工具调用前是否需要审批。
- **运行时托管**：默认使用内置 DeepSeek TUI；也可以在设置中指定自己的 `deepseek` 可执行文件。
- **Skill 与 MCP**：在图形界面中创建 Skill、保存 MCP 配置、添加常用工具，并打开对应目录继续管理。
- **Claw 后台自动化**：可开启独立于普通聊天的后台 Agent，当前支持飞书 / Lark 接入、IM webhook / relay，以及按计划自动执行任务。
- **首次配置友好**：首次启动会引导你选择语言、填写 DeepSeek API Key，并按需配置兼容服务地址。
- **本地优先**：设置、会话状态、日志和运行时配置保存在本机；模型调用使用你自己的 DeepSeek API Key。
- **中英文界面**：应用和 README 均提供中文、英文版本，界面语言可随时切换。
- **跨平台使用**：提供 macOS `.dmg/.zip`、Windows `.exe`；Linux/Unix 用户可从源码构建。

## 适合谁

- 想用 DeepSeek 处理真实代码库，但不想一直留在终端里的开发者。
- 希望清楚看到智能体做了什么、改了哪些文件、哪些操作需要批准的团队。
- 需要长期维护多个项目、多个会话，并希望把 Skill/MCP 配置沉淀下来的用户。
- 想用本地工作台连接 DeepSeek 官方 API 或 OpenAI 兼容服务的人。

---

## 下载安装

### 下载预构建安装包

前往 [GitHub Releases](https://github.com/XingYu-Zhong/DeepSeek-GUI/releases) 下载最新版本：

| 平台 | 安装包 |
| --- | --- |
| macOS | `.dmg` 或 `.zip`，支持 Intel 与 Apple Silicon |
| Windows | `.exe`，NSIS 安装器，x64 |

目前暂不提供 Linux/Unix 预构建下载包。Linux 用户可以从源码自行构建；由于应用内终端依赖 `node-pty` 原生模块，请在 Linux 平台上构建 Linux 包，不建议在 macOS 或 Windows 上交叉打包 Linux 版本。

首次启动时需要填写 [DeepSeek API Key](https://platform.deepseek.com/api_keys)。如果你使用兼容 DeepSeek / OpenAI 的服务，也可以在设置里修改 Base URL。

### 从源码运行

适合贡献者或需要本地开发的人：

```bash
git clone https://github.com/XingYu-Zhong/DeepSeek-GUI.git
cd DeepSeek-GUI
npm install
npm run dev
```

环境要求：

- Node.js 20+
- 可用的 DeepSeek API Key
- 首次安装依赖时需要联网

中国大陆访问较慢时，可以使用 npm 镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

---

## 首次使用

1. 打开 DeepSeek GUI。
2. 在首次引导中选择界面语言。
3. 填入 DeepSeek API Key；如果需要，设置自定义 Base URL。
4. 选择默认工作目录，或使用应用自动创建的默认目录。
5. 新建会话，输入任务，让智能体开始工作。

常用流程：

- 在左侧选择或切换工作区。
- 在聊天框描述你要完成的任务。
- 观察回复中的推理、工具调用、命令执行和文件改动。
- 对需要审批的操作选择允许或拒绝。
- 在变更审查面板里检查改动，再决定下一步。

如果你想开启 Claw 自动化：

- 在设置页打开 `Claw`，启用后台自动化。
- 添加飞书 / Lark 连接，为每个连接配置 Agent 名称、人设、默认模型和工作目录。
- 按需开启本地 webhook / relay，并创建定时任务，让 Claw 在后台持续处理消息或周期性任务。

## 设置与使用

设置页集中管理这些内容：

- DeepSeek API Key、Base URL、运行时端口和运行时 Token。
- 是否自动启动本地运行时，以及是否使用自定义 `deepseek` 路径。
- 工具审批策略和文件系统权限范围。
- 默认工作目录、语言、主题、字体大小和完成通知。
- GUI 更新、DeepSeek TUI 更新、本地错误日志。
- Skill 创建与目录管理、MCP 配置编辑。
- Claw 后台自动化、飞书 / Lark 连接、Webhook / Relay 和定时任务。

快捷键：

| 按键 | 功能 |
| --- | --- |
| `Enter` | 发送消息 |
| `Shift+Enter` | 在输入框中换行 |
| `Ctrl+Enter` | 发送消息 |
| `Esc` | 关闭面板或退出当前浮层 |

---

## 卸载

### Windows

- 打开“设置 -> 应用 -> 已安装的应用”，找到 `DeepSeek GUI` 并卸载。
- 或在“控制面板 -> 程序和功能”中卸载。
- 也可以运行安装目录中的卸载程序。

Windows 安装器默认会创建开始菜单和桌面快捷方式。安装包不会强制固定到任务栏；如需固定，可在开始菜单中右键 `DeepSeek GUI` 并选择固定。

### macOS

- 将 `DeepSeek GUI.app` 从“应用程序”移到废纸篓。
- 如果首次打开被系统拦截，可在 Finder 中右键应用并选择“打开”。
- 本地未公证构建可先运行：

```bash
npm run mac:unquarantine -- '/Applications/DeepSeek GUI.app'
```

### Linux

- 如果你是从源码构建的 Linux 包，删除对应的 `.AppImage` 或安装文件即可。
- 如果你手动创建了桌面入口或快捷方式，也一并删除。

### 清理本地数据

默认卸载只移除应用文件，会保留本地设置、会话和运行时配置，便于后续重装恢复。若要彻底清理，可按需删除：

| 平台 | 应用数据位置 |
| --- | --- |
| macOS | `~/Library/Application Support/DeepSeek GUI` |
| Windows | `%APPDATA%\DeepSeek GUI` |
| Linux | `~/.config/DeepSeek GUI` |

DeepSeek TUI 的共享配置通常位于 `~/.deepseek`。删除前请确认其中没有你还需要的 API Key、MCP 或 Skill 配置。

---

## 更新

- 普通用户：macOS/Windows 可在设置页检查 GUI 更新，或前往 [GitHub Releases](https://github.com/XingYu-Zhong/DeepSeek-GUI/releases) 下载最新安装包；Linux/Unix 请从源码构建。
- DeepSeek TUI 运行时：如果使用 GUI 托管运行时，可在设置页检查并升级内置 TUI。

## 贡献指南

欢迎提交 bug 修复、UI/UX 优化、文档改进、本地化内容、构建发布流程和运行时集成相关改动。

协作约定：

- 当前默认协作分支为 `develop`。
- 新功能和修复建议从最新 `develop` 拉出短期功能分支开始。
- PR 默认提交到 `develop`，由维护者审核后再合入 `master`。
- 对高风险改动请先沟通范围，再进入实现。
- 发起 PR 前运行 `npm run typecheck`、`npm run build`，以及 `npm run test`。
- 如果改动影响界面，请附上视频或 GIF。
- 如果改动影响项目逻辑，请附上对应单元测试。
- 如果改动影响使用方式，请同步更新 `README.md` 和 `README.en.md`。

详见 [CONTRIBUTING.zh-CN.md](./docs/CONTRIBUTING.zh-CN.md) 和 [DEVELOPMENT.zh-CN.md](./docs/DEVELOPMENT.zh-CN.md)。

## 本地构建

```bash
npm run build           # 生产构建
npm run dist:mac        # macOS 安装包
npm run dist:win        # Windows 安装包
npm run dist:linux      # Linux AppImage；请在 Linux 平台上运行
```

Linux/Unix 预构建下载包暂不发布。需要 Linux 版本时，请在目标 Linux 环境中安装依赖后自行运行 `npm run dist:linux`；应用内终端依赖 `node-pty`，跨平台打包可能导致终端启动失败。

更多开发流程请看 [DEVELOPMENT.zh-CN.md](./docs/DEVELOPMENT.zh-CN.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [CONTRIBUTING.zh-CN.md](docs/CONTRIBUTING.zh-CN.md) | 贡献说明 |
| [DEVELOPMENT.zh-CN.md](docs/DEVELOPMENT.zh-CN.md) | 本地开发与协作流程 |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | 社区行为准则 |
| [SECURITY.md](SECURITY.md) | 安全漏洞披露方式 |

底层运行时的完整说明请参考 [DeepSeek TUI](https://github.com/Hmbown/DeepSeek-TUI)。

---

## 致谢

- [DeepSeek TUI](https://github.com/Hmbown/DeepSeek-TUI)：提供本地智能体运行时能力。
- [LobsterAI](https://github.com/netease-youdao/LobsterAI)：IM 管理、扫码绑定、Agent 绑定与自定义人设流程给了本项目 Claw IM 集成很多启发。
- [DeepSeek](https://github.com/deepseek-ai)：提供模型与 API。
- 所有为 DeepSeek GUI 提交 issue、建议、代码和文档的贡献者。

> [!NOTE]
> 本项目与 DeepSeek Inc. 无隶属关系。

## 许可证

[MIT](./LICENSE)

## Star 历史

[![Star History Chart](https://api.star-history.com/chart?repos=XingYu-Zhong/DeepSeek-GUI&type=date&legend=top-left)](https://www.star-history.com/?repos=XingYu-Zhong%2FDeepSeek-GUI&type=date&logscale=&legend=top-left)
