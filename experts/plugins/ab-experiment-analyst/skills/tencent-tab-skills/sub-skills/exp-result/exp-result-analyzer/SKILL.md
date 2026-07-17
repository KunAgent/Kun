---
name: exp-result-analyzer
description: TAB 实验结果分析助手。当用户需要查看实验各版本的指标数据、逐日趋势、假设检验结果（p 值、相对差异、置信区间、显著性判断）时触发。
---

## 前置依赖

本技能依赖顶层 Skill 完成鉴权和业务空间初始化。`business_code` 从顶层 `env_config.json` 读取，用户临时指定不同空间时本次使用指定值，不修改配置。

所有 MCP 调用通过 `mcporter call` 执行，不得使用 agent 自带的 MCP 连接（详见顶层 Skill「MCP 调用隔离」章节）。

## 工具说明

本技能使用以下 MCP 工具：

- `tab_get_exp_indicator_data`：获取实验指标原始数据及假设检验结果

> 注：不支持 1888 业务。

## 查询实验指标数据（tab_get_exp_indicator_data）

### 基本用法

通过实验组 ID 查询所有关联指标的累计假设检验结果：

```bash
mcporter call "tab.tab_get_exp_indicator_data(exp_group_id: 456, include_hypothesis: true)"
```

通过版本 ID 列表查询（适用于只关注特定版本对比的场景）：

```bash
mcporter call "tab.tab_get_exp_indicator_data(gray_ids: [101, 102], include_hypothesis: true)"
```

### 参数说明

**必填（二选一）：**
- `exp_group_id`：实验组ID
- `gray_ids`：版本ID列表

**常用可选参数：**

| 参数 | 说明 |
|---|---|
| `business_code` | 业务code（不传则自动从实验组获取） |
| `begin_date` / `end_date` | 时间范围，格式 YYYYMMDD（不传取实验开始至最新一次计算成功日期） |
| `indicator_ids` | 指定指标ID列表（为空则返回实验关联的所有指标） |
| `template_id` | 结果模板ID，与 `indicator_ids` 互斥 |
| `sql_mode` | 3=累积（默认），4=非累积/逐日 |
| `include_hypothesis` | 是否返回假设检验结果（默认 true） |
| `force_refresh` | 1=强制重新计算，其他=优先命中缓存 |

### 两种分析模式

**累积模式（sql_mode: 3，默认）**——适合看整体结论：

```bash
mcporter call "tab.tab_get_exp_indicator_data(exp_group_id: 456, sql_mode: 3, include_hypothesis: true)"
```

返回 `accum` 字段，包含：`p_value`、`relative_diff`、`ci_high`/`ci_low`、`is_sig`、`marked`（正向显著/负向显著/不显著）、`algorithm_type`（简单差分/方差缩减 CUPED）

**非累积模式（sql_mode: 4）**——适合看逐日趋势：

```bash
mcporter call "tab.tab_get_exp_indicator_data(exp_group_id: 456, sql_mode: 4, include_hypothesis: true)"
```

返回 `spread` 字段，包含各日实验组/对照组均值列表、样本量列表、逐日相对差异列表。

## 推荐流程

- **用户想看整体指标结论**：`sql_mode: 3, include_hypothesis: true`，关注 `accum.marked`（是否显著）和 `accum.relative_diff`（提升幅度）
- **用户想看逐日趋势**：`sql_mode: 4, include_hypothesis: true`，关注 `spread.relative_diff_list`
- **用户只想看原始数据不要检验**：`include_hypothesis: false`，返回 `raw_data`（每日的 value、sample_size 等）
- **用户指定了某几个指标**：传 `indicator_ids` 列表，减少返回数据量

## 结果解读要点

- `relative_diff` 为正表示实验组优于对照组，负则相反
- `is_sig: true` 且 `marked` 为「正向显著」才是真正的正向收益
- `algorithm_type` 为「方差缩减(CUPED)」时，统计效力更高，结论更可信
- 如对显著性结论存疑，建议配合 `data-quality-checker` 子技能做假阳性检测
