# 知识库 v3.3 修订日志（2026-06-10）

## 触发场景

用户在使用 skill 查询"TEG 的社招在招需求数"时，发现指标卡 SQL 计算出 6,917 人，与业务方预期 336 人差异巨大。逐项对账 治理基线「指标取值逻辑」后，发现 v3.0~v3.2 的指标卡有 5 处与 治理基线不符的 SQL 错误。本次修订严格按 治理基线重写，并新增组织匹配/默认管理主体规则。

## 数值证据链

| 阶段 | 数值 | 错误原因 |
| --- | ---: | --- |
| 第 1 轮（指标卡 v3.2 SQL 直接执行）| 6,917 | ① `is_disabled='1'` 反向逻辑 ② T_POST LEFT JOIN T_FLOW 子查询 ③ 缺关键过滤 |
| 第 2 轮（修复 ①②③ + send_offer_time 改为 `<=`）| 499 | 把 治理基线 `>=` 误判为笔误，违背 治理基线 语义 |
| 第 3 轮（严格按 治理基线 + TEG 用中文路径 + 默认管理主体）| **336** ✅ | 完整对齐 治理基线 |

差异分解：6,917 - 336 = 6,581 主要来自 LEFT JOIN 错误导致基数从"在招岗位"扩大到"所有有发布日期的岗位"。

## 修订清单（共 9 处）

### A. 指标卡 SQL 严格按 治理基线重写

📁 `metrics/derived/recruit-social/on-going-post.md`

| # | 错误 | 修订 |
| --- | --- | --- |
| A1 | 用 `is_disabled='1'` 反向逻辑（CASE 内置 0） | 改为 `is_disabled_name = '在招'` 直接 WHERE 正向过滤 |
| A2 | T_POST LEFT JOIN T_FLOW 子查询 | 改为两个独立标量子查询求和（治理基线明确写"加法"，无 JOIN）|
| A3 | 缺 `recruit_staff_type_name = '正式'` | 补上（T_POST 侧强制过滤）|
| A4 | 缺 `staff_type_id = '2'` | 补上（T_FLOW 侧强制过滤）|
| A5 | 缺 `location_country_name LIKE '%中国%'` | 补上（T_FLOW 侧强制过滤）|
| A6 | `send_offer_time` 方向曾被误判为笔误 | 严格按 治理基线 `>= :end_date`，并在卡上写明"反直觉但有意为之" |
| A7 | `flow_end_time >= DATE_ADD(:end_date, INTERVAL 1 DAY)` | v3.2 已修订为 `>= :end_date OR NULL`（保留）|

### B. SKILL.md / disambiguation.md 新增规则

| # | 新规则 | 位置 |
| --- | --- | --- |
| B1 | 🔴 **BG 中文全路径速查表**（9 个 BG 的中英文映射）— 永远用中文，禁用英文缩写 | SKILL.md § Step 2 + disambiguation.md § v3.3 |
| B2 | 🔴 **默认管理主体 = '腾讯集团本部'**（治理基线默认值） | SKILL.md § Step 2 默认参数表 + disambiguation.md § v3.3 |
| B3 | 🔴 **永远以 治理基线为最终真相源** — 指标卡 SQL 模板与 治理基线冲突时以 治理基线 为准 | SKILL.md § Step 2 + disambiguation.md § v3.3 |
| B4 | `:end_date` 默认值文案修订：从"昨天 (T-1)"改为"昨天 + 1 天 = 今天"（精确反映 治理基线）| SKILL.md § Step 2 |

## 业务定义重述（关键，避免再混淆）

```
社招在招需求数 = 当前在招岗位的需求数 + 历史在招岗位的需求数
```

| 分量 | 含义 | 数据源 | 关键卡时方法 |
| --- | --- | --- | --- |
| **当前在招** | 当前所有「在招」岗位上还需要招的人头 | T_POST | `is_disabled_name = '在招'` AND `last_update_time <= :end_date` |
| **历史在招** | 已发出 offer 且流程未结束、未放弃的候选人 | T_FLOW | `send_offer_time >= :end_date` AND `(flow_end_time >= :end_date OR NULL)` |

**关于历史在招分量为 0 的解释**：
- 当 `:end_date = 今天`（默认值）时，"今天或之后才发的 offer"几乎为 0 → 历史在招 = 0 是正常的
- 历史在招分量**只在查询过去某时点**（如"截至 2025-12-31 的在招需求数"）时才有意义
- 此时 T_POST 是 2025-12-31 的快照，T_FLOW 用 `send_offer_time >= '2025-12-31'` 把"截至 2025-12-31 时已发 offer 但流程到 2026 才结束"的人补回来

## 工程动作

1. ✅ 重写 `.knowledge/metrics/derived/recruit-social/on-going-post.md`
2. ✅ 修订 `Recruit_data_dashboard/SKILL.md`（Step 2 默认参数表 + BG 速查表 + 三条新原则）
3. ✅ 追加 `Recruit_data_dashboard/references/disambiguation.md` v3.3 章节
4. ✅ 写 CHANGELOG-v3.3.md（本文档）
5. 🔜 同步 `.knowledge/` → `Recruit_data_dashboard/knowledge/`
6. 🔜 重新打包 `.skill` 文件（v1.1）

## 下次类似排查的快速方法

如果用户反馈某指标数值不对：
1. **第一步：直接读 治理基线**（治理基线《社招统计指标》），找到该指标行的「指标取值逻辑」+「动态查询条件」+「固定查询条件」
2. **第二步：对账指标卡 SQL** — 逐字段比对，凡是与 治理基线 不一致的地方都是嫌疑点
3. **第三步：拆分子查询、单独验证每个分量** — 按 治理基线 描述的"加法"或"过滤"分别跑 COUNT/SUM，逼近真值
4. **第四步：组织匹配上至少试两种**（中文全路径 vs 英文缩写）找差异源
5. **第五步：管理主体过滤要重视** — 默认是 `腾讯集团本部`，加不加差异通常 5%-15%

## 参考

- 治理基线：内部《社招统计指标》治理基线 Row 2「社招在招需求数」
- 实测验证查询：见对话历史 2026-06-10 14:30-14:50 时段的多次 starrocks_query
- TEG 中文全路径：`技术工程事业群`
