---
name: data-quality-checker
description: TAB 实验数据质量检验助手。当用户需要检测实验分流是否存在 SRM（样本比例不匹配）问题、评估指标显著性结论是否存在假阳性风险时触发。
---

## 前置依赖

本技能依赖顶层 Skill 完成鉴权和业务空间初始化。`business_code` 从顶层 `env_config.json` 读取，用户临时指定不同空间时本次使用指定值，不修改配置。

所有 MCP 调用通过 `mcporter call` 执行，不得使用 agent 自带的 MCP 连接（详见顶层 Skill「MCP 调用隔离」章节）。

## 工具说明

本技能使用以下 MCP 工具：

- `tab_credibility_check`：SRM 检验，检测实验分流可信度
- `tab_false_positive_check`：假阳性检测，评估指标显著性结论的可靠性

两个工具相互独立，可单独使用，也可组合使用做全面的数据质量评估。

## SRM 检验（tab_credibility_check）

检测实验是否存在样本比例不匹配（SRM）问题，通过 AA 检验、SRM 检验等方法判断分流是否可信。

```bash
mcporter call "tab.tab_credibility_check(business_code: 123, exp_id: 456)"
```

**参数：**
- `business_code`（必填）
- `exp_id`（必填）：实验ID（即实验组ID）
- `data_begin_time` / `data_end_time`（可选，格式 YYYYMMDD，不传则默认取实验期内最新数据）

**结果解读：**
- 各检验项均通过：分流可信，数据质量正常
- 存在不通过项：说明各组样本量比例与预期不符，实验结论可能受影响，需排查分流配置
- SRM 不通过时，建议配合 `diversion-debugger` 子技能排查具体用户的分流链路

## 假阳性检测（tab_false_positive_check）

获取实验指标数据并进行假阳性风险检测，返回各指标在实验组与对照组之间的差异数据、p 值及显著性判断。

```bash
mcporter call "tab.tab_false_positive_check(business_code: 123, exp_id: 456)"
```

指定特定指标：

```bash
mcporter call "tab.tab_false_positive_check(business_code: 123, exp_id: 456, indicator_ids: [789, 790])"
```

**参数：**
- `business_code`（必填）
- `exp_id`（必填）
- `data_begin_time` / `data_end_time`（可选，格式 YYYYMMDD，不传则默认取实验期内最新数据）
- `indicator_ids`（可选，不传则查询实验关联的所有指标）
- `template_id`（可选，指标模板ID，优先级高于 `indicator_ids`）

**结果解读：**
- 假阳性风险低：指标显著结论相对可信
- 假阳性风险高：即使 p 值显著，也可能是随机噪声导致，不宜直接下结论
- 结合 `tab_credibility_check` 结果一并看：分流可信 + 假阳性风险低 = 结论最可靠

## 推荐流程

- **实验上线前质量检查**：先 `tab_credibility_check` 检查分流 → 再 `tab_false_positive_check` 检查指标风险
- **用户只关心分流是否有问题**：单独调用 `tab_credibility_check`
- **用户只关心显著指标是否可信**：单独调用 `tab_false_positive_check`
- **SRM 不通过时**：告知用户数据存在分流偏差，建议暂缓下结论；可引导使用 `diversion-debugger` 排查

## 注意事项

- 两个工具都支持自定义时间范围，不传则自动取实验期内最新数据
- SRM 检验不通过不代表实验一定有问题，但需要进一步排查原因后再下结论
- 假阳性检测结果异常时，建议适当延长实验运行时间再观察
