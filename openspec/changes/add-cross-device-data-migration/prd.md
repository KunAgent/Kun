# Kun 跨设备数据迁移 PRD

## 1. 文档信息

- 产品：Kun Desktop
- 功能名称：数据迁移（Data Migration）
- 入口：设置 -> 数据迁移
- 目标平台：Windows、macOS、Linux
- 交付形态：本地 `.kunpack` 迁移包；不依赖 Kun 账号或云服务
- 状态：方案评审稿

## 2. 一句话方案

用户在 A 电脑的 Kun 设置中选择要迁移的工作区和历史数据，生成一个带版本、校验、可选密码保护的 `.kunpack`；在 B 电脑导入后，Kun 先做只读预检，再让用户映射目标目录、解决冲突，最后通过可回滚事务恢复工作区、聊天历史、设计/写作内容和可迁移配置。

它不是“把隐藏目录直接压缩”，而是“导出逻辑数据 + 工作区文件 + 显式路径映射”。

## 3. 背景与问题

当前用户的工作成果分散在：

- 一个或多个 Code 工作目录；
- Write 工作空间与文档；
- Design 目录中的 `.kun-design`、原型、SVG、设计系统文件；
- Kun `dataDir` 中的 thread/session、消息、事件、附件、artifact 和 memory；
- Electron 设置与 renderer 本地注册表中的 workspace/thread 关联；
- 工作流、计划、定时任务和连接手机配置中的目录或会话引用。

直接复制这些目录有五类问题：

1. 正在运行的会话可能一边写一边复制，得到不一致历史。
2. `index.sqlite3`、缓存、密钥和 OAuth 状态不是跨设备可移植数据。
3. `C:\Users\Alice\Project` 在 macOS/Linux 上不能使用，路径大小写和文件名规则也不同。
4. 目标机可能已有同名目录、同 ID 会话或更新版本的数据。
5. 压缩包可能包含密钥、恶意路径、符号链接逃逸或解压炸弹，不能直接解压到用户目录。

## 4. 用户与核心场景

### 4.1 目标用户

- 更换新电脑，希望把 Kun 工作完整带走的个人用户。
- 同时使用公司 Windows 和个人 Mac，希望离线搬运项目与上下文的用户。
- 电脑损坏前做本地备份，之后恢复到另一系统的用户。
- IT/支持人员协助用户迁移 Kun 数据，但不应获得或激活用户账号密钥。

### 4.2 Jobs to be done

- “我希望在新电脑打开 Kun 后，能看到原来的项目和聊天，并继续工作。”
- “我希望先知道会迁移什么、不会迁移什么、需要多少空间。”
- “如果两台电脑上都有数据，我不希望导入把新电脑的数据覆盖掉。”
- “Windows 路径换到 Mac 后，我希望 Kun 自动修复能安全识别的路径，不能修复的要告诉我。”
- “如果导入中断，我希望可以恢复或撤销，而不是留下半套数据。”

## 5. 产品目标与成功标准

### 5.1 目标

- 用户无需寻找隐藏目录即可完成 A -> B 的手动迁移。
- 默认路径下不覆盖目标机现有工作区或不同内容的历史会话。
- 支持六种跨系统方向：Windows <-> macOS、Windows <-> Linux、macOS <-> Linux，以及同系统迁移。
- 导入前给出完整预检；确认前对目标机零写入。
- 导入失败、取消或崩溃后可以继续或回滚。
- Kun 自有的密钥、OAuth、令牌、信任授权和运行中任务零迁移、零自动激活。

### 5.2 核心指标

- 可支持包的预检成功率 >= 99.5%。
- 无未提示覆盖导致的数据丢失事件。
- 受支持、无文件系统冲突的同系统迁移成功率 >= 99%。
- 受支持、无不可表示文件名的跨系统迁移成功率 >= 97%。
- 迁移后的历史会话可打开率 >= 99.9%，附件可读取率 >= 99.5%。
- 导入失败后的自动/手动回滚成功率 = 100%（故障注入测试门槛）。
- 包内 Kun 自有凭据数量 = 0（自动安全扫描门槛）。

### 5.3 非目标

- 不做云同步、自动备份、局域网直传或双向合并。
- 不克隆操作系统、开发环境、已安装依赖、模型、编辑器或终端进程。
- 不迁移 API key、OAuth、MCP 登录、运行令牌、系统钥匙串、连接渠道令牌。
- 不自动修改源代码或普通聊天文本中的任意绝对路径。
- 不承诺把 Linux 上目标文件系统无法表示的文件名无损搬到 Windows。

## 6. 产品原则

1. 先预检，后写入。
2. 默认保留两份，不默认覆盖。
3. 路径按语义重绑定，不做全局字符串替换。
4. 迁移内容可解释：每一类包含/排除项都能看到。
5. 导入包永远不可信，导入项目永远不自动执行。
6. 长任务可离开页面、可取消、可恢复、可回滚。
7. 格式版本独立于当前磁盘布局，旧包用迁移器升级。

## 7. 功能范围与版本拆分

### P0：可安全交付的完整迁移闭环

- 设置页数据迁移入口与导出/导入向导。
- 工作区、聊天历史、Design/Write 内容、附件/artifact、便携设置和注册表。
- 完整/精简两种内容预设和逐工作区选择。
- `.kunpack` 格式、ZIP64、SHA-256 完整性、流式读写。
- 可选密码保护（scrypt + 分块 AES-256-GCM）；未加密导出必须二次确认。
- 同系统和跨系统路径映射、文件名兼容性预检。
- 新目录导入、保留两份、非冲突合并、会话 ID 去重/重映射。
- staging、journal、崩溃恢复、回滚、完成报告。
- 凭据硬排除，计划/定时任务禁用导入。
- 中英文、键盘操作、读屏进度与明确错误恢复动作。

### P1：复杂冲突和管理增强

- 文件替换与冲突备份、备份保留/清理策略。
- 安全的内部相对符号链接重建或显式物化。
- 管理员策略：强制加密、禁止导出、限制目标目录。
- 导入包独立检查工具与支持团队诊断导出。

### 后续版本

- 扩展提供的版本化迁移 adapter。
- 云备份/账号同步或设备直传（单独立项）。
- 增量包和大工作区内容寻址去重（单独格式版本）。

内部 dogfood 可以先验证未加密容器，但公开 v1 必须同时交付密码保护；用户仍可在明确确认风险后生成未加密包。

## 8. 可迁移数据矩阵

| 数据 | 默认 | 导入行为 |
| --- | --- | --- |
| 工作区内普通文件与隐藏文件 | 包含 | 还原到用户映射目录 |
| `.kun-design`、`.kunsdd`、Design/Write 产物 | 包含 | 作为工作区文件还原，并修复注册表 |
| thread/session/messages/events/usage/goals/todos | 包含 | 保留时间与历史；运行态归一为 idle |
| 会话附件与 content-addressed artifacts | 包含 | 按可达性导出、哈希去重、重写作用域 |
| 与所选工作区关联的 memory | 默认包含，可关闭 | 重写路径，按未信任上下文导入 |
| 界面语言、主题、排版、便携编辑偏好 | 包含 | 允许用户选择是否应用 |
| Design/Write/Plan/SDD/thread/fork 注册表 | 包含 | workspaceId、threadId 重映射 |
| 工作流定义 | 可选 | 导入但不自动运行 |
| 定时任务定义 | 可选 | 导入为禁用，清空渠道绑定，用户复核后启用 |
| `.git` 主仓库元数据 | 完整预设包含 | 不跟随外部 worktree；提示可能存在敏感 remote URL |
| `node_modules`、`.venv`、构建输出、缓存 | 完整预设包含；精简预设排除 | 精简模式显示精确排除清单 |
| `.env`、私钥等敏感名称的工作区文件 | 需确认 | 明示风险并推荐密码保护 |
| API key、OAuth、MCP token、runtime token | 永不包含 | B 电脑重新登录/配置 |
| `secret.key`、credential store、系统钥匙串 | 永不包含 | 不提供覆盖开关 |
| workspace trust、审批、待回答输入 | 永不激活 | gate 转为不可操作历史，目标重新授权 |
| 运行中的 turn、后台 shell、子任务进程 | 不直接迁移 | 等待完成/用户中断；进程不恢复 |
| logs、crash、observability、临时文件 | 不包含 | 完成报告中列出类别 |
| binaries、local models、agent SDK、依赖缓存 | 不包含 | B 电脑按需重新安装 |
| 扩展包和不透明扩展数据 | v1 不包含 | 列出缺失扩展，用户重新安装 |

## 9. 信息架构与设置页

设置首页视觉稿见 [`assets/data-migration-settings-mockup.png`](./assets/data-migration-settings-mockup.png)，可编辑源文件为 [`assets/data-migration-settings-mockup.svg`](./assets/data-migration-settings-mockup.svg)。

### 9.1 入口位置

设置侧栏新增 `数据迁移`，建议放在 `归档会话` 与 `工作树` 之间，使用 `PackageOpen`、`ArrowLeftRight` 或同等语义的 Lucide 图标。它是独立 category/tag，不放在 Agents 内，也不产生 runtime diagnostics 面板。

### 9.2 首页布局

```text
┌──────── 设置侧栏 ────────┬──────────────── 数据迁移 ─────────────────────┐
│ 通用                     │ 把你的 Kun 工作带到另一台电脑                 │
│ 模型服务                 │ 工作区、会话、设计与写作内容可通过一个包迁移 │
│ ...                      │                                              │
│ 归档会话                 │ ┌──────── 导出这台电脑 ────────┐             │
│ > 数据迁移               │ │ 选择工作区和历史，创建 .kunpack│             │
│ 工作树                   │ │ [创建迁移包]  查看可迁移数据   │             │
│ ...                      │ └──────────────────────────────┘             │
│                          │ ┌──────── 导入到这台电脑 ───────┐             │
│                          │ │ 拖入或选择一个 .kunpack        │             │
│                          │ │ [选择迁移包]                    │             │
│                          │ └──────────────────────────────┘             │
│                          │ 不会迁移：密钥、OAuth、信任授权、运行中任务   │
│                          │ 最近迁移：完成报告 / 恢复未完成操作           │
└──────────────────────────┴──────────────────────────────────────────────┘
```

### 9.3 按钮与层级

- 主按钮：`创建迁移包`、`选择迁移包`、`开始导入`，使用当前 Kun primary button 风格。
- 次按钮：`查看可迁移数据`、`更改目录`、`导出报告`、`稍后处理`。
- 危险按钮：`替换目标文件`、`回滚导入`，使用危险色并二次确认。
- 不可用按钮必须给出原因，例如“还有 2 个文件名冲突未解决”。
- 所有长任务主按钮变为阶段文本，例如“正在校验 42%”，但取消动作保持独立可见。

### 9.4 状态

- 空闲：两个入口卡片 + 安全说明。
- 检查中：骨架/进度，不允许开始第二个 mutation operation。
- 需要决策：侧栏 badge 显示冲突数，主按钮禁用并定位首个未解决项。
- staging：允许离开页面，应用顶部出现可返回的进度条。
- committing：显示“正在安全写入；现在取消将触发回滚”。
- 恢复：启动后优先显示“上次迁移未完成”，提供继续/回滚，不把它当普通错误 toast。
- 完成：显示迁移数量、跳过项、禁用项和 `打开工作区`/`查看会话`/`查看报告`。
- 失败：显示阶段、错误码、未修改/已回滚结论和下一步，不只显示堆栈。

## 10. 导出流程

### 10.1 Scope：选择范围

- 默认选择当前工作区，并展示“其他已使用工作区”。
- 每个工作区显示名称、源路径、文件数、估算大小、关联会话数、Design/Write 标记。
- 支持全选、搜索、刷新估算。
- 允许只导出历史而不导出工作区文件，但必须提示导入后路径会处于未映射状态。

### 10.2 Contents & security：内容和安全

- 预设一：`完整迁移`，尽量保留工作区，包括 Git 元数据和依赖目录。
- 预设二：`减小体积`，排除明确列出的依赖/缓存/构建目录。
- 分类开关：工作区、会话、附件、Memory、便携设置、工作流/定时定义。
- 显示硬排除卡片：密钥、登录、信任、进程、日志、模型/二进制。
- 如果发现敏感名称文件，必须展开清单并确认；不承诺内容扫描无漏报。
- 密码保护：输入/确认、强度提示、无找回说明。未加密时显示常驻警告。

### 10.3 Review：确认

- 显示目标文件名、保存位置、压缩前/预计压缩后大小、可用磁盘空间。
- 目标包不能放在任一所选工作区或 staging/backup 目录中。
- 显示正在运行的会话；用户选择等待、逐个中断，或取消导出。
- 用户确认“我理解工作区文件可能包含自己的敏感内容”。

### 10.4 Create：生成

- 阶段：冻结历史快照 -> 扫描文件 -> 哈希/压缩 -> 加密 -> 最终校验。
- 显示当前工作区/文件（可只显示相对路径或别名）、items/bytes 两种进度。
- 取消后删除临时包；已存在目标文件绝不留半成品，最终使用原子 rename。
- 完成页显示包位置、校验结果、排除/不稳定文件和导出报告。

## 11. 导入流程

### 11.1 Select：选择包

- 支持文件选择和拖拽一个 `.kunpack`。
- 加密包先要求密码；错误密码不产生 staging 数据。
- 不允许把普通 zip 当迁移包猜测导入。

### 11.2 Inspect：只读预检

- 验证 magic、版本、加密认证、manifest/catalog、entry 声明、SHA-256、体积和路径安全。
- 展示来源系统、Kun 版本、创建时间、工作区/会话/附件数量、展开大小。
- 新版本必需字段不支持时直接阻止，并说明需要升级 Kun；旧版本通过 migrator 在 staging 升级。
- 预检期间不写 workspace、runtime、settings 或 localStorage。

### 11.3 Map workspaces：映射目录

- 每个 source workspace 显示一个目标目录选择器。
- 默认建议：`~/Kun Workspaces/<source-name>`，如果存在则追加 ` (Imported)`/序号。
- 用户可选择新目录或显式合并已有目录。
- 立刻显示目标文件系统问题：非法名、大小写/Unicode 冲突、路径过长、符号链接、空间不足。

### 11.4 Resolve：解决冲突

工作区级默认策略：

- 新目录：推荐，最安全。
- 保留两份：同名时自动选择新的根目录。
- 合并：仅新增缺失文件；相同 hash 去重；不同内容默认保留目标。
- 替换差异文件：高级选项，必须备份并二次确认。
- 跳过工作区：相关历史仍可导入为未映射/只读状态。

文件冲突支持 `保留目标`、`保存导入副本`、`用导入文件替换`、`跳过`，可按目录/规则批量应用。文件名无法表示时默认阻止；允许改名/跳过时，必须提示源代码内部引用可能失效。

会话冲突自动处理：同 ID 同内容去重；同 ID 不同内容生成新 ID，修复 lineage 与注册表。用户不需要手工改 UUID。

### 11.5 Review & Import：确认与写入

- 显示精确操作摘要、峰值磁盘需求、备份空间、ID/path map、禁用任务和需要重新登录的能力。
- `开始导入` 前确认目标路径与冲突策略。
- 阶段：staging -> runtime preflight -> commit workspaces -> commit history -> apply portable state -> rebuild indexes -> verify。
- commit 前取消只清 staging；commit 中取消会等待当前原子步骤并回滚。

### 11.6 Report：完成

- 成功摘要：工作区、会话、设计、写作文档、附件数量。
- 需处理事项：重新配置模型/API、重新登录连接、选择缺失 provider、复核禁用定时任务、修复跳过/改名文件。
- 快捷动作：`打开第一个工作区`、`查看迁移会话`、`查看报告`、`删除备份`（符合保留策略后）。
- 部分成功不能简单显示绿色“成功”；必须区分“完成，有 7 项需要处理”。

## 12. 跨平台路径与文件规则

### 12.1 基本模型

- 包内不保存可执行的绝对解压路径。
- 每个源根是 `workspaceId`；每个文件是 `/` 分隔的相对路径。
- 导入时建立 `workspaceId -> destinationRoot`，再构造目标平台路径。
- 解析源绝对路径时使用 manifest 的 source OS 规则，不能使用目标系统默认 `path` 规则。

### 12.2 允许自动重写的路径

- thread/session workspace；
- attachment 的 `localFilePath`/workspace scope；
- 已声明 path 类型的 tool/event/context 字段；
- Design/Write/Plan/SDD/fork/thread 注册表；
- settings/workflow/禁用 schedule 中的 workspace 字段。

### 12.3 不自动重写

- 聊天正文、reasoning、普通 Markdown；
- 源代码、配置文件正文；
- shell 输出、日志式 tool 文本；
- 未声明 schema 的扩展 payload；
- 所选根之外的绝对路径。

### 12.4 不可无损处理的情况

- Linux 同目录存在 `A.ts` 与 `a.ts`，目标卷大小写不敏感。
- 文件名在 Windows 为 `CON`、含 `:`、结尾空格/点或 ADS 形式。
- macOS/Windows Unicode 规范化后发生碰撞。
- 路径超过目标安全长度。
- 外部绝对 symlink、junction/reparse point、socket/FIFO/device。

这些必须在预检出现；默认阻止，用户选择目标、改名或跳过。Kun 不应宣称能自动保持所有代码引用正确。

## 13. 安全与隐私

- archive inspection 和 extraction 只在 main/worker 执行，不在 renderer。
- 防 zip-slip、绝对路径、驱动器路径、UNC、ADS、重复规范名、symlink escape、解压炸弹、超大 metadata、未声明 entry。
- 所有实际写入先进入同盘 staging；不直接解压到目标。
- imported workspace 标为未信任；不自动打开、不运行脚本/hook、不执行工作流。
- approvals、pending user input、workspace trust 全部失效。
- scheduled tasks 以 disabled 导入；IM/Connect 渠道清空认证与绑定。
- secret stores、`secret.key`、OAuth、runtime token 是 hard denylist，并用导出测试扫描包条目/字段。
- 未加密包只保证损坏检测，不保证防篡改；加密包 AEAD 也仍当不可信输入。
- 报告本地保存，不含密码、密钥或文件内容；遥测不含路径、标题、文件名、会话正文。

## 14. 事务、取消与恢复

- 每次操作有 `operationId` 和持久 journal。
- staging 与 final 位于同一文件系统，优先通过原子 rename 提交。
- 合并/替换前把目标原文件备份，journal 记录 expected hash 和动作状态。
- runtime 只做 additive import/dedupe/remap，不覆盖不同内容的已有 thread。
- settings/local registries 通过正常 store API 应用，不替换整个 Chromium profile。
- 崩溃后启动显示恢复页：`继续导入`、`回滚`、`查看详情`。
- rollback 只删除本 operation 创建且 identity/hash 相符的数据；不会按路径盲删用户后来创建的内容。
- 多磁盘无法真正单事务，因此以 journal + 幂等操作 + rollback 实现产品级原子性。

## 15. 错误分类与用户动作

| 错误码族 | 示例 | 用户动作 |
| --- | --- | --- |
| `PACKAGE_*` | 不是 Kun 包、损坏、密码错误、校验失败 | 重新选择/重新导出；目标未修改 |
| `VERSION_*` | 格式过新、缺少 migrator | 升级 Kun；目标未修改 |
| `PATH_*` | 非法名、大小写碰撞、路径逃逸、过长 | 换目录/改名/跳过；安全问题不可忽略 |
| `SPACE_*` | staging/backup 空间不足 | 清理空间或换磁盘 |
| `CONFLICT_*` | 文件/目录冲突未决 | 选择策略后继续 |
| `RUNTIME_*` | 有运行中 turn、maintenance lock 失败 | 等待/中断/重试 |
| `IO_*` | 权限、只读卷、文件变化 | 授权、换目录、重试或跳过 |
| `RECOVERY_*` | journal 不完整、rollback 需干预 | 进入恢复页并保留诊断报告 |

所有错误都必须回答三个问题：发生在哪一阶段、目标数据是否被修改/是否已回滚、用户下一步是什么。

## 16. 边界条件清单

- 空包、零工作区、只有历史、只有工作区。
- 同一工作区被不同表示重复引用（大小写、symlink、`~`、UNC）。
- 工作区嵌套；导出时避免重复，保留逻辑根映射。
- 包目标放在源工作区中；必须阻止。
- 文件导出中变化、删除、权限改变或变为 link。
- 4 GB+ 单文件、4 GB+ 总包、百万文件、小文件风暴。
- 磁盘满、只读盘、网络盘断开、U 盘拔出、休眠、应用强退。
- 目标目录已存在、相同文件、不同文件、文件/目录类型冲突。
- 目标机已有相同/不同 thread ID、fork/side parent 缺失、重复导入同一包。
- provider/model 不存在，附件缺失，未知 tool schema，老事件 malformed JSONL。
- Windows drive/UNC -> POSIX，POSIX -> Windows，大小写敏感 -> 不敏感。
- Unicode NFC/NFD、emoji、超长路径、Windows reserved names/ADS。
- symlink loop、外部 link、junction、hardlink、socket/FIFO/device、稀疏文件。
- 错误密码、截断包、篡改 manifest、重复 entry、zip bomb、zip-slip。
- 导入中取消、commit 中崩溃、rollback 中崩溃、恢复后目标又被用户修改。
- 导入 schedule/Connect/workflow 时绝不自动触发外部动作。
- 旧包导入新版 Kun、新包导入旧版 Kun、可选未知 component。

## 17. 埋点、日志与报告

允许的粗粒度遥测：

- export/import 成功、失败或回滚；
- 失败阶段与稳定 error code；
- source/destination OS family；
- 包大小/文件数/耗时 bucket；
- 是否跨系统、是否加密、是否有冲突。

禁止上传：绝对路径、目录名、文件名、thread 标题、聊天内容、文件内容、provider/account 信息、包名。完整 path/ID map 只存在本地 migration report。

## 18. 发布与验收

### 18.1 自动测试门槛

- shared schema、manifest、版本 migrator、ID/path remapper 单测。
- Windows/macOS/Linux path fixture 全排列。
- 恶意 archive corpus 与 fuzz/property tests。
- 运行中会话 snapshot、事件/附件/artifact reachability 集成测试。
- 碰撞、重复导入、merge/replace、空间不足、权限失败、取消、崩溃故障注入。
- 包中 hard-deny secret field/path 扫描。
- 大文件/大量文件流式内存上限与性能测试。
- renderer 设置入口、stepper、禁用态、恢复态、i18n、a11y 测试。

### 18.2 手工矩阵

- Windows -> Windows/macOS/Linux。
- macOS -> macOS/Windows/Linux。
- Linux -> Linux/Windows/macOS。
- 每组至少覆盖：空目标、新目录、同名目标、同 ID 会话、敏感文件、非法文件名、大附件、崩溃恢复。
- 使用 packaged app 验证真实 `userData`、native dialog、权限和路径行为。

### 18.3 发布策略

1. feature flag 下内部导出/inspect。
2. dogfood 同系统新目录导入。
3. internal/preview 渠道开放跨系统与冲突合并。
4. 安全评审和恢复故障注入通过后默认开启。
5. 即使暂停新导出，也必须保留已有包导入和未完成 operation 恢复能力。

## 19. 产品决策建议

- 入口采用独立“数据迁移”设置 tag，符合用户心智，也避免与 Agents 配置混在一起。
- 默认目标采用“新目录/保留两份”，不采用 merge 或 replace。
- 会话冲突自动 remap，不让用户处理 UUID。
- 定时任务只迁移定义且禁用；连接渠道只显示“需要重新登录”。
- Complete 与 Smaller 两个预设都显示精确差异，不用模糊的“智能迁移”。
- 密码保护属于正式公开 v1 的 P0；未加密导出保留给明确确认风险的本地场景。
- `.git` 已确定为 Complete 包含、Smaller 排除，并对 remote URL 敏感信息做提示而不静默改写。

## 20. v1 默认决策

1. 公开 v1 交付可选密码保护；用户可以在二次确认后生成未加密包，不做全局强制加密。
2. `.git` 在 Complete 预设中包含，在 Smaller 预设中排除；检测到带 userinfo 的 remote URL 时提示并要求敏感内容确认，不自动改写仓库配置。
3. 成功导入后的冲突备份默认保留 7 天，允许用户提前删除；磁盘压力清理不得删除活动或未完成恢复操作的备份。
4. 企业强制加密、禁止导出和目录限制不进入个人版 v1，但共享 contract 预留 policy gate，后续独立评审。
5. v1 支持可选导出 workflow/schedule 定义；workflow 不自动运行，schedule 一律以 disabled 导入并清空渠道绑定。
