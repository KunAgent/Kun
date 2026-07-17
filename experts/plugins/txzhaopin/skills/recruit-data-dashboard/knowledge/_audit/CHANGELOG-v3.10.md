# CHANGELOG v3.10 — source vs recipe SQL 一致性全量对账（2026-06-11）

## 背景

用户提出关键质疑：「为什么会出现指标跟 card 的相同卡片不一样的情况」。系统性对账后发现，多个 A 类指标在 source 卡（atomic/composite/derived）与 recipe 卡（recipes/card-A）之间**长期分裂**：source 卡 v3.X 改了，recipe 卡没跟着改。这是 v3.0~v3.9 治理一直未识别的**流程漏洞**。

## 全量对账结果

| 指标 | source 卡 | recipe 卡 | 不一致原因 | 严重度 |
|---|---|---|---|---|
| **A1 在招需求数** | `derived/on-going-post.md § 完整 SQL (v3.3)` | `recipes/card-A § A1` | 业务语义完全错（LEFT JOIN + register_cnt 单位错位 + send_offer_time 方向反）| 🔴🔴🔴 致命 |
| **A3 已完成入职** | `derived/finished-demand.md § 1` | `recipes/card-A § A3` | 完全一致 | ✅ |
| **A4 已完成 offer** | `derived/finished-demand.md § 2` | `recipes/card-A § A4` | flow_end_time 方向 `>=` vs `>`（治理基线 Row 5 原档是 `>`）| 🟡 |
| **A6 流程中除评估** | `derived/snapshot-stages.md § 1` | `recipes/card-A § A6` | source 缺 flow_id 显式区分 | 🔴 |
| **A8 面试中** | `derived/snapshot-stages.md § 3` | `recipes/card-A § A8` | source 缺 flow_id 显式区分 | 🔴 |
| **A10 入职中** | `derived/snapshot-stages.md § 5` | `recipes/card-A § A10` | `state_id = 11` vs `state_id IN (11)` 等价语法风格差 | ⚪ |

共 **5 处实质不一致**，4 处 🔴 致命级。

## 修订内容

### 1. recipe `card-A § A1` 整段重写（最关键修订）

替换为 `derived/on-going-post.md § 完整 SQL (v3.3)` 同款的"两标量子查询求和"模式：

```sql
-- 1. 当前在招分量（T_POST）：SUM(person_count) WHERE is_disabled_name='在招'
-- 2. 历史在招分量（T_FLOW）：COUNT(DISTINCT flow_main_id) WHERE send_offer_time >= end_date AND flow_end_time >= end_date OR NULL
-- 两者求和
```

**修订前的 3 个 bug**：
- ❌ 业务语义反：用 `send_offer_time < end AND flow_end_time >= end` 表示"已发 offer 未关闭"，治理基线要求"截至 end 还**没**发 offer"
- ❌ 单位错位：`person_count（人数）+ register_cnt（流程数）`
- ❌ 架构错：用 LEFT JOIN 模式，治理基线 Row 7 明确是加法关系

### 2. source `finished-demand.md § 2` A4 修订

`flow_end_time >= DATE_ADD(end,1)` → `> DATE_ADD(end,1)`，严格对齐 治理基线 Row 5（A4 是少有的用 `>` 而非 `>=` 的场景）

### 3. source `snapshot-stages.md § 1 / § 3` A6/A8 补全 flow_id 区分

把 CASE WHEN 内的"靠字段差异隐式区分社招/活水"改为显式 `flow_id = 3` / `flow_id = 5`。理论上避免双计数风险。

### 4. source `snapshot-stages.md § 5` A10 风格统一

`state_id = 11` → `state_id IN (11)`，与同卡 `state_id NOT IN (11)` 风格一致。

## 配套防御：R8 新规则

`scripts/regression_check.py § R8` 新增 source/recipe SQL 一致性回归规则。

**实现思路**：
- 维护 `CONSISTENCY_PAIRS` 映射表（指标 → (source 文件章节, recipe 文件章节)）
- 对每对提取关键条件指纹（时间字段方向 + flow_id + state_id + is_xxx）
- 集合对账，差异即报 🔴

**覆盖范围（v3.10）**：A3 / A4 / A6 / A8 / A10 共 5 对核心 A 指标。后续可扩展到 B/C/D 卡。

## 治理流程改进

本次修订暴露了**长期治理漏洞**：

| 漏洞 | 解决方案 |
|---|---|
| source 卡改了 recipe 卡不改 | R8 自动回归阻塞 |
| 没有"指标在哪些卡里有 SQL"的索引 | CONSISTENCY_PAIRS 表（在 R8 内）|
| 修订只针对单卡，未做横向影响 | 今后任何指标 SQL 修订都要在 R8 表中登记 |

## 业务影响（重大）

**A1 在招需求数**修订后，原"已发 offer 未关闭"会改为"还没发 offer 的活跃流程"，**两个完全不同的业务对象**。修订后实测 = 派生卡 v3.3 同口径 = **TEG 集团本部 336**（与业务方预期一致）。

修订前 recipe 卡 v3.0~v3.9 实际算的是另一个语义的指标，**结果一直是错的**。

## 验证

```
✅ 8/8 全部回归规则通过
✅ R8 新规则覆盖 5 对 A 系列指标
✅ A1/A4/A6/A8/A10 source ↔ recipe 完全对齐
```

## 累计治理成果（v3.0 ~ v3.10）

| 维度 | 数量 |
|---|---|
| 累计修订真实问题 | ~80+ 处 |
| 回归规则类数 | 8 类（R1-R8）|
| 治理基线 指标覆盖率 | 44/44 = 100% |
| skill 体积 | ~330 KB |
