# SQL 拼装规则

> 本文件是 `SKILL.md` 的延伸细节。**只在真正要写/审查 SQL 时阅读**，平时不必加载到上下文。
>
> 收录三类核心规则：
> 1. WHERE 三层结构（怎么组织过滤条件）
> 2. v3.4 强制参数 + 自检 checklist（避免漏过滤）
> 3. v3.8 时点边界映射（治理口径 ↔ SQL 对照）
> 4. 通过率/转化率类指标的强约束（避免自由发散写率公式）
> 5. 写法规范汇总

---

## 1. WHERE 三层结构

业务 SQL 的 WHERE 永远按 3 层组织，让审查者一眼看出"哪些是恒定的、哪些是时间窗、哪些是用户传参"：

```sql
-- 第 1 层：业务恒定的强制过滤
WHERE staff_type_id = '2'
  AND flow_id = 3

-- 第 2 层：时间窗（必带占位符）
  AND hire_date >= :begin_date
  AND hire_date <  DATE_ADD(:end_date, INTERVAL 1 DAY)

-- 第 3 层：运行时参数（用户没传就省略整行）
  AND manager_unit_name_cn = :manager_unit_name_cn
  AND location_country_name LIKE :location_country_name
  /* if :post_id */ AND post_id = :post_id
```

**为什么要分层**：让模型在审查 SQL 时能逐层验证"业务约束有没有漏"，而不是把所有过滤揉成一堆。

---

## 2. v3.4 强制参数 + 自检 checklist

凡是 SQL 用了 `Report_Recruit_Flow_Detail` (T_FLOW) 或 `Report_Recruit_Resume_Assessment` (T_ASSESS) 表，**必须**带这两个参数：

| 参数 | 默认值 | 来源 | 写法 |
| --- | --- | --- | --- |
| `:location_country_name` | `'%中国%'` | 治理基线「固定查询条件」+「动态查询条件」双重声明 | `AND location_country_name LIKE :location_country_name` |
| `:manager_unit_name_cn` | `'腾讯集团本部'` | 治理基线「动态查询条件」默认值 | `AND manager_unit_name_cn = :manager_unit_name_cn` |

**为什么这两个参数必带**：HR 数仓里同名指标在「集团本部 / 子公司 / 全球」三种范围下数值差别很大。实测 TEG 在招需求数：不加管理主体过滤 = 342，加上 = 336，6 个岗位的差异来自子公司主体 ——这不是数据噪声，而是真实存在的口径差异，业务方拿错数会被质疑。

### SQL 输出前的自检（按顺序走一遍）

- [ ] SQL 用了 T_FLOW 或 T_ASSESS 表？→ 必须有 `location_country_name`
- [ ] SQL 用了 T_FLOW 或 T_ASSESS 表？→ 必须有 `manager_unit_name_cn`（除非用户明确说"含子公司"或"全部主体"）
- [ ] SQL 用了 T_FLOW 表？→ 必须有 `staff_type_id = '2'` AND `flow_id = 3`（活水分支额外加 `flow_id = 5`）
- [ ] SQL 用了 T_POST 表？→ 必须有 `is_disabled_name = '在招'` AND `recruit_staff_type_name = '正式'`

### 片段卡 vs 完整 SQL

很多原子卡（如 `entry-count.md`、`interview-count.md`）的"核心表达式"只是 `COUNT(DISTINCT CASE...)` 的**聚合表达式片段**，**不带 WHERE**。skill 拿到这种片段后，必须自己包一层外层 `SELECT ... FROM ... WHERE ...`，并把上述 4 条强制过滤都写到 WHERE 里。

> 历史踩坑：v3.3 之前 `on-going-post.md` 的"完整 SQL"漏了国家+管理主体过滤，导致 TEG 在招需求数从 336 错算到 6917（错误率 2000%+）。详见 `knowledge/_audit/CHANGELOG-v3.3.md`、`CHANGELOG-v3.4.md`。

---

## 3. v3.8 时点边界（治理口径 ↔ SQL 映射）

### 核心事实

治理口径里的 `:end_date` **不是用户原始日期**，而是已经 +1 天后的值：

> 治理口径原文："默认是昨天+1天，如果用户有指定日期，则替换为指定日期+1天"

例：用户问"截至 2026-06-10" → 治理口径里的 end_date 实际是 2026-06-11

### 治理口径 ↔ SQL 永久映射规则

skill 内部 `:end_date` 永远按**用户原始日期**渲染。治理口径的 `+1 天` 由 SQL 里的 `DATE_ADD(...)` 完成：

| 治理口径原文 | SQL 等价写法（`:end_date` = 用户原始日期）|
| --- | --- |
| 治理口径 `< end_date`  | SQL `< DATE_ADD(:end_date, INTERVAL 1 DAY)` |
| 治理口径 `<= end_date` | SQL `<= DATE_ADD(:end_date, INTERVAL 1 DAY)` |
| 治理口径 `>= end_date` | SQL `>= DATE_ADD(:end_date, INTERVAL 1 DAY)` |
| 治理口径 `> end_date`  | SQL `> DATE_ADD(:end_date, INTERVAL 1 DAY)` |
| 治理口径 `:begin_date` | SQL `:begin_date`（begin_date 不 +1 天，原文："默认是今年1月1日，指定则为指定日期"） |

### 反例对照

| 误读 SQL（v3.7 之前）| 治理口径原文 | 正确 SQL |
| --- | --- | --- |
| `flow_end_time > DATE_ADD(end, 1) OR NULL` | `flow_end_time >= end_date OR NULL` | `flow_end_time >= DATE_ADD(:end_date, 1) OR NULL` |
| `huoshui_resume_assess_time >= DATE_ADD(end, 1) OR NULL` | `huoshui_resume_assess_time >= end_date OR NULL` | `>= DATE_ADD(:end_date, 1) OR NULL` |

### 自检口诀

1. 看治理口径原文写的是 `<` / `<=` / `>=` / `>` 中的哪个
2. 直接套对应的 `DATE_ADD(:end_date, 1)` 写法
3. 不要"善意推测"或"试图统一" —— 治理口径故意区分 `<` 和 `<=`、`>` 和 `>=`，业务语义不同

> 历史踩坑：v3.7 之前 card-A 大量 `OR NULL` 字段错写为 `> DATE_ADD(end,1) OR NULL`（应是 `>=`），导致漏算"end_date 当天结束流程"的人。v3.8 全面修订。

---

## 4. 通过率/转化率类指标的强约束

### 触发条件

用户问句包含以下任一关键词，**不要自己拼 `count / count` 公式**：

| 关键词类 |
| --- |
| 通过率、转化率、转换率、命中率、接受率、入职率、发起率、rate、conversion、pass-rate |
| 面试通过率、HR 通过率、薪谈通过率、offer 通过率、发 offer 率 |
| 漏斗、漏斗率、漏斗转化、漏斗通过、funnel rate |
| 漏斗占比（注意区分：横向"组织占比"、"学历占比"不属于此类）|

### 处理流程

**第 1 步**：打开 `knowledge/metrics/composite/recruit-social/funnel-rates.md`，查找用户问的"率"是否在 9 个已治理通过率清单中：

| 用户问句 | 强制对应指标 ID | 治理基线 Row |
| --- | --- | --- |
| 渠道发起面试率 / 简历评估发起面试率 | `recruit-channel-start-interview-rate` | Row 26 |
| 部门内面试通过率 / 部门面试通过率 | `recruit-dept-professional-intv-rate` | Row 27 |
| 通道面委通过率 / 面委通过率 | `recruit-cf-intv-rate` | Row 28 |
| 用人决策通过率 / 决策面试通过率 | `recruit-dm-intv-rate` | Row 29 |
| HR 资格面试通过率 / HR 面试通过率 | `recruit-hr-intv-rate` | Row 30 |
| HR 薪资谈判通过率 / 薪谈通过率 | `recruit-hr-salary-negotiation-rate` | Row 31 |
| 发 offer 率 / 发送 offer 率 | `recruit-send-offer-rate` | Row 33 |
| 入职率 / offer 入职率 | `recruit-entry-rate` | Row 34 |

> 注：`recruit-offer-approval-rate`（进入 offer 审批率）已在 v3.0 废弃，遇到此问法直接告知用户该指标不再维护。

**第 2 步**：找到对应指标后，直接复制 `funnel-rates.md` 中该指标小节下的"口径表达式"或"完整 SQL"。多个率一起问就套 `knowledge/metrics/recipes/recruit-social/card-C-funnel-rates.md`，一次出全部 8 个率。

**第 3 步**：如果用户问的"率"不在上述 9 个清单中（例如"留用率"、"主动放弃率"），先反问用户：

> "您说的『XX 率』的精确口径是？分子是 \_\_\_ 数、分母是 \_\_\_ 数（含哪些扣除项）？这个指标当前不在 v3.0 已治理的 9 个通过率清单中，需要您确认口径后我才能查。"

### 为什么对率类指标格外严格

率类指标是 KPI 报表的核心，分母里少扣一个环节就会让整个数字偏离业务真实情况。比"单值差 1 天"的影响放大十倍——一个错误率公式会被业务团队多次复述，传播范围远大于单次错查。所以宁可慢一步反问，也不要凭印象拼公式。

### 常见自创公式 vs 标准做法

| 自创公式（错）| 正确做法 |
| --- | --- |
| `COUNT(发 offer) / COUNT(发起面试)`（漏掉"未提交"扣除项）| 套用 `recruit-send-offer-rate` 标准 SQL（分母含 `- 发起 offer 审批未提交`）|
| `COUNT(入职) / COUNT(参加面试)`（分子分母时间窗不同）| 套用 `recruit-entry-rate`，确认分子分母同 `:begin_date / :end_date` |
| `SUM(is_pass) / COUNT(*)`（用 SUM 不去重）| `COUNT(DISTINCT flow_main_id)` |
| `入职 / 简历`（跳过中间 7 个环节）| 跨多环节的"总转化率"不存在标准定义，必须先问用户是哪两环之间 |
| 没参数化 `flow_id` / `staff_type_id` | 严格按 `funnel-rates.md § v3.4 强制参数` |

---

## 5. 写法规范汇总（v3.0 + v3.1）

| 维度 | 错误写法 | 正确写法 | 原因 |
| --- | --- | --- | --- |
| 计数 | `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` | `COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)` | 前者会重复计数；按主键去重才是业务"人次" |
| 是否标志位 | `is_xxx = 1` | `is_xxx = '是'` | 数仓真实取值是中文，写 1 会恒返回 0 |
| 跨表 JOIN | 直接 `T_FLOW JOIN T_POST` | 子查询先过滤再 JOIN | `dos_current_user` 列在两表都存在，直接 JOIN 会 ambiguous（见 README 勘误 A） |
| T_ASSESS 表 | 加 `WHERE flow_id = 3` | 不带 `flow_id` 过滤 | T_ASSESS 表本身没有 flow_id 字段（见 README 勘误 B） |
| 国家 | 写死 `LIKE '%中国%'` | 参数化 `LIKE :location_country_name` | 用户可能要看亚太/全球（v3.1 决策） |
| 管理主体 | `manager_unit_id = '10101'` | `manager_unit_name_cn = '腾讯集团本部'` | v3.0 起统一用中文名（id 已废弃） |
| is_disabled | `is_disabled = '0'` | `is_disabled_name = '在招'` | 反向逻辑容易看错（v3.0 起 WHERE 安全） |
| BG 过滤 | `recruit_post_org_full_name LIKE '%WXG%'` | `recruit_post_org_full_name LIKE '%WXG微信事业群%'` | 必须用英文前缀+中文全路径，英文缩写或纯中文都会匹配错误组织（v3.11 新增，v3.12 加强） |

---

## 6. 永远以治理基线为最终真相源

如果指标卡 SQL 模板与治理基线「指标取值逻辑」冲突，**以治理基线为准**，并提示该指标卡需要修订。

已知历史踩坑：
- v3.0~v3.2 `on-going-post.md` 把治理基线的"加法"误写成 `LEFT JOIN` —— v3.3 已修正
- v3.0~v3.2 `on-going-post.md` 用 `is_disabled='1'` 反向逻辑 —— 治理基线是 `is_disabled_name = '在招'` 直接 WHERE，v3.3 已修正
- `send_offer_time >= end_date` 不是笔误：当 `end_date=今天` 时历史在招分量恒为 0 是正常的，只有查询过去时点（如 2025-12-31）才有非零值
