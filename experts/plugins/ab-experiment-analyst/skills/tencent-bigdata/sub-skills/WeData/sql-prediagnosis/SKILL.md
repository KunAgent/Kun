---
name: sql-prediagnosis
description: "当用户提交 SQL 查询请求，特别是在执行前需要评估性能风险、排查语法错误或优化查询效率时使用。适用于数据开发、分析师及 DBA 在 SQL 提交至生产环境前的预检环节。"
---

# SQL 事前预检与优化

## 概述

本技能旨在充当SQL查询诊断专家。它能够分析 SQL 片段，结合表结构、数据规模、分区信息、业务需求及编译报错日志，识别可能导致低效运行、编译报错或逻辑与需求不符的问题。

## 核心必读

本 SKILL.md 仅提供概览、路由和 CLI 工作流。执行命令前，按需先加载以下参考文档：

```bash
do-bigdata docs show --skill sql-prediagnosis --file skill_usage_guide.md
do-bigdata docs show --skill sql-prediagnosis --file diagnosis_instructions.md
do-bigdata docs show --skill sql-prediagnosis --file format_of_API_return.md
```

- `skill_usage_guide.md`：完整的 CLI 化工作流、参数说明、输入/输出文件约定
- `diagnosis_instructions.md`：8 类问题的详细判断条件与示例
- `format_of_API_return.md`：`schema_info.json` 中 `sliced_sql_details` 的结构说明

## 核心能力

1. 语法错误纠正：基于编译日志定位并修复语法问题，包括列别名误用、GROUP BY遗漏、保留字未转义等。
2. 暴力扫描检测：基于时间跨度、分区过滤、SELECT *等维度判断是否扫描了过多数据。
3. 笛卡尔积排查：识别无关联条件的多表连接，包括逗号分隔表、CROSS JOIN、恒真条件等。
4. 隐式转换识别：检测WHERE、JOIN、UNION、CASE WHEN等子句中数据类型不匹配导致的性能损耗或语义变化。
5. 空表检测：确认查询涉及的表或分区是否为空，包括JOIN空表、空分区、空表级联传播等。
6. 基础逻辑疏漏检测：识别SQL能正常执行但产出数据静默失真的问题，如NULL值未处理、JOIN类型选择错误、去重逻辑缺失等。
7. Where条件逻辑问题检测：检查WHERE子句中的逻辑陷阱，如OR与AND优先级混淆、NOT IN遇NULL、BETWEEN语义陷阱等。
8. 业务意图不匹配：分析、检查SQL的语义是否和业务需求一致。

## 强制前置条件

- **必须确认 `cluster`**：未确认前不得进入命令执行与诊断阶段。
- **默认复用 do-bigdata 已配置的用户身份**：`prediagnosis-schema` 默认使用 `do-bigdata auth init` 已配置的 `user` 作为 `user_name`；仅在需要覆盖代理用户时才显式传 `--user-name`。
- **无需额外配置 WeData OpenAPI API_KEY**：命令会基于当前 `do-bigdata auth` 运行时凭证动态获取 metadata 所需 key。
- **必须确认业务意图**：用户必须明确说明 SQL 的业务目标、统计口径或想回答的问题。
- **`database` 可由 SQL 推断**：若 SQL 中表名未带库名前缀，需在执行 `prediagnosis-schema` 时通过 `--database` 传入默认库名。
- **CLI 是唯一的数据准备执行路径**：禁止在本技能文档中使用 `python scripts/...`、`curl`、直接 HTTP API 或其他绕过 `do-bigdata` 的调用方式。

## 工作流程

### 一、数据准备

> **[WARN] 强制阻断规则**：步骤 1–2 为**必须前置完成的信息收集环节**。在步骤 1–2 中的所有必要信息全部由用户明确提供或确认之前，**严禁**执行步骤 3 及其后续的任何操作（包括生成 JSON、调用脚本、进入诊断推理等）。若存在任何一项缺失，必须**立即停止并向用户提问**，等待用户回复后再继续。每次收到用户回复时，需重新检查步骤 1–2 的完整性，仅当全部满足后才可继续。

#### 步骤 1：确认 TDW 集群（`cluster`）— 必选
- 检查用户输入中是否明确提供了集群名称。
- TDW 用户名（`user_name`）默认取自 `do-bigdata auth init` 已配置的用户，无需重复询问；仅当需要覆盖代理用户时，才在命令中显式传入 `--user-name`。
- 数据库名（`database`）可以从 SQL 语句中推断，不需要额外询问。
- **若集群缺失**，必须向用户询问，并在得到明确回答前不得继续。

#### 步骤 2：确认用户意图 — 必选
- 检查用户输入中是否描述了该 SQL 查询对应的业务意图或目的。
- **若用户未描述查询意图**，必须向用户询问，并在得到明确回答前不得继续。

> **检查点**：在进入步骤 3 之前，请逐项核实以下清单，**全部为"是"方可继续**：
> - [ ] `cluster` 已确认？
> - [ ] `do-bigdata auth` 已配置可用用户，或已准备好显式传入 `--user-name`？
> - [ ] 用户意图已确认？
>
> 若任一项为"否"，**必须停止并向用户补充询问**，不得跳过。

#### 步骤 3：组装输入数据
将待诊断 SQL、业务需求和补充背景组织为 JSON 文件（例如 `input.json`），格式如下：
```json
{
    "sql_list": ["SELECT ...", "SELECT ..."],
    "business_requirements": ["用户意图1", "用户意图2"],
    "supplement_knowledge": ["补充背景知识1", "补充背景知识2"]
}
```
其中，若输入数据中未提供`supplement_knowledge`，则为空。

#### 步骤 4：提取 SQL 中涉及的表名
逐条分析 `input.json` 中的每条 SQL，从中提取所有涉及的实体表名（不包括子查询别名、CTE 别名等临时表），并拼装为 `--table-names` 所需的字符串。

**提取规则**：
- 表名必须采用 `dbName.tableName` 的全限定格式（例如 `teg_tdbank.ngcp_dsl_spark_app_fht0`）。
- 如果 SQL 中的表名已经包含数据库前缀（如 `FROM db.table`），直接使用。
- 如果 SQL 中的表名没有数据库前缀（如 `FROM table`），则使用步骤 1 中确认的 `database` 作为默认数据库名进行补全。
- 多条 SQL 的表名用分号 `;` 分隔，每条 SQL 内的多个表名用逗号 `,` 分隔。
- 表名顺序与 `input.json` 中的 `sql_list` 一一对应。

**示例**：
假设 `sql_list` 包含 2 条 SQL：
- SQL1 涉及表 `db1.tableA` 和 `db1.tableB`
- SQL2 涉及表 `db2.tableC`

则 `table_names` 参数值为：`"db1.tableA,db1.tableB;db2.tableC"`

#### 步骤 5：调用接口获取元信息
通过 CLI 包装命令调用编译和 WeData OpenAPI 元数据查询接口（DescribeDatabaseTables、DescribeTableDetail、DescribeAssetPartitions），获取每条 SQL 对应的表 Schema、编译结果、分区信息等元信息，并组装为结构化的 `sliced_sql_details`。`sliced_sql_details` 的格式见 `do-bigdata docs show --skill sql-prediagnosis --file format_of_API_return.md`。
```bash
do-bigdata wedata prediagnosis-schema \
  --input-path input.json \
  --output-path schema_info.json \
  --cluster <cluster> \
  --database <database> \
  --table-names "db1.tableA,db1.tableB;db2.tableC" \
  --query "<用户原始问题>"
```
其中 `--table-names` 参数的值为步骤 4 中提取的表名字符串。若需要覆盖默认的鉴权用户，可额外追加 `--user-name <user_name>`。
该脚本输出数据的格式如下：
```json
{
    "sliced_sql_details": ["SQL1的详细信息","SQL2的详细信息"],
    "supplement_knowledge": ["SQL1的补充背景知识", "SQL2的补充背景知识"]
}
```

#### 步骤 6：生成诊断提示文本
将结构化的 `schema_info.json` 进一步处理为适合 LLM 阅读的文本格式诊断提示。
```bash
do-bigdata wedata prediagnosis-hints \
  --input-path schema_info.json \
  --output-path diagnosis_hints.txt \
  --query "<用户原始问题>"
```
该脚本会逐条处理每条 SQL 的表信息（仅保留 SQL 中出现的列以控制上下文长度）、业务需求、复杂度信息、编译结果等，生成带有 `## 输入数据` 和 `## 补充背景` 段落的文本文件。

#### 步骤 7：获取当前时间
使用当前会话日期，格式为年月日（例如 `20260304`），作为时间跨度判断和未来分区判断的基准时间。

### 二、诊断推理

#### 角色定义
你是一个问题SQL查询诊断专家，善于分析SQL查询是否存在导致低效运行、编译报错或逻辑与需求不符的不良表达，并相应地给出优化或纠正建议。

#### 任务说明
读取数据准备阶段生成的 `diagnosis_hints.txt`，其中保存了若干条 SQL 及其详细信息（包括表结构、业务需求、编译结果等）。对给定的一组 SQL 查询，请充分利用已知信息**逐条**分析 SQL 是否存在效率、语法或逻辑问题，并按照要求给出理由和建议。一条 SQL 可能存在多处问题，请找出**全部的问题**。

**重要提示**：
- 当前的SQL语法方言为 **SparkSQL**。
- 当前时间以数据准备阶段获取的时间为准（格式：`YYYYMMDD`），用于计算时间跨度等判断。
- 如果输入数据中提供了**业务需求**，请**务必**参考这一信息分析SQL查询的逻辑是否正确。
- 如果输入数据中包含**补充背景**信息，请在诊断时作为额外上下文参考。

#### 诊断方向
请逐一检查 SQL 片段是否存在以下问题。请**务必**参考 `do-bigdata docs show --skill sql-prediagnosis --file diagnosis_instructions.md` 了解每个问题的判断条件和示例。
**1. 是否存在语法错误？**  
**2. 是否存在暴力扫描？**  
**3. 是否存在笛卡尔积问题？**  
**4. 是否存在隐式转换问题？**  
**5. 是否存在空表？**  
**6. 是否存在基础逻辑疏漏？**  
**7. 是否存在Where条件逻辑问题？**  
**8. 是否存在业务意图不匹配问题？**

#### 输出格式
输出结果应保持与输入 SQL 一一对应，并采用统一的结构化 JSON 形式。每条 SQL 的诊断结果至少应包含以下维度：
- `sql`
- `语法错误`
- `暴力扫描`
- `笛卡尔积`
- `隐式转换`
- `空表问题`
- `基础逻辑疏漏`
- `Where条件逻辑问题`
- `业务意图不匹配`

其中每个维度建议统一包含：
- `存在性`：`是/否`
- `理由`：明确指出命中的问题子类型、涉及的字段 / 条件 / 位置，以及为什么构成问题
- `优化建议`：给出可执行的修改建议；如涉及 SQL 改写，优先提供**完整且可直接替换**的 SQL、SQL 片段或 WHERE 子句

额外要求：
- 如果存在**语法错误**，应给出**完整的纠正后 SQL**。
- 如果存在**空表问题**，应明确指出具体表名和问题场景；若需排查，建议通过 `wedata.woa.com` 的数据地图确认表或分区是否为空。
- 如果不存在某类问题，应明确说明未命中对应子类型，避免空泛结论。
- SQL 输出顺序必须与输入顺序完全一致。

## 参考文档

```bash
do-bigdata docs list --skill sql-prediagnosis
do-bigdata docs show --skill sql-prediagnosis --file skill_usage_guide.md
do-bigdata docs show --skill sql-prediagnosis --file diagnosis_instructions.md
do-bigdata docs show --skill sql-prediagnosis --file format_of_API_return.md
```

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

<!-- BIGDATA_SKILLS_DIR_GUARD -->

## [WARN] Skills 目录环境变量设置（强制前置）

在执行任何 `do-bigdata` 命令之前，**必须**先确保 `DO_BIGDATA_SKILLS_DIR` 环境变量已正确设置。

**强制执行以下步骤**（每次会话首次调用 `do-bigdata` 前必须执行一次）：

```bash
# 步骤 1：检查环境变量是否已设置
echo $DO_BIGDATA_SKILLS_DIR
```

如果输出为空，**必须**执行以下命令设置环境变量（将路径替换为实际的 skills 根目录，即包含 `hot_reload.py` 的目录）：

```bash
# 步骤 2：设置环境变量（路径为 hot_reload.py 所在目录）
export DO_BIGDATA_SKILLS_DIR="tencent-bigdata"
```

> **判断 skills 根目录的方法**：找到 `hot_reload.py` 文件所在的目录，该目录即为 skills 根目录。
> 通常路径为 `~/ai/tencent-bigdata` 或当前工作目录下的 `tencent-bigdata/` 子目录。

**严禁在 `DO_BIGDATA_SKILLS_DIR` 未设置时执行 `do-bigdata` 命令。**

<!-- /BIGDATA_SKILLS_DIR_GUARD -->

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
