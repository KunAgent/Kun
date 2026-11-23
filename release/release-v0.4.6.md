# Kun 0.4.6

0.4.6 把实验训练、论文写作与多 Agent 算力管理连进同一个工作台：新增独立 Notebook 空间连接 Google Colab GPU 与 Jupyter 服务器，Work 支持编写、编译与审阅 LaTeX 论文项目，内置 Antigravity 切换至 ACP 协议并带来多订阅配额与按 Agent 用量统计。同时接入 DeepSeek 原生联网与语音能力、支持 Code 多目录项目，并修复外部 Agent 审批、ACP 工具恢复与跨平台稳定性问题。

## ✨ 新功能

- **Colab 与 Jupyter Notebook**：侧栏新增独立 Notebook 空间，可新建、导入本地 `.ipynb` 或加载账号历史 Notebook，连接 Google Colab GPU 运行时或本地、远端 Jupyter 服务器运行单元格、查看内核变量、转发端口并直传大文件，配套 Kun Notebook 助手协助改写代码与排查报错。Code 工作台同时集成多账号 Google Colab 云端训练面板，在独立虚拟环境中托管 `google-colab-cli`，实时查看训练日志、指标曲线、显存与计算单元（CU）消耗并同步回传产物，提供创建前审批、空闲自动停机与低余额提醒保护。
- **LaTeX 论文项目**：Work 支持新建中英文模板或导入文件夹、ZIP 创建 LaTeX 论文项目，在单个标签页内切换 `.tex`、`.bib` 等源文件并支持源码、分屏与 PDF 对照视图。支持调用本地 `latexmk` 编译、SyncTeX 光标与 PDF 双向定位、论文库引文补全，也可按需下载校验官方 TinyTeX 独立工具链；编译报错修复与选中文本改写均先进入审阅面板，确认接受后才会保存并重新编译。
- **Antigravity ACP 接入与配额看板**：内置 Antigravity Agent 切换至 ACP 协议，支持流式 Token 用量与上下文占用实时追踪、模型专属推理档位控制、预热 MCP 连接及 Design 方案交付。自动发现 Antigravity 配额与共享配额池，新增 Devin 订阅配额展示；优化输入框上下文容量浮窗的分组额度与重置倒计时，并在用量面板增加“按 Agent”统计维度与手机端只读用量查看。
- **DeepSeek 原生联网与语音能力**：新增 DeepSeek 原生网页搜索与网页抓取工具接入，并支持 `DeepSeek ASR` 与 `DeepSeek TTS` 语音协议，可直接复用已配置的供应商凭据。
- **Code 多目录项目**：新建或管理 Code 项目时可添加多个互不重叠的本地目录，主目录保持固定且移除附加目录不删磁盘文件。包含附加目录时会明确提示关闭隔离工作树以直接访问本地目录，也可将空闲对话同步到最新目录范围。
- **跨模型会话保留与分派进度**：在 `kun-gateway` 与 ACP 运行时中切换同一供应商下的模型时保留已委托的子会话上下文。团队分派卡片支持按 Worker 分组展示进展、错误与结果报告，同一回合多次更新同一组件原型时合并展示最新预览卡片。
- **手机连接默认权限**：手机配对及局域网、隧道直连默认开放完整的移动端非桌面协作权限（直连默认包含桌面查看与控制，不含分享管理），仍可在桌面端按设备收窄或随时调整。
- **独立 CLI 候选包与非交互保护**：支持构建和校验独立的 `@kunagent/agent` npm 候选包，无需安装桌面应用即可运行 `kun` Runtime、CLI 与 TUI。`kun run` 在非交互模式下遇到阻塞输入会及时退出，无人值守的审批请求超时后自动过期。

## 🐛 修复与改进

- **外部 Agent 审批请求**：恢复外部 Agent 的工具审批卡片展示，加固审批信封的参数脱敏、动作构造与目标提取。
- **ACP 工具调用与输出恢复**：准确分类 ACP 工具调用并显示工具标识，隔离异常更新与超长标题，恢复已记录的工具输出及 Devin 执行结果。
- **Antigravity 兼容性与任务续接**：适配 Antigravity 工具参数结构并在工具完成后继续待处理任务，支持客户端升级探测并拒绝不兼容的旧版 ACP 协议。
- **会话重放与启动恢复**：防止已接受的 Antigravity 回合被重复重放，仅在确认原生会话缺失时重建，并在启动时恢复孤立的 Manager 会话。
- **Windows 更新回滚与命令隔离**：回滚安装后使用原用户令牌重新启动旧版应用，并独立序列化 Windows Shell 命令源以减少转义干扰。
- **Linux、桌面伙伴与界面细节**：Linux 保留工作区路径大小写并在终端启动立即失败时自动回退，Wayland 下改用本地坐标处理桌面伙伴位置与拖动。同时减少 Write 文件树的多余加载提示，并改进电脑远控连接报错说明。

## 兼容与环境提示

Google Colab 功能需通过系统浏览器完成 Google 账号授权，计算单元（CU）按所选账号自身的额度计费，Kun 不会自动跨账号轮换；托管的 `google-colab-cli` 安装在独立虚拟环境中，不修改系统 Python。远端运行时回收后 `/content` 中的临时文件会清除，请保留本地副本并及时同步产物。

LaTeX 论文在未安装编译器时仍可正常编辑和保存源码；PDF 编译与 SyncTeX 双向定位需本机安装含 `latexmk` 的 TeX 发行版，或在“设置 → Work → LaTeX 论文”中按需下载独立 TinyTeX 工具链（Unix 系统需具备 Perl 与支持 xz 的 tar）。

独立 `@kunagent/agent` npm 分发包目前处于候选验证阶段（要求 Node 26.4 及以上），不包含桌面画布、计算机控制、内置桌面扩展及本地 Office 与媒体工具链。

---

## English

Kun 0.4.6 connects experiment training, academic writing, and multi-Agent quota tracking in one workbench: a dedicated Notebook space runs on Google Colab GPUs or Jupyter servers, Work adds LaTeX paper projects with compilation and reviewed revisions, and the built-in Antigravity harness moves to ACP with multi-subscription quotas and per-Agent usage breakdowns. This release also adds native DeepSeek web and speech capabilities, multi-folder Code projects, and fixes for external Agent approvals, ACP tool recovery, and cross-platform stability.

### Features

- **Colab and Jupyter Notebooks**: Open the new Notebook space from the sidebar to create, import local `.ipynb` files, or load historical notebooks, and connect to Google Colab GPU runtimes or local and remote Jupyter servers to run cells, inspect kernel variables, forward ports, and upload large files directly with help from the Kun Notebook Assistant. Code also integrates a multi-account Google Colab training panel backed by an isolated `google-colab-cli` environment to monitor live logs, metric curves, VRAM, and compute units (CU), sync back artifacts, and guard spend with pre-launch approval, idle auto-stop, and low-balance reminders.
- **LaTeX paper projects**: Create Chinese, English, or blank LaTeX papers or import folders and ZIP archives in Work, switching `.tex`, `.bib`, and related sources inside a single tab across Source, Split, and PDF views. Compile locally with `latexmk`, jump both ways with SyncTeX, complete `\cite` keys from your paper library, or install a checksum-verified managed TinyTeX toolchain on demand; Kun's build repairs and selection edits stage in the Review panel and write files only after you accept and recompile.
- **Antigravity ACP and quota insights**: Switched the built-in Antigravity Agent to ACP with live streaming token and context occupancy tracking, model-specific reasoning controls, eager MCP warm-up, and Design delivery. Automatically discover Antigravity quotas and shared quota pools alongside new Devin subscription quotas, refine grouped metrics and reset countdowns in the composer capacity popover, and add a "By Agent" usage breakdown plus read-only mobile usage views.
- **DeepSeek native web and speech**: Added native DeepSeek web search and page-fetching tools, plus `DeepSeek ASR` speech-to-text and `DeepSeek TTS` text-to-speech protocol support that reuse your configured DeepSeek provider credentials.
- **Multi-folder Code projects**: Include multiple non-overlapping local folders in a Code project while keeping the main folder fixed and leaving disk files untouched on removal. Multi-folder projects clearly prompt to turn off isolated worktrees when direct local access is needed, and can sync an idle active conversation.
- **Delegated session retention and dispatch progress**: Preserve delegated sessions across same-provider model switches in `kun-gateway` and ACP. Team dispatch cards now group progress, errors, and worker reports by Worker, and repeated updates to the same component prototype within a turn collapse into the latest preview card.
- **Mobile link default permissions**: Phone pairing and direct LAN or tunnel connections now grant compatible mobile collaboration scopes by default (direct connections include desktop viewing and control, excluding share management). Per-device narrowing remains available on desktop.
- **Standalone CLI candidates and noninteractive guards**: Added standalone `@kunagent/agent` npm candidate packaging and verification so `kun` Runtime, CLI, and TUI can run without the desktop app. `kun run` now exits promptly on blocked input in noninteractive sessions and expires unattended approvals.

### Fixes and improvements

- **External Agent approvals**: Restored external Agent tool approval prompts and hardened parameter redaction and target extraction.
- **ACP tool calls and output recovery**: Classified ACP tool calls with visible identities and recovered recorded outputs and Devin results. Malformed updates and long titles are isolated cleanly.
- **Antigravity compatibility and continuation**: Adapted Antigravity tool schemas to continue pending work and reject unsupported legacy ACP versions. Client upgrade checks remain active.
- **Replay safety and startup recovery**: Prevented accepted Antigravity turns from replaying and recovered orphaned Manager sessions on startup. Native sessions rebuild only when confirmed missing.
- **Windows rollback and shell isolation**: Relaunched rolled-back Windows installs with the original user token and isolated shell command sources.
- **Linux, desktop companions, and UI polish**: Preserved Linux workspace path case with terminal startup fallback and local Wayland pet coordinates. Trimmed redundant Write file-tree loading states and clarified remote computer connection errors.

### Compatibility and environment notes

Google Colab features require signing in with Google in your system browser. Compute units (CU) are billed to the selected account's own Colab balance, and Kun never rotates accounts automatically. The managed `google-colab-cli` runs in an isolated virtual environment without modifying system Python. Temporary files under `/content` are cleared when a remote runtime is recycled; keep local copies and sync important outputs.

LaTeX source editing and saving work without a compiler. Building PDFs and SyncTeX navigation require a local TeX distribution with `latexmk`, or an on-demand managed TinyTeX installation under Settings → Work → LaTeX papers (Perl and xz-capable tar are required on Unix systems).

Standalone `@kunagent/agent` npm packages are currently in candidate verification (requiring Node 26.4 or later) and exclude the desktop canvas, computer-control backends, bundled desktop extensions, and local Office or media toolchains.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.4.5...v0.4.6)
