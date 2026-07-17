---
name: report-generator
description: TAB AI 实验分析报告生成助手。当用户需要生成完整的实验分析报告时触发，报告涵盖实验设计、流量分配、指标对比、统计显著性分析及综合结论，支持 HTE 异质性分析和下钻分析。采用异步生成模式：提交后立即返回，通过轮询获取结果，报告生成耗时约 3-10 分钟。
---

## 前置依赖

本技能依赖顶层 Skill 完成鉴权和业务空间初始化。`business_code` 从顶层 `env_config.json` 读取，用户临时指定不同空间时本次使用指定值，不修改配置。

所有 MCP 调用通过 `mcporter call` 执行，不得使用 agent 自带的 MCP 连接（详见顶层 Skill「MCP 调用隔离」章节）。

## 工具说明

本技能使用以下 MCP 工具：

- `tab_generate_report_async`：异步提交报告生成请求，立即返回 `report_id`
- `tab_get_report_status`：根据 `report_id` 轮询报告生成状态和结果

## 异步报告生成流程

报告生成采用**异步模式**，分两步完成：

1. **提交生成请求** → 获得 `report_id`
2. **轮询状态** → 等到 `status: completed` 时获取报告内容

### 第一步：提交报告生成请求（tab_generate_report_async）

```bash
mcporter call "tab.tab_generate_report_async(business_code: 123, exp_id: 456, data_begin_time: 20260301, data_end_time: 20260320)"
```

**返回示例：**
```json
{
  "code": 0,
  "message": "success",
  "report_id": 12345
}
```

#### 参数说明

**必填：**
- `business_code`：业务ID
- `exp_id`：实验ID（实验组ID）
- `data_begin_time`：数据起始时间，格式 YYYYMMDD
- `data_end_time`：数据结束时间，格式 YYYYMMDD

**可选参数：**

| 参数 | 说明 |
|---|---|
| `indicator_template_id` | 指标模板ID，指定分析哪些指标 |
| `workflow_id` | 工作流ID，不传或为0则使用业务默认工作流 |
| `enable_hte` | 是否启用 HTE 异质性分析（true/false） |
| `hte_id` | HTE 任务ID，配合 enable_hte 使用 |
| `control_gray_id` | 对照组版本ID（与 treatment_gray_ids 必须同时传或同时不传） |
| `treatment_gray_ids` | 实验组版本ID列表（与 control_gray_id 必须同时传或同时不传） |
| `dive_mode` | 下钻模式：`none`（默认）/ `auto` / `manual` |
| `dive_ids` | 下钻任务ID列表（dive_mode=manual 时使用） |
| `name` | 报告自定义名称 |

### 第二步：轮询报告状态（tab_get_report_status）

```bash
mcporter call "tab.tab_get_report_status(report_id: 12345)"
```

**返回示例（生成完成）：**
```json
{
  "code": 0,
  "message": "success",
  "status": "completed",
  "markdown": "# 实验分析报告\n...",
  "meta": "{...}"
}
```

#### 状态枚举

| status | 含义 | 下一步操作 |
|---|---|---|
| `pending` | 排队中 | 继续轮询 |
| `running` | 生成中 | 继续轮询 |
| `completed` | 已完成 | 读取 `markdown` 字段输出报告 |
| `failed` | 失败 | 读取 `error_msg` 告知用户 |
| `suspended` | 挂起（等待下钻任务） | 告知用户等待下钻完成后自动恢复 |

#### 轮询策略

- 每 **15 秒** 轮询一次
- 报告生成通常需要 **3-10 分钟**
- 轮询过程中持续告知用户当前状态

## 典型场景示例

**标准报告（最常用）：**

```bash
# 第一步：提交
mcporter call "tab.tab_generate_report_async(business_code: 123, exp_id: 456, data_begin_time: 20260301, data_end_time: 20260320)"
# 返回 report_id: 12345

# 第二步：轮询（每15秒一次，直到 completed）
mcporter call "tab.tab_get_report_status(report_id: 12345)"
```

**含 HTE 异质性分析：**

```bash
mcporter call "tab.tab_generate_report_async(business_code: 123, exp_id: 456, data_begin_time: 20260301, data_end_time: 20260320, enable_hte: true, hte_id: 789)"
```

**含手动下钻分析：**

```bash
mcporter call "tab.tab_generate_report_async(business_code: 123, exp_id: 456, data_begin_time: 20260301, data_end_time: 20260320, dive_mode: manual, dive_ids: [101, 102])"
```

**指定特定版本对比（多版本实验中只对比某两组）：**

```bash
mcporter call "tab.tab_generate_report_async(business_code: 123, exp_id: 456, data_begin_time: 20260301, data_end_time: 20260320, control_gray_id: 201, treatment_gray_ids: [202])"
```

## 推荐流程

1. **确认 exp_id**：用户提供实验名称时，先通过 `exp-explorer` 子技能搜索确认 exp_id
2. **确认时间范围**：若用户未指定时间，使用 `tab_get_exp_detail` 获取实验的 `exp_begin_time` 推算合理的时间范围
3. **告知异步模式**：提示用户报告将异步生成，预计 3-10 分钟
4. **提交生成请求**：调用 `tab_generate_report_async`
5. **轮询等待**：每 15 秒调用 `tab_get_report_status`，期间告知用户当前状态
6. **输出报告**：状态为 `completed` 后，输出 `markdown` 内容；关注 `warnings` 字段提示

## 报告内容结构

生成的报告（`markdown` 字段）通常包含：
- 实验基本信息（目的、时间、流量配置）
- 各版本指标对比表（含相对差异、显著性标注）
- 统计显著性分析
- HTE 异质性分析（若启用）
- 下钻分析结果（若启用）
- 综合结论与建议

## 注意事项

- 生成前建议先用 `data-quality-checker` 完成 SRM 检验，确保数据质量
- `data_begin_time` 和 `data_end_time` 为必填参数，格式严格为 YYYYMMDD（8位数字）
- `control_gray_id` 和 `treatment_gray_ids` 必须同时传入或同时不传，否则参数校验不通过
- `hte_id` 和 `dive_ids` 需提前在 TAB 平台创建对应任务后才能获取
- `workflow_id` 不传时自动使用业务空间默认工作流，无需手动指定
- 若报告状态为 `failed`，将 `error_msg` 展示给用户并建议检查参数后重试
