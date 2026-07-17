---
name: exp-explorer
description: TAB 实验查询与浏览助手。当用户需要搜索实验、查看实验列表、查询实验详情（策略参数、放量信息、操作日志、流量历史等）时触发。支持通过实验名称模糊搜索定位实验。
---

## 前置依赖

本技能依赖顶层 Skill 完成鉴权和业务空间初始化。`business_code` 从顶层 `env_config.json` 读取，用户临时指定不同空间时本次使用指定值，不修改配置。

所有 MCP 调用通过 `mcporter call` 执行，不得使用 agent 自带的 MCP 连接（详见顶层 Skill「MCP 调用隔离」章节）。对工具参数或返回值有疑问时，可通过以下命令查看完整说明：

```bash
mcporter describe "tab.<tool_name>"
```

## 工具说明

本技能使用以下 MCP 工具：

- `tab_list_exp`：搜索和筛选实验列表
- `tab_get_exp_detail`：查询单个实验的完整详情

## 搜索实验列表（tab_list_exp）

当用户提到实验名称而非直接给出 `exp_id` 时，必须先用此工具查找。

```bash
mcporter call "tab.tab_list_exp(business_code: 123, search_text: 首页推荐)"
```

**常用参数：**
- `business_code`（必填）
- `search_text`：模糊搜索实验名称/Key
- `status`：实验状态过滤（15=空跑期, 16=实验期, 17=全量, 18=下线, 19=调试期, 20=暂停期）
- `owners`：按负责人筛选
- `func_category_names`：按标签名称筛选
- `page` / `page_size`：分页（默认 1/20，最大 200）
- `func_category_show`：是否返回标签信息（默认 false）
- `params_show`：是否返回各版本参数列表（默认 false）

**匹配规则：** 唯一结果或名称完全一致则直接使用；多个结果则列表展示让用户选择；无结果则提示换关键词。

## 查看实验详情（tab_get_exp_detail）

```bash
mcporter call "tab.tab_get_exp_detail(business_code: 123, exp_group_id: 456)"
```

也可通过 Key 查询：

```bash
mcporter call "tab.tab_get_exp_detail(business_code: 123, exp_group_key: my_exp_key)"
```

**按需开启的扩展信息（默认均为 false）：**

| 参数 | 返回内容 |
|---|---|
| `enable_result: true` | 实验结论设置（指标预期规则） |
| `enable_operation_logs: true` | 操作日志（最近 20 条） |
| `enable_traffic_history: true` | 历史流量变化（按天） |
| `enable_indicator_relation: true` | 关联指标列表 |
| `enable_tapd: true` | 关联 TAPD 信息 |
| `enable_okr: true` | 关联 OKR 信息 |
| `enable_module_remain_traffic: true` | 层剩余流量 |
| `enable_remote_config: true` | 绑定的远程配置 |
| `enable_approval: true` | 审批信息 |

查询流量历史时可指定时间范围（可选）：

```bash
mcporter call "tab.tab_get_exp_detail(business_code: 123, exp_group_id: 456, enable_traffic_history: true, traffic_begin_time: 2026-01-01, traffic_end_time: 2026-01-31)"
```

## 推荐流程

- **用户给了实验名称**：先 `tab_list_exp` 搜索 → 确认实验 → 再按需调用 `tab_get_exp_detail`
- **用户给了 exp_id / exp_key**：直接 `tab_get_exp_detail`，按需开启扩展字段
- **用户只想浏览列表**：直接 `tab_list_exp`，支持多条件组合筛选

## 注意事项

- `business_code` 为必填，不传会报错
- `exp_group_id` 与 `exp_group_key` 二选一，且必须同时传 `business_code`
- 默认返回基础信息，操作日志、流量历史等扩展字段需显式开启，避免不必要的耗时
- 若用户询问实验的策略参数（如某个版本的 params），可在 `tab_list_exp` 时开启 `params_show: true`
