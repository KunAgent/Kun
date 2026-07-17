# 错误处理与脱敏

> SQL 执行后两类高频问题的处理规范：敏感字段被拦截、数据脱敏导致偏差。

---

## 1. 敏感字段拦截

当 `starrocks_query` 返回的错误信息包含以下任一关键词：

- `敏感数据`
- `外部模型不允许`
- `公司数据安全规范`
- `内部账号`
- `司内混元`

**立刻终止当前任务**，输出统一文案（保持业务方看到的话术一致）：

> ⚠️ **任务终止：当前查询涉及敏感字段（如入职时间、活水调动日期等），外部模型不允许查询。**
>
> **请切换到公司内部模型重试**：在对话设置中切换到混元（hunyuan）/ deepseek / GLM 等司内模型后，重新发起本次查询即可。
>
> **附：本次拼装的 SQL（已停止执行）**：
> ```sql
> <把刚才被拦截的 SQL 贴出来>
> ```

### 为什么不要绕过

- 不要改写 SQL 去回避敏感字段（如把 `hire_date` 换成不存在的字段、删除时间字段过滤）——会破坏业务口径，业务方拿到的数字虽然"不报错"但是错的
- 不要 fallback 到 `hr-data-sql-builder` 等 skill ——拦截规则在数据层，换 skill 也会被同样拦截
- 直接终止、把决定权交给用户，是最诚实的处理

---

## 2. 数据偏差提示

当 SQL 的 **WHERE 条件** 或 **GROUP BY** 涉及以下字段时，在输出末尾追加偏差提示：

| 类别 | 触发字段（任一即触发）|
| --- | --- |
| 职位 | `mapping_position_name`、`mapping_position_family_name`、`post_id`、`post_name_cn`，以及任何含 `position` / `post_name` 的字段 |
| 职级 | `mapping_position_level_name`、`form_init_manager_level_name`，以及任何 `xxx_level_*` 字段 |
| 候选人姓名 | `candidate_name_cn`、`candidate_name_en` |

### 统一提示文案

直接追加到回答末尾：

> ⚠️ **数据偏差提示**：本次查询涉及职位/职级/候选人姓名等字段，可能因活水流程或保密流程的脱敏机制，导致部分数据未被统计或显示偏差。

### 何时不触发

- `flow_main_id`（流程主键）用于 `COUNT(DISTINCT)` 去重时 **不触发**
- `candidate_id`（候选人 ID，仅在 JOIN/WHERE 过滤时）**不触发**（不是姓名）
- 没触发任一字段时**不要追加**该提示（避免噪音）

---

## 3. 常见 SQL 错误与应对

| 错误信息 | 可能原因 | 应对 |
| --- | --- | --- |
| `Column 'dos_current_user' is ambiguous` | 跨表 JOIN 没用子查询 | 改写为子查询模式（见 `sql-rules.md § 5` 跨表 JOIN） |
| `Column 'xxx' does not exist` | 字段名拼写错误 / 表选错 | 从 MCP 读 `starrocks://tables/{table_code}` 校验字段 |
| 返回 0 行（疑似不该 0）| 排查顺序：1. `is_xxx = 1` 而非 `'是'`；2. T_ASSESS 加了 `flow_id`；3. `manager_unit_name_cn` 拼写不一致；4. 权限不足 | 按顺序排查 |
| MCP 调用失败 | MCP 未连接 | 引导用户：WorkBuddy 左侧「连接器」→ 右上角「自定义连接器」→ 找到 `hr_data_service` → 点「连接」/「Trust」（完整接入引导见 SKILL.md Step 4）|
| 数值全 0 / `*` / `1970-01-01` | 权限脱敏 | 调 `get_current_user_data_permission` 确认权限范围 |

---

## 4. 脱敏特征值速查

按 `hr-data-desensitization` 规则识别：

| 字段类型 | 脱敏特征值 |
| --- | --- |
| 数值 | `0`、`-999`、`NULL` |
| 字符串 | `*`、空、`NA` |
| 日期 | `1970-01-01`、`9999-12-31` |
| 个人姓名 | 部分星号（`张*三`） |

如果某列全为脱敏值，主动调 `get_current_user_data_permission(tableCode)` 确认权限范围并向用户说明。
