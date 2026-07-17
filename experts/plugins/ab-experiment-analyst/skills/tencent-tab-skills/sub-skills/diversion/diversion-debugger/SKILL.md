---
name: diversion-debugger
description: TAB 分流调试助手。当用户需要查询某个用户命中了哪些实验、排查用户未进入实验的原因、验证分流链路是否正常时触发。支持业务粒度（查看用户在所有层的命中情况）和实验粒度（针对特定实验的逐步诊断）两种模式。
---

## 前置依赖

本技能依赖顶层 Skill 完成鉴权和业务空间初始化。`business_code` 从顶层 `env_config.json` 读取，用户临时指定不同空间时本次使用指定值，不修改配置。

所有 MCP 调用通过 `mcporter call` 执行，不得使用 agent 自带的 MCP 连接（详见顶层 Skill「MCP 调用隔离」章节）。

## 工具说明

本技能使用以下 MCP 工具：

- `tab_diversion_debug`：用户分流调试，支持业务粒度和实验粒度两种查询模式

## 分流调试（tab_diversion_debug）

### 模式一：业务粒度查询（用户命中了哪些实验）

不传 `exp_group_id`（或传 0），返回用户在该业务所有层上的命中信息：

```bash
mcporter call "tab.tab_diversion_debug(app_id: 123, guid: uid_12345)"
```

过滤特定场景或层：

```bash
mcporter call "tab.tab_diversion_debug(app_id: 123, guid: uid_12345, scene_codes: [1, 2], module_codes: [layer_001])"
```

**返回 `total_response` 列表**，每条记录包含：
- `module_code`：命中的层
- `exp_group_id` / `exp_group_name`：命中的实验组
- `exp_id` / `exp_key`：命中的版本ID / Key
- `params`：实验参数（key-value）
- `bucket_id` / `percentage`：命中桶号 / 流量占比
- `exp_link`：实验详情页链接（可直接跳转）

### 模式二：实验粒度查询（针对特定实验的完整分流诊断）

传入 `exp_group_id`，返回该用户在指定实验中的逐步诊断过程：

```bash
mcporter call "tab.tab_diversion_debug(app_id: 123, guid: uid_12345, exp_group_id: 456)"
```

**返回诊断链路**，每个环节都有 `status` 字段指示通过/未通过：

| 字段 | 含义 |
|---|---|
| `scene` | 场景过滤是否通过 |
| `module` | 层域命中是否通过 |
| `percentage` | 流量桶号分配是否命中 |
| `crowd_tag` | 标签条件是否满足 |
| `white_list` | 是否通过白名单命中 |
| `dmp_package` | DMP 人群包是否命中 |
| `hit_result` | 最终命中结果（含命中版本名称、是否白名单命中） |

### 带标签的分流调试（标签分流场景）

当实验设置了标签分流条件时，可传入 `profiles` 模拟用户标签：

```bash
mcporter call "tab.tab_diversion_debug(app_id: 123, guid: uid_12345, exp_group_id: 456, profiles: {vip_level: [gold], region: [shanghai]})"
```

## 推荐流程

- **排查用户未进实验**：
  1. 先用业务粒度查看用户在该业务的所有命中情况
  2. 确认目标实验的 `exp_group_id`（可通过 `exp-explorer` 子技能搜索）
  3. 再用实验粒度做精细诊断，逐步定位是哪个环节未通过（场景/层域/流量/标签/白名单）

- **验证分流是否正常**：直接用实验粒度查询，确认 `hit_result.status` 为命中且版本符合预期

- **SRM 检验不通过时的排查**：抽取几个典型用户，用实验粒度诊断，观察是否存在系统性分流异常

## 参数说明

| 参数 | 必填 | 说明 |
|---|---|---|
| `app_id` | 必填 | 业务ID（即 business_code） |
| `guid` | 必填 | 用户标识（uid/openid/qimei36 等） |
| `exp_group_id` | 可选 | 0 或不传=业务粒度；传具体ID=实验粒度诊断 |
| `scene_codes` | 可选 | 场景code列表，用于过滤特定场景 |
| `module_codes` | 可选 | 层code列表，用于过滤特定层 |
| `profiles` | 可选 | 用户标签画像，key 为标签名，value 为标签值数组 |

## 注意事项

- `app_id` 和 `guid` 均为必填，不传会报错
- `guid` 支持多种用户标识形式（uid、openid、qimei36 等），需与实验的 Hash 类型一致
- 业务粒度结果较多时，可用 `scene_codes` 或 `module_codes` 缩小范围
- 标签分流场景中，不传 `profiles` 则以空标签执行分流，可能与实际用户命中结果不同
