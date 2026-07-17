---
name: starrocks-be-crash-diagnose
description: >
  诊断 StarRocks 集群节点宕机/崩溃问题（同时覆盖 **BE 节点** 与存算分离架构下的 **CN 节点**）。
  即使用户没有明确提到"BE"或"CN"字样，只要涉及到 StarRocks 节点进程级崩溃、
  服务异常退出、日志里出现崩溃堆栈的场景，都应优先触发本 Skill，
  而不是只调用 starrocks-cluster-ops 看节点状态。
  触发关键词："BE 宕机", "BE 挂了", "BE 崩溃", "BE down", "BE 重启",
  "BE 异常退出", "be.out", "CN 宕机", "CN 挂了", "CN 崩溃", "CN down",
  "CN 重启", "CN 异常退出", "cn.out", "Aborted", "集群挂了", "StarRocks 崩溃", "StarRocks 宕机"
---

## 快速决策树（执行前必读）

> **本 Skill 同时覆盖 BE 与 CN 节点。Skill 名称里虽然带 "be-crash"，但 CN 节点宕机也走这套流程。**
> **AI 必须严格按下面这棵决策树执行，不要默认走 BE 分支。**

```
用户报障：StarRocks 节点宕机 / 崩溃 / 重启
        │
        ▼
[Step 1.1] 用户是否明确说了节点角色？
  ├─ 明确 "CN" / "cn.out" / "compute node" → 直接走 CN 分支，只调 computenodes + cn-log
  ├─ 明确 "BE" / "be.out" / "backend"      → 直接走 BE 分支，只调 backends + be-log
  └─ 未明确（"集群挂了" / "StarRocks 宕机"） → 进入 Step 1.2 自动探测
        │
        ▼
[Step 1.2] 调 backends → 看返回节点数
  ├─ N > 0  → 存算一体或混合架构，走 BE 分支即可（BE 与 CN 通常同因，先看 BE）
  └─ N == 0 → [WARN] **立即** 改调 computenodes，不要重试 backends、不要怀疑集群名
        │
        ▼
  computenodes 返回 N > 0 → 确认为存算分离 / 纯 CN 架构 → **只走 CN 分支**（cn-log）
  computenodes 也返回 0  → 集群名错误或不存在，停止本流程，请用户确认集群名
        │
        ▼
[Step 2] 选 LastStartTime 最近的同类节点中的任意一台拉日志
```

**反模式（绝对禁止）**：

- [FAIL] `backends` 返回 0 节点时，反复换集群名重试，或继续用 `be-log` 去拉日志
- [FAIL] 已确认是 CN 架构，还回头去用 `be-log` 试一次（be.out 与 cn.out 是不同 `@source`，必然返回 0 条）
- [FAIL] 单台节点 `cn-log`/`be-log` 返回 0 条时，挨个换 IP 重试（同集群同类节点一般同因，换 IP 没意义）
- [FAIL] 拿到 "路径未配置" 错误后还反复扩大时间窗口、去 keyword 重试（这是平台侧未接入，不是参数问题）

## 概述

StarRocks 节点宕机往往由大查询 OOM、外表扫描吃光内存、HDFS client 崩溃等原因引起，崩溃堆栈会打印在节点本地的标准错误输出文件中：

- **BE （Backend）节点** → `be.out`
- **CN （Compute Node）节点**（存算分离架构）→ `cn.out`

这两个文件都通过智研平台统一采集，本 Skill 封装了"**反推崩溃时间 → 拉取节点日志 → 解析堆栈 → 反查 SQL**"的完整诊断链路，同时适配 BE 与 CN 两种节点。

**核心能力**：

1. **节点启动时间反推崩溃时间** — 利用 `do-bigdata olap backends` / `do-bigdata olap computenodes` 中的 `LastStartTime` 字段识别最近被重启过的 BE / CN，并推断其崩溃时刻
2. **定向拉取崩溃日志** — BE 走 `be-log`、CN 走 `cn-log`，按集群 + host + 时间窗口精确查询崩溃堆栈
3. **堆栈解析与 query_id 抽取** — `extract-crash` 在本地识别崩溃段、提取关联的 `query_id`（BE / CN 堆栈格式一致，同一个工具通用）
4. **反查触发 SQL** — 通过 `starrocks-query-info` Skill 的 `audit-sql` 命令，把 `query_id` 映射回具体 SQL，让用户看到"是哪条查询打挂了节点"

## 前置条件

- 已执行 `do-bigdata auth init` 配置 CMK 凭证（由 CLI 的 `@auth_required` 装饰器自动读取）
- 崩溃时间距今不超过 **7 天**（超出后智研 ES 日志可能已被清理）
- 需要知道发生宕机的 StarRocks 集群名；具体节点 IP 可由 `do-bigdata olap backends` / `do-bigdata olap computenodes` 自动定位

## 限流规则

> **[WARN] 强制规则**：在执行命令过程中，如果命令调用**累计失败超过 3 次**（命令返回错误、API 返回 `success: false`），必须**立即停止所有后续命令调用**，向用户输出已收集到的信息和失败原因摘要，终止本次回答。失败次数跨子命令、跨 Skill 累计计算。

> **[WARN] 同类节点不重复拉日志**：同集群下多个 BE（或多个 CN）节点的 `LastStartTime` 在几分钟内相邻时，几乎可以断定是**同因连锁崩溃**。此时**只对其中一台节点**调用一次 `be-log`/`cn-log` 即可，**不要**对每台节点都拉一次（堆栈完全相同，会浪费配额、撑爆上下文）。

> **[WARN] 0 条命中的处理上限**：如果某次 `be-log`/`cn-log` 返回 0 条，最多再尝试一次以下 *单一* 调整，**不允许组合 / 不允许多次**：
>
> 1. 把时间窗口往前扩大 30 分钟
> 2. 或去掉 `--keyword` 参数拉全量
>
> 仍为 0 条 → 直接判定为 "该时段日志未被采集" 或 "节点被外部杀死无堆栈"，跳到 "无堆栈兜底" 分支（联动 `starrocks-load-analysis` 看监控指标），**严禁**继续换 IP / 反复扩窗。

> **[WARN] 平台路径未配置**：若 `cn-log` 或 `be-log` 返回错误信息中包含 "@source 路径未配置" / "SR_CN_OUT_SOURCE_PATH" / "SR_BE_OUT_SOURCE_PATH" 字样，说明该集群的日志采集**尚未在平台侧接入**——这是后端配置缺失，**不是**集群名 / IP / 时间窗口的问题。直接放弃日志路径，按下面 "无堆栈兜底" 分支处理：联动 `starrocks-load-analysis` 看崩溃前 CPU/内存指标，并提示用户联系运维补配 `SR_CN_OUT_SOURCE_PATH` / `SR_BE_OUT_SOURCE_PATH`。

## 工作流

**重要原则**：严格按照下面三步的顺序执行；**每一步完成后分析输出，再决定下一步参数**，不要把所有命令一次性排队。

### Step 1：判断宕机节点角色（BE / CN）并定位崩溃时间

**目的**：先确认宕机的是 BE 还是 CN，拿到其 host IP 以及推算出的崩溃时刻。

**为什么要区分 BE / CN？**

- 存算一体架构：集群只有 BE，崩溃堆栈在 `be.out`
- 存算分离架构：集群可能同时有 BE 和 CN，**不同节点的堆栈在不同文件**（`be.out` vs `cn.out`）——拍错了就拉不到日志

#### Step 1.1：获取节点状态

按 "快速决策树" 走，**不要** BE / CN 同时盲查，按需触发：

**情况 A：用户明确说了节点角色**

```bash
# 用户说 "CN 挂了" / "cn.out"
do-bigdata olap computenodes --cluster <集群名称> --query "<用户原始问题>"

# 用户说 "BE 挂了" / "be.out"
do-bigdata olap backends --cluster <集群名称> --query "<用户原始问题>"
```

**情况 B：用户未明确角色（"集群挂了"/"StarRocks 宕机"）**

串行执行（**不要并行**，先看第一步结果再决定第二步）：

1. **先**调 `do-bigdata olap backends --cluster <c>`
2. 看返回 `backends` 数组长度：
   - **>= 1** → 走 BE 分支（停止，不需要再调 computenodes；BE 与 CN 同因时先看 BE 就够了）
   - **== 0** → [WARN] 该集群很可能是存算分离 / 纯 CN 架构。**立即** 调 `do-bigdata olap computenodes --cluster <c>`，从此**只走 CN 分支**，**不要**再尝试 `be-log`
3. 若 `computenodes` 也返回 0 → 集群名错误或集群不存在，停止流程并请用户确认集群名

#### Step 1.2：识别被重启过的节点

从输出中关注每个节点的 **`LastStartTime`** 字段（格式 `YYYY-MM-DD HH:MM:SS`）、`Alive`、`ErrMsg`：

- 某个节点的 `LastStartTime` 很近（几分钟到几小时前）→ 该节点最近被重启过，极有可能就是宕机的那台
- 如果同类节点多台 `LastStartTime` 几乎一致（相差几分钟内），属于**同因连锁崩溃**，**任选最早重启那台**即可（堆栈基本一致）
- 选节点优先级：`LastStartTime` 最早的一台 > `Alive=false` 的一台 > 其他
- **绝对不要**对同类节点的所有机器都拉日志（60 个 CN 拉 60 次完全没必要，且会触发限流规则）

#### Step 1.3：推算时间窗口（经验值）

- `--start` = `LastStartTime` 往前 30 分钟
- `--end`   = `LastStartTime` + 2 分钟
- 崩溃堆栈和 tracker 信息通常打印在节点启动前 30 分钟内

如果用户**直接给出了崩溃时间**，跳过 Step 1.1、1.2，使用用户给的时间作为 `--end`，往前推 30 分钟作为 `--start`；但仍需明确节点角色。

### Step 2：拉取崩溃日志（根据节点角色选不同子命令）

**目的**：根据 Step 1 推算的 host + 时间窗口，精确拿到崩溃日志文本。

#### ② BE 节点 → `be-log`（拉 be.out）

```bash
do-bigdata olap be-log \
    --cluster <集群名称> \
    --host <BE IP> \
    --start "<YYYY-MM-DD HH:MM:SS>" \
    --end "<YYYY-MM-DD HH:MM:SS>" \
    --query "<用户原始问题>"
```

#### ② CN 节点 → `cn-log`（拉 cn.out）

```bash
do-bigdata olap cn-log \
    --cluster <集群名称> \
    --host <CN IP> \
    --start "<YYYY-MM-DD HH:MM:SS>" \
    --end "<YYYY-MM-DD HH:MM:SS>" \
    --query "<用户原始问题>"
```

> [WARN] **不要互换**：拉 BE 用 `be-log`，拉 CN 用 `cn-log`。两者背后的 `@source` 字段不同（一个是 be.out 路径，一个是 cn.out 路径），拍错了会返回 0 条。

可选参数（`be-log` / `cn-log` 都适用）：

- `--keyword <关键字>`：已知异常类型时加此参数过滤，如 `--keyword "Aborted"` 只拉崩溃段；不确定时先不要加，拿全量更保险
- `--size 1000`：单次返回条数，默认 1000，上限 10000；时间窗口较大时可适当增加

**参数说明**：

| 参数 | 说明 | 备注 |
|------|------|------|
| `--cluster` / `-c` | StarRocks 集群名（对应 ES 字段 `@sr_cluster`） | 必填 |
| `--host` / `-H` | 节点 IP（对应 ES 字段 `@host`） | 必填，**只支持单个节点** |
| `--start` / `-s` | 开始时间，`YYYY-MM-DD HH:MM:SS` | 必填 |
| `--end` / `-e` | 结束时间，`YYYY-MM-DD HH:MM:SS` | 必填 |
| `--keyword` / `-k` | `@message` 字段过滤关键字 | 可选 |
| `--size` | 返回条数上限 | 默认 1000，上限 10000 |

> **注意**：日志文件路径（`@source`）由服务端硬编码，`be-log` 固定 be.out、`cn-log` 固定 cn.out，调用方无需也无法指定。当前 Skill 仅支持 be.out / cn.out，不支持其他日志（be.INFO、be.WARNING 等）。

### Step 3：抽取崩溃堆栈与 query_id

**目的**：从 Step 2 返回的长日志中，精确抽出崩溃段和关联的 `query_id`。

> [OK] `extract-crash` 是**节点角色无关**的本地解析工具，BE / CN 堆栈格式一致，同一个命令同时适用于 be.out 与 cn.out。

推荐做法：把 Step 2 的输出通过管道喂给 `extract-crash`，由本地解析器帮你识别堆栈段落和 `query_id`（不建议自己拿眼看正则，容易看漏或看错）：

```bash
# BE 场景
do-bigdata olap be-log --cluster <c> --host <h> --start <s> --end <e> \
    --output json --query "<用户原始问题>" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('log',''))" \
    | do-bigdata olap extract-crash --query "<用户原始问题>"

# CN 场景
do-bigdata olap cn-log --cluster <c> --host <h> --start <s> --end <e> \
    --output json --query "<用户原始问题>" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('log',''))" \
    | do-bigdata olap extract-crash --query "<用户原始问题>"
```

或者更简单：把 Step 2 的日志文本保存成文件后直接传 `--input`：

```bash
do-bigdata olap extract-crash --input /tmp/node_out_snippet.log --query "<用户原始问题>"
```

**输出解读要点**：

- `crash_count`：识别到的崩溃段数量（通常 1，多次崩溃也可能 >1）
- 每个 `crash_section` 中的 `query_ids`：这是**最关键信息**，直接关系到 Step 4
- `all_query_ids_in_log`：整段日志中出现过的全部 `query_id`（兜底，以防崩溃段之外还有线索）

如果 `crash_count=0`，有两种可能：

1. 时间窗口没对上 → 回到 Step 1 重新推算，或扩大时间窗口
2. 节点被 OS OOM-Killer 或 supervisord 外部杀掉了 → 没有堆栈，只能根据监控指标推断（联动 `starrocks-load-analysis` Skill）

### Step 4：反查触发崩溃的 SQL（跨 Skill 联动）

**目的**：把 Step 3 拿到的 `query_id` 转换成人类可读的 SQL 语句，交给用户。

使用 `starrocks-query-info` Skill 的 `audit-sql` 命令：

```bash
do-bigdata olap audit-sql \
    --cluster <集群名称> \
    --query-id <Step 3 得到的 query_id> \
    --days 7 \
    --query "<用户原始问题>"
```

如果已知崩溃时间精确范围，可以用更快的精确模式：

```bash
do-bigdata olap audit-sql \
    --cluster <集群名称> \
    --query-id <query_id> \
    --start "<崩溃时间-1h>" \
    --end "<崩溃时间+10min>" \
    --query "<用户原始问题>"
```

**注意**：如果 Step 3 返回了多个 query_id，**只反查崩溃段内的 query_ids**，不要无差别反查 `all_query_ids_in_log` 里的全部 ID（否则会无谓消耗 audit 配额）。

### Step 5：整合输出诊断结论

将上述四步的信息整合成结构化结论返回给用户，建议模板：

```
### 节点宕机诊断摘要

- 集群     : <集群名>
- 节点角色 : BE / CN
- 节点地址 : <host>
- 崩溃时间 : 约 <LastStartTime>（由 SHOW BACKENDS / SHOW COMPUTE NODES 反推）
- 崩溃信号 : SIGABRT / SIGSEGV / ...
- 直接诱因 : <JVM OOM / HDFS client 崩溃 / 磁盘 IO 错误 / ...>
- 关联查询 :
    query_id=<xxx>
    SQL 如下：
        <SELECT ... FROM ...>
- 内存占用 : process=<xxx GB>, query_pool=<xxx GB>, connector_scan=<xxx GB>
- 建议处理 :
    1. 联系 SQL 提交人优化查询（加过滤/减小扫描范围）
    2. 检查节点 mem_limit / connector_io_tasks_per_scan_operator
    3. （如需）联动 starrocks-load-analysis 查看崩溃前 CPU/内存趋势
```

## 典型分析场景

### 场景 A：用户只说 "BE 宕机了"

1. `do-bigdata olap backends --cluster <c>` → 找到 `LastStartTime` 最近的 BE
2. `do-bigdata olap be-log --cluster <c> --host <h> --start <LST-30min> --end <LST+2min>`
3. `do-bigdata olap extract-crash --input <保存的日志>`
4. `do-bigdata olap audit-sql --cluster <c> --query-id <id>`
5. 按模板输出诊断摘要

### 场景 A'：用户只说 "CN 宕机了"

1. `do-bigdata olap computenodes --cluster <c>` → 找到 `LastStartTime` 最近的 CN
2. `do-bigdata olap cn-log --cluster <c> --host <h> --start <LST-30min> --end <LST+2min>`
3. `do-bigdata olap extract-crash --input <保存的日志>`
4. `do-bigdata olap audit-sql --cluster <c> --query-id <id>`
5. 按模板输出诊断摘要

### 场景 B：用户说 "集群挂了 / StarRocks 宕机"（未明确节点角色）

1. **同时**调用 `backends` 和 `computenodes`，看哪侧有节点 `LastStartTime` 最近（可能仅 BE、仅 CN、或两者同时重启）
2. 选中重启的那侧，用对应子命令（`be-log` 或 `cn-log`）拉日志
3. `extract-crash` 抽取 → `audit-sql` 反查 → 输出诊断摘要

### 场景 C：用户已给出具体时间和 IP

1. 先确认该 IP 是 BE 还是 CN（问用户，或调 `backends`/`computenodes` 查一下该 IP 在哪边）
2. 选对应子命令拉指定时间窗口的日志
3. `extract-crash` 抽取 query_id
4. `audit-sql` 反查 SQL
5. 输出诊断摘要

### 场景 D：拉不到堆栈（crash_count=0 / 日志返回 0 条）

1. 扩大时间窗口**仅一次**（`start` 往前再推 30 分钟，或去掉 keyword）；不要反复重试，也不要换 IP
2. 仍无堆栈 → 可能是 OS OOM-Killer 杀的，联动 `starrocks-load-analysis` 查看崩溃前 CPU/内存指标，给出 "无堆栈，根据指标推断" 的诊断结论

### 场景 E：CN 路径未配置（cn-log 报 "SR_CN_OUT_SOURCE_PATH 未配置"）

这是**平台侧采集未接入**，不是命令参数问题，**不要**重试也不要换 IP / 扩窗。直接给用户输出：

1. **结论**：该集群的 CN 日志（cn.out）尚未接入平台采集，工具链无法直接拉取堆栈
2. **替代手段**：
   - 联动 `starrocks-load-analysis`，查崩溃时刻前 30 分钟的 CPU / 内存 / 查询负载指标，推断是否为资源打满引发 OOM
   - 提示用户联系运维 / 平台侧补配 `SR_CN_OUT_SOURCE_PATH`，或登录节点手动 `cat cn.out | grep -A 50 "Aborted\|SIGSEGV\|SIGABRT"`
3. **诊断摘要照常输出**，把 "崩溃时间" 字段填成 `LastStartTime` 反推值，"直接诱因" 字段标记为 "日志未采集，待手动确认"

## Skill联动关系

- **上游依赖**：`starrocks-cluster-ops`（`backends` / `computenodes` 提供 `LastStartTime`）
- **下游联动**：`starrocks-query-info`（`audit-sql` 反查触发 SQL）
- **旁路联动**：`starrocks-load-analysis`（无堆栈时看指标趋势）
## 参考文档

```bash
do-bigdata docs list --skill starrocks-be-crash-diagnose
do-bigdata docs show --skill starrocks-be-crash-diagnose --file be_crash_diagnose_guide.md
```

- `be_crash_diagnose_guide.md` — BE 宕机根因分类、典型堆栈逐行解读、时间窗口经验值、局限性说明等深度参考，最好先阅读这篇文档。

<!-- BIGDATA_QUERY_GUARD -->

## [WARN] --query 参数（强制要求）

每次调用 `do-bigdata` 命令时，**必须**带上 `--query "<用户原始问题>"` 参数，将用户的原始自然语言问题传递给 CLI。

**正确示例**：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util --query "帮我看看 starrocks-prod 最近一小时的 CPU 使用率"
```

**错误示例**（缺少 --query）：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util
```

> `--query` 参数用于使用回传记录用户的真实问题，缺少此参数会导致回传数据中 `user_query` 字段记录为 CLI 命令而非用户原始问题。

**严禁省略 `--query` 参数。**

<!-- /BIGDATA_QUERY_GUARD -->

<!-- BIGDATA_CLI_GUARD -->

## [WARN] CLI 可用性检查（强制前置）

在执行任何 `do-bigdata` 命令之前，**必须**先检查 CLI 是否已安装：

```bash
which do-bigdata
```

### 如果 CLI 不可用，按以下步骤修复：

**第一步**：执行本地热加载脚本安装 CLI：

```bash
python3 tencent-bigdata/hot_reload.py
```

执行后再次检查 `which do-bigdata`。如果 CLI 已可用，跳到「安装后检查」。

**第二步（仅当第一步后 CLI 仍不可用时）**：本地 `hot_reload.py` 可能是远古版本，不包含 CLI 安装逻辑。需要从远程下载最新版本并重新执行：

```bash
# 从 Skills Manager 下载最新的 hot_reload.py，覆盖本地远古版本
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/hot_reload.py/download" -o tencent-bigdata/hot_reload.py

# 同时更新根 SKILL.md
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/SKILL.md/download" -o tencent-bigdata/SKILL.md

# 执行最新的热加载脚本（会自动安装 CLI + 更新所有 Skills）
python3 tencent-bigdata/hot_reload.py
```

### 安装后检查

检查 hot_reload 输出：
- 如果输出包含 `[WARN] 注意: do-bigdata 不在默认 PATH 中`，需要根据输出的 `bin_dir` 执行 `export PATH` 后再调用 `do-bigdata`
- 如果输出 `CLI 可用: <路径>`，则可直接使用 `do-bigdata` 命令

**如果 CLI 不可用，必须先按照上述步骤完成安装，严禁跳过安装步骤直接放弃调用。** 如果安装出现问题，请联系 shimerhe 处理。

<!-- /BIGDATA_CLI_GUARD -->
