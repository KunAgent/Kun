<p align="center">
  <img src="src/asset/img/kun.png" width="88" alt="Kun 蓝色 K 标识">
</p>

<h1 align="center">Kun — 本地优先的个人 AI 工作助手</h1>

<p align="center">
  把目标、资料、任务和 AI 协作放在自己的电脑上。<br>
  与个人 Agent 持续跟进，在 Rooms 组织多 Agent 协作，用 Code / Work 交付结果。
</p>

<p align="center">
  <a href="https://github.com/KunAgent/Kun/releases">下载桌面版</a>
  &nbsp;·&nbsp;
  <a href="https://www.kun-agent.com/docs">阅读文档</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/KunAgent/Kun">GitHub</a>
  &nbsp;·&nbsp;
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/KunAgent/Kun/releases"><img src="https://img.shields.io/github/v/release/KunAgent/Kun?label=release" alt="Kun 最新 GitHub Release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" alt="Kun 使用 PolyForm Noncommercial 1.0.0 许可证"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="支持 macOS、Windows 和 Linux">
  <img src="https://img.shields.io/badge/GUI%20%2B%20TUI-one%20shared%20runtime-6366f1" alt="桌面 GUI 与终端 TUI 共用一个 Kun 运行时">
</p>

<p align="center">
  <img src="./docs/assets/readme/kun-hero-gui-tui-character-demo.jpg" alt="Kun GUI 与 TUI 海报：虚构演示数据中的吉祥物、桌面 Code 界面与终端 TUI" width="100%">
</p>

## Kun 是什么

Kun 是运行在你电脑上的 AI 工作助手。它把长期个人 Agent、Rooms 多 Agent 协作、Code 开发工作台和 Work 文档工作台连接到同一个本地运行时，让讨论、执行、审批和交付都保留在同一个上下文里。

你可以先让一个 Agent 跟进一件小事；需要不同视角时，把多个 Agent 邀进 Room；需要动手时，再进入 Code 或 Work。每个 Agent 能看什么、能做什么，以及成果何时被接受，都由你决定。

### 核心入口

| 入口 | 在你的工作中负责什么 |
| --- | --- |
| **个人 Agent** | 日常对话与持续跟进。拥有稳定身份、私聊、个人工作区和可管理的记忆；从 Code 会话区或 Rooms 都能进入同一段私聊。 |
| **Rooms** | 按主题组织多个 Agent。把讨论、分工、项目约定、执行任务和评审放进同一个协作空间。 |
| **Code + ADE** | 软件任务执行与交付。Code 提供项目、终端、Git / Worktree、Diff 和 Design 画布；ADE 的 Agent 接入与协作能力已融入 Code。 |
| **Work** | 资料与文档工作。起草 Markdown，预览、引用和分析 PDF / Office 文档，分析电子表格、编辑支持的 XLSX、创建演示文稿，或用白板梳理想法。 |

个人 Agent 是与你长期对话的身份；Code 中选择的执行 Agent 是完成某个开发任务的执行者。两者各有自己的配置和权限，可以先从一个 Agent 和一件具体任务开始。

> 本文介绍 `develop` 分支的能力。下载版的可用功能取决于具体版本；ADE 协作仍需启用实验功能，外部 Agent 和应用接入也各有配置要求。

## 个人 Agent：持续跟进，而不是一次性问答

为自己创建一个通用助手，或选择研究、设计、开发、评审等职责不同的 Agent。可以通过对话定义它，也可以直接填写档案或使用模板。

- **上下文可以接着用。** 每个 Agent 有自己的私聊、工作区和运行记录。普通资料整理无需先建 Git 仓库，也可以明确连接本地文件夹。
- **记忆由你管理。** 查看记忆来源，修正、停用、忘记或明确共享相关内容。记忆受 Agent 和来源范围限制，不会自动向所有 Agent 开放，也不能代替授权。
- **把事情跟到结果。** Agent 可以记录待办目标、截止时间、阻塞原因和交付证据；支持一次性或周期提醒，并在后台任务结束后把结果带回原会话。
- **需要动手时进入工作台。** 根据该 Agent 的 Code / Work 访问策略，提出代码任务、文档任务或文档修改。任务卡保留状态、审批、结果和打开工作台的入口；你也可以进入对应会话接手。

默认的工作台访问策略是 **Code 先确认、Work 只读**。要让 Agent 创建或修改 Work 内容，请先在它的 **Code 与 Work 权限** 中选择合适的授权策略。

## Rooms：把讨论、分工与交付放在一起

当一件事需要不同视角时，把相关 Agent 放进同一个群聊。可以先讨论而不连接仓库；要执行仓库任务，再绑定本地 Git 仓库并给相应成员授权。

- **按需要组织协作。** 同行讨论由成员判断是否有新贡献；协调者模式负责分工；定向协作通过 @ 提及或默认响应者聚焦到具体成员。
- **让约定成为共同上下文。** 只有你明确固定的内容才成为项目约定，任务保存当时的约定版本，后续变更也有记录。
- **从建议走到可审阅的任务。** Agent 可以提出执行、添加成员或固定约定的提案卡片，由你采纳或忽略。
- **把成果和验收分开看清。** Rooms 仓库执行任务在独立 Git worktree 中运行，交付固定到具体版本，再由指定 Reviewer 评审。Diff、声明的检查、日志和评审结果跟着任务走；接受交付与应用代码是两个独立操作。

Rooms 是你与多个 Agent 的协作空间。群聊中的讨论、历史内容或其他 Agent 的建议，都不会自动变成新的执行授权。

## Code + ADE：给任务选择合适的执行者

ADE 的能力已经融入 Code 工作台，日常开发从同一个项目和任务入口开始。你可以继续使用 Kun，也可以在完成接入后选择 Claude Code、Codex、Gemini CLI、Cursor、Devin 等外部 Agent；可用的模型、权限和工具取决于各 Agent 的实际能力及登录状态。

- **在输入框选择执行 Agent。** 使用原 Code / 设计位置的 Agent 菜单；模型来源和模型仍在各自的菜单中配置。
- **需要时再开启协作。** 启用 ADE 实验功能后，Kun 任务可通过“＋ → 协作处理”拆分工作、派发 worker 并跟进结果；协作默认值、团队上限和预算可在设置中调整。
- **在原有界面里检查和接手。** 从协作面板查看 worker，从改动视图检查 Diff、验证与审查信息。任务工作区、权限与版本边界继续保留。
- **设计与代码保持联系。** Kun 的 Design 画布支持原型、设计系统和 Design → Code 上下文；Design、Graph 和计划等 Kun 专属流程需使用 Kun 执行。

外部 Agent 需要相应的程序、账号或模型来源。接入状态以应用里的检测和试运行为准，支持某个适配器不代表所有账号和网络环境都已验证可用。配置见 [Code 与 ADE 融合说明](docs/ade/14-code-workbench-integration.md)。

## Work：把资料变成可交付文档

Work 面向日常资料、文档和内容产出，适合不一定需要 Git 仓库的任务。

- **从本地资料开始。** 打开文件夹，预览、引用和分析 PDF / Office 文档，让回答和草稿回到可检查的来源。
- **在一个工作台里产出。** 起草 Markdown，分析电子表格、编辑支持的 XLSX 内容、创建演示文稿，或用白板组织思路。
- **让 Agent 参与但保留边界。** 个人 Agent 可以按授权发起文档任务或修改；任务卡、来源和结果仍能与原会话互相追溯。

## 三个上手任务

| 场景 | 怎么开始 | 到哪里看结果 |
| --- | --- | --- |
| 整理一周的工作 | 给个人 Agent 一份本地记录：“提取待办、截止时间和需要我确认的问题。”需要提醒时明确时间。 | 在私聊查看待办与结果，按需设置提醒。 |
| 把资料变成可用的文档 | 在 Work 打开资料：“按这些来源起草一份方案，标出缺失信息。”也可以授权个人 Agent 发起 Work 任务。 | 在 Work 查看文档，回到任务卡继续跟进。 |
| 推进一个软件需求 | 在 Rooms 讨论范围，让开发和评审各自提出意见；确认目标和仓库后执行，或直接在 Code 新建任务。 | 检查固定版本的交付、Diff、验证和评审，再决定是否应用。 |

这些是任务示例；能读取哪些来源、执行哪些步骤，取决于你已配置的模型、工具和权限。

## 开始使用

从 [GitHub Releases](https://github.com/KunAgent/Kun/releases) 选择适合你的版本：

| 平台 | 安装包 | 架构 |
| --- | --- | --- |
| macOS | `.dmg` / `.zip` | Apple Silicon / Intel |
| Windows | `.exe` | x64 |
| Linux | `.AppImage` / `.deb` | x64 |

1. **连接一个模型。** 选择语言，配置可用的模型订阅、计划、API 或自定义 Provider。接入方式见 [模型 Provider 文档](docs/model-provider-presets.md)。
2. **从一段私聊开始。** 在 Code 的会话区或 Rooms 新建会话，选择或创建一个个人 Agent，给出一个具体目标和必要资料；不需要先创建团队或代码项目。
3. **确认访问范围。** 查看 Agent 的权限、工作目录和 Code / Work 访问策略。先用默认确认方式体验一次完整任务。
4. **按任务进入工作台。** 资料工作用 Work，软件任务用 Code，多视角协作用 Rooms。需要 ADE 协作时，在设置的实验室中开启，随后在“助手 → Agent 接入 / 协作”完成配置。
5. **检查结果再继续。** 查看产物、来源、改动和验证；处理待你确认的事项，或提出下一步要求。

喜欢终端工作时，桌面 GUI 与 TUI 可共用本地 `kun serve` 运行时中的线程、计划和审批。保持桌面应用运行，在项目目录显式连接它的运行时：

```bash
kun --no-start
```

单独使用 TUI 时，先退出同一配置下的桌面应用，再运行 `kun`；默认 TUI 会启动自己的运行时，并在退出时停止它。

从 0.3.8 起不再单独分发 TUI 压缩包；请使用桌面应用内置的终端命令，更多配置见 [Kun TUI 文档](docs/kun-tui.md)。

## 本地优先与使用边界

- **数据默认落在本机。** 会话、Agent 记忆、偏好、日志和运行时数据保存在本地。使用云端模型时，提示、附件和相关上下文会发送给所选 Provider；连接应用、MCP 或外部 Agent 也可能与对应服务通信，请查看各服务的数据政策。
- **模型选择与你的工作分开。** Kun 支持 OpenAI / Anthropic 兼容服务及自托管模型，预设覆盖 DeepSeek、Ollama、Kimi、GLM、Qwen 等生态。订阅、模型、地区和额度以 Provider 当前规则为准。
- **权限决定可以做什么。** 工具和目录权限、审批与扩展权限共同限制操作。记忆、提醒、团队讨论和切换界面都不会扩大权限；新个人私聊默认先请求批准。
- **后台工作需要运行中的电脑。** 默认关闭桌面主窗口会退出应用并停止其管理的工作。提醒与后台任务需要 Kun 运行、电脑保持唤醒，联网任务还需要网络。可选的独立常驻模式需显式使用 `kun host start` 启动，且同一配置不能与默认 GUI 同时拥有运行时，详见 [运行方式与生命周期](docs/rooms-persistent-host.md)。
- **应用接入按实际状态使用。** MCP、Skills、Hooks、Loops、定时任务与扩展可以补充能力。Google Workspace 当前为 **Experimental / Developer Preview**，需要自行完成 Google Cloud 与 OAuth 配置；Gmail / Calendar 写入逐次审批，Drive 只读，详见 [集成范围与配置](docs/google-workspace-cli.md)。

## 界面预览

以下沿用仓库中已有的隔离演示素材，展示 Code 和 Work 的工作方式，不代表所有新入口的最新截图；素材不包含真实项目、账户或会话数据。

### Code：项目、任务与改动

<p align="center">
  <img src="./docs/assets/readme/code-mode-overview.webp" alt="Code 演示界面：项目、任务入口、分支与任务输入区">
</p>

### Work：资料、文档与产出

<p align="center">
  <img src="./docs/assets/readme/work-mode-overview.webp" alt="Work 演示界面：文件树、文档任务入口和 Work assistant">
</p>

## 从源码运行

要求：Node.js 22.19+、npm，以及至少一个可用的模型连接。

```bash
git clone --branch develop https://github.com/KunAgent/Kun.git
cd Kun
npm ci
npm run dev
```

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 构建运行时并启动 Electron 开发环境 |
| `npm run dev:tui` | 构建运行时并启动终端 TUI |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | 运行 ESLint 与文件大小检查 |
| `npm run test` | 运行测试 |
| `npm run build` | 生产构建 |
| `npm run dist:mac` / `dist:win` / `dist:linux` | 构建对应平台安装包 |

中国大陆网络访问较慢时可使用 npm 镜像：

```bash
npm ci --registry=https://registry.npmmirror.com
```

## 文档与贡献

| 主题 | 文档 |
| --- | --- |
| TUI、命令和运行时 | [docs/kun-tui.md](docs/kun-tui.md) / [kun/README.zh-CN.md](kun/README.zh-CN.md) |
| 个人 Agent、记忆与会话 | [docs/independent-agents.md](docs/independent-agents.md) / [docs/code-agent-chats-and-rooms.md](docs/code-agent-chats-and-rooms.md) |
| 个人 Agent 与工作台衔接 | [docs/rooms-workbench.md](docs/rooms-workbench.md) |
| Code 与 ADE 协作 | [docs/ade/14-code-workbench-integration.md](docs/ade/14-code-workbench-integration.md) |
| 提醒与后台运行 | [docs/rooms-reminders.md](docs/rooms-reminders.md) / [docs/rooms-persistent-host.md](docs/rooms-persistent-host.md) |
| Design 工作流 | [docs/DESIGN_MODE.md](docs/DESIGN_MODE.md) |
| Rooms 多 Agent 协作 | [docs/rooms.md](docs/rooms.md) |
| Loops、MCP 与 Skills | [docs/workflow-loop.md](docs/workflow-loop.md) / [docs/project-mcp-skills.md](docs/project-mcp-skills.md) |
| Extension 平台 | [docs/extensions/README.md](docs/extensions/README.md) |
| 本地开发 | [docs/DEVELOPMENT.zh-CN.md](docs/DEVELOPMENT.zh-CN.md) |

欢迎贡献 bug 修复、UI/UX、运行时、Provider、扩展和文档。日常集成分支为 `develop`，PR 请以 `develop` 为目标分支；开始前阅读 [贡献指南](docs/CONTRIBUTING.zh-CN.md)，外部贡献需要接受 [CLA](./CLA.md)。

## 许可证

Kun 使用 [PolyForm Noncommercial License 1.0.0](./LICENSE)，仅供学习、研究和非商业用途。商业使用、商业分发、SaaS / 托管服务、转售或集成到商业产品中，需要获得作者的单独书面授权。

## 致谢

感谢所有提交 issue、建议、代码和文档的贡献者。

Kun 的记忆架构研究参考了 [Nowledge Mem](https://mem.nowledge.co/zh/docs) 公开文档中的 Thread / Memory 分离、来源追踪与混合检索理念；Kun 的实现保持独立，并遵循自身的单运行时和本地优先架构。

<a href="https://github.com/KunAgent/Kun/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=KunAgent/Kun" alt="Kun contributors">
</a>
