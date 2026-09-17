# Kun 记忆基础模块

本文说明长期记忆 V2 的数据边界、混合索引、检索规则、迁移与本地验证。英文版见
[memory-foundation.en.md](./memory-foundation.en.md)。

## 核心约束

- `{dataDir}/memory/*.json` 是唯一标准数据；SQLite 只是可删除、可重建的检索投影。
- 每条记录的 `authority` 固定为 `reference`。用户、导入、工具、网页和推断内容都不能成为
  system/user instruction，也不能覆盖审批、sandbox 或工具策略。
- `confidence`、`freshness`、`importance`、相关性与作用域亲和度是独立信号；不会再通过修改
  置信度来模拟时间衰减。
- 检索先执行作用域和生命周期过滤，再执行 FTS5 与排序。未授权、已删除、已禁用、被替代、
  尚未生效或已过期的记录不能进入候选排名。
- 注入上下文有记录数和字符数双重预算，并记录被排除或截断的 ID。

## 数据布局

```text
{dataDir}/
  memory/
    mem_*.json             # 原子写入的标准 V2/兼容旧版记录
  memory-index.sqlite3     # FTS5 检索投影
  memory-index.sqlite3-wal # SQLite 运行时文件，可能不存在
  memory-index.sqlite3-shm # SQLite 运行时文件，可能不存在
```

标准 JSON 包含版本、类型、重要性、观察时间、有效期和有界来源证据。旧记录在读取时确定性地
补齐 V2 默认值，不会为了升级而批量改写原文件。索引保存检索所需字段、来源摘要和记录快照，
但不能替代标准 JSON。

## 写入、回填与降级

创建、更新、禁用、恢复、替代、删除和清除都先提交标准 JSON，再投影到 SQLite。进程在二者
之间退出时，标准数据仍然成功；下次启动的有界回填会按 ID、稳定哈希和更新时间修复索引。
损坏的标准 JSON 会被保留并计入诊断，不会因索引清理而删除。

下列情况会启用文件/n-gram 回退：SQLite 原生模块或 FTS5 不可用、数据库打开/迁移/完整性
检查失败、查询失败、投影失败或索引尚未回填完成。错误信息会脱敏。显式回滚可在启动前设置：

```powershell
$env:KUN_MEMORY_STORE_BACKEND = 'file'
npm run dev
```

移除该环境变量并重启即可恢复默认混合存储。

## 检索与上下文安全

默认排序权重如下：

| 信号 | 权重 |
| --- | ---: |
| 词法相关性 | 0.55 |
| 作用域亲和度 | 0.10 |
| 类型亲和度 | 0.10 |
| 新鲜度 | 0.10 |
| 重要性 | 0.075 |
| 置信度 | 0.075 |

拉丁词、CJK n-gram 和 FTS 查询均有硬上限，FTS 参数使用绑定值。只有有词法或类型相关性的
记录可被选中，不再无条件注入用户级记忆。实际数量取调用方 `limit` 与实时
`maxInjectedRecords` 的较小值。

模型看到的记忆位于动态上下文而非不可变 system 前缀，并包裹在
`MEMORY_REFERENCE_DATA untrusted="true" authority="reference"` 中。每条记录附带类型、
置信度、新鲜度等级和有界来源标签；内容即使写着“忽略先前指令”也只作为不可信证据。

## 诊断

`GET /v1/memory/diagnostics` 和设置页 Memory 概览提供：

- 标准记录数、损坏记录数、索引记录数和陈旧记录数；
- `ready`、`backfilling`、`degraded`、`filesystem` 或 `disabled` 状态；
- 回填进度和脱敏后的降级原因；
- 最近一次检索模式、过滤计数、独立排序特征、选中 ID、预算排除和截断 ID。

诊断只保存有界元数据和记录 ID，不保存查询文本或记忆正文。

## Feedback ledger 与排序演化

反馈账本位于独立的 `memory-feedback/` 数据根下，是追加写入、可重建投影、由
Manager 统一拥有的审计数据；它不改变 `memory/*.json` 的权威性，也不会更新记忆的
`updatedAt`、`observedAt`、`confidence`、`importance` 或 freshness。`retrieved` 只在
携带引用块的模型请求实际发出时记录，`confirmed` 必须来自用户明确操作，`corrected`
会在同一作用域
创建新版本并用 `supersedes` 保留旧事实。事件不保存查询、正文、模型输出、来源摘录、凭据
或本机路径；默认 `memory.feedback.enabled=false`，账本不可用时检索和回合继续使用原路径。

### 开启反馈采集

反馈采集是显式 opt-in。在 `{dataDir}/config.json`（数据目录默认为 `~/.kun/data`，
除非修改了 Kun 数据目录设置）中设置：

```json
{
  "capabilities": {
    "memory": {
      "enabled": true,
      "feedback": { "enabled": true }
    }
  }
}
```

前提是 Memory 已开启（设置 -> Memory，或 `capabilities.memory.enabled`）；GUI 重写托管
配置时会保留 `feedback` 子树。该标志在下一次配置热更新（例如保存 Kun 设置）或重启后
生效。即使采集关闭，显式纠正仍然可用，因为纠正是对记忆的正式变更而非采集行为。

反馈频次、确认、纠正、freshness、importance 和 confidence 目前只在匿名 fixture 上通过
离线 evaluator 观察，并分别出现在 trace 中。预注册的 P3 v1 候选在开发集通过、留出集
bootstrap 下界仍无收益，故结论为 no-go；生产仍使用 lexical/FTS5 foundation，不存在
隐藏权重或 dormant flag。任何未来生产排序提案都必须另建版本并重新通过相关性、不确定性、
安全、隐私、确定性和资源门禁。

### 账本尾部损坏的手工恢复

诊断报告 `malformed final event` 时，反馈写入保持暂停，避免在未知数据之后追加新的审计
事件。恢复步骤：停止 Kun 与 Manager，完整备份 `memory-feedback/`，只删除最新活跃
`events-*.jsonl` 段中最后一行不完整的事件，并原子替换该段。不要改动内部事件、
`checkpoint.json` 或 `aggregates.json`。重启后 `ready()` 会从有效前缀重建投影；诊断恢复
`ready` 之后再继续使用反馈。如果损坏位于段内部、涉及 checkpoint 或范围不确定，不要手工
编辑，保留备份并保持反馈降级，等待维护者恢复。

### 纠正回执的恢复

每次纠正在变更正式记忆之前，都会在 `{dataDir}/memory-feedback-corrections/` 写入可恢复的
回执，被中断的纠正会在下次启动时继续完成。当旧记录永远无法再被纠正——已 purge、删除、
被取代或过期、replacement id 被占用、或存储不支持按 id 重建——回执进入终态 `abandoned`，
不再每次启动重试告警。仅处于 `disabled` 或 `not-yet-valid` 的记录对应的回执保持
`prepared`，下次启动继续重试。

不可读或哈希不匹配的回执会被原地隔离为 `*.corrupt`，单个坏文件不会阻塞其余回执的协调；
检查后可手工删除。终态回执（`feedback-recorded` 与 `abandoned`）在每次协调后裁剪到最新
64 条，手工删除这两种状态也是安全的：只丢失 operationId 重放映射，审计事件仍保留在
`memory-feedback/` 中。不要删除 `prepared` 或 `canonical-applied` 回执——它们仍持有未完成的
变更。

### 账本写满后的恢复

账本受 `{dataDir}/config.json` 中 `capabilities.memory.feedback.maxSegmentBytes`
（默认 4 MiB）与 `maxTotalBytes`（默认 32 MiB）约束。达到上限且压缩无法回收足够空间时，
写入暂停、诊断报告 `degraded`；检索与回合不受影响。恢复步骤：停止 Kun 与 Manager，完整
备份 `memory-feedback/`，然后提高限额或整体删除该目录以从空账本重新开始。删除整个目录会
丢失全部反馈历史——检索计数以及 `checkpoint.json` 保存的显式确认/纠正审计记录——但不会
影响正式记忆 `memory/*.json`。在已覆盖段被删除后不要单独删除 `checkpoint.json`，因为剩余
`events-*.jsonl` 已不再包含那部分历史。重启并确认诊断恢复 `ready` 后再依赖反馈数据。

## 从源码运行

必需项：

- Git；
- Node.js 22.19 或更高版本（建议使用项目 CI 对齐的 Node 22 LTS）；
- npm；
- 至少一个可用的模型连接/API Key。

```powershell
git clone https://github.com/KunAgent/Kun.git
Set-Location Kun
npm ci
npm run dev
```

`npm ci` 会安装根工作区与 `kun/` 依赖、构建 Kun，并尝试准备 Electron ABI 对应的
`better-sqlite3` 与 `node-pty`。正常命中预编译包时不需要 Python/C++ 编译器；只有原生模块
没有当前平台预编译包并需要本机编译时，Windows 才需要 Python 3 和 Visual Studio 2022
Build Tools 的“使用 C++ 的桌面开发”。若要运行标准 `npm run dist:win`，还要在安装器的
“单个组件”中安装 `MSVC v143 - VS 2022 C++ x64/x86 Spectre 缓解库`（选择与已安装
v143 工具集相同的最新版本，例如 v14.44-17.14）。非管理员终端打包 ASAR 还需要开启
Windows“开发者模式”，否则 electron-builder 无权为解包资源创建符号链接；也可以改用
管理员 PowerShell 执行打包。

检查 SQLite 和 FTS5：

```powershell
node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE VIRTUAL TABLE t USING fts5(v)');console.log(d.prepare('select sqlite_version() v').get());d.close()"
```

检查 Electron ABI（Windows）：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& .\node_modules\electron\dist\electron.exe -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE VIRTUAL TABLE t USING fts5(v)');console.log('electron fts5 ok');d.close()"
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

如果 `postinstall` 提示 Electron 没有可用的预编译包，应用仍可启动，但会显示文件回退。
要在源码 Electron 中验证 SQLite 全路径，请先安装上述 Python/C++ 工具链，再执行：

```powershell
$env:npm_config_runtime = 'electron'
$env:npm_config_target = node -p "require('electron/package.json').version"
$env:npm_config_disturl = 'https://electronjs.org/headers'
$env:npm_config_build_from_source = 'true'
$env:GYP_MSVS_VERSION = '2022'
npm rebuild better-sqlite3
Remove-Item Env:npm_config_runtime, Env:npm_config_target, Env:npm_config_disturl, Env:npm_config_build_from_source, Env:GYP_MSVS_VERSION
```

之后重跑上面的 Electron/FTS 检查或 `npm run dev`。正式 `electron-builder` 打包启用了
`npmRebuild`，但本机打包同样需要能取得预编译包或具备原生编译工具链。机器上同时存在
多个 Visual Studio Build Tools 版本时，在执行 `npm run dist:win` 前设置
`$env:GYP_MSVS_VERSION = '2022'`，完成后再移除该环境变量。

根目录的 `better_sqlite3.node` 同一时间只能匹配一个 ABI。Electron 43 源码应用需要 ABI
148，而当前 Node 24/Vitest 需要 ABI 137；因此 Electron 版绑定打开正常时，直接用 Node
打开数据库会报告 ABI 不匹配。需要运行 Node/Vitest 测试时先执行
`npm rebuild better-sqlite3` 切回 Node 绑定，测试结束后再重复上面的 Electron 重编译步骤，
然后启动应用。只执行 TypeScript 构建不受这个切换影响。

## 自动验证

开发中先跑最小覆盖，再跑仓库门禁：

```powershell
npm --prefix kun run test -- src/memory/memory-contracts.test.ts src/adapters/hybrid/hybrid-memory-store.test.ts src/memory/memory-store-contract.test.ts src/loop/memory-instructions.test.ts
npm --prefix kun run eval:memory-retrieval
npm run build:kun
npm run check:file-lines
npm run lint
npm run typecheck
npm run test
npm run build
git diff --check
```

匿名固定样例的当前可复现结果：Recall@K 从 0.500 提升到 0.833，Precision@K 从 0.139
提升到 0.333，MRR 从 0.389 提升到 0.833，作用域泄漏从 1 降到 0，选中上下文从 655
字符降到 478 字符。该小型词法评测用于回归，不代表真实用户质量；语义/向量检索应作为后续
独立变更，并先补充规模、隐私和性能证据。

## 手动验证

1. `npm run dev` 启动 Electron，在 Settings -> Memory 启用记忆。
2. 新建一条带唯一短语的 workspace 记忆，在新会话中用该短语提问。
3. 确认 Memory 概览显示 `ready`、索引覆盖一致、最近检索选中了该 ID，且排序特征可见。
4. 重启应用后重复提问，确认标准 JSON 和索引回填不丢失记录。
5. 分别验证编辑、禁用、恢复、删除、导入和导出；导入记录应显示 `imported/imported` 来源。
6. 切换到其他 workspace，确认 workspace/project 记忆不会泄漏；用户级记忆也必须先相关才注入。
7. 使用 `KUN_MEMORY_STORE_BACKEND=file` 重启，确认状态显示文件回退且 CRUD/检索仍可用。

本地默认数据目录通常是 `~/.kun/data`；Windows 对应当前用户目录下的 `.kun\data`。测试前如需
隔离真实数据，应使用单独的 `--data-dir` 或测试配置，不要直接删除日常数据目录。
