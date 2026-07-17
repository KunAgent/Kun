# 5 步工作流详解

> 本文件是 `SKILL.md` 的延伸细节。在执行复杂查询前阅读。

## Step 1 详解：指标命中策略

### 检索优先级（依次降级）

1. **精确名匹配**：用户问句包含倒排索引里某个 `name_zh` 完整字符串
   - 例："今年入职多少人" → 命中 `recruit-entry-cnt`（中文名"入职数"）

2. **别名/同义词匹配**：在 `aliases` 数组里
   - 例："发起面试" → 命中 `recruit-start-intv-cnt`（同义词"发起面试数"）

3. **业务节点匹配**：用户问句包含业务节点关键词
   - 例："薪资谈判通过率" → `business_node="薪资谈判"` + `type="composite"` → `recruit-hr-salary-negotiation-rate`

4. **跑检索脚本**（最稳）：
   ```bash
   python scripts/search_metric.py "今年5月集团本部社招入职多少人"
   ```
   返回带打分的候选指标列表（top-5），人工/LLM 再决策

### 命中多个指标怎么办

- **如果同属一个业务过程**（如"入职数" + "入职率"）：用户问数字 → 选 cnt；问比例 → 选 rate
- **如果属于易混淆组**（`disambiguation.md` 里列了）：按消歧规则
- **完全无法判断**：列出 top-3 给用户选

---

## Step 2 详解：参数抽取的边界情况

### 时间窗的几种表达

| 用户说 | `:begin_date` | `:end_date` |
| --- | --- | --- |
| "今年" / 未说 | 当年 1 月 1 日 | 昨天 |
| "今年5月" | `2026-05-01` | `2026-05-31` |
| "近半年" | 6 个月前同日 | 昨天 |
| "Q1" / "第一季度" | 当年 1 月 1 日 | 当年 3 月 31 日 |
| "上个月" | 上月 1 日 | 上月最后一日 |
| "2026/3/15 至 4/20" | `2026-03-15` | `2026-04-20` |
| "最近一周" | 7 天前 | 昨天 |

⚠️ **end_date 注意**：用户说"到今天"时，因为数仓 T-1 时效，实际只能给到昨天数据，要在回答里注明"数据截至 YYYY-MM-DD"。

### 组织名识别（最容易出错的环节）

用户说"运营管理部"、"CSIG"、"产品策划组"等 → 都是 `recruit_post_org_full_name` 上的模糊匹配。

**推荐策略**：
1. 直接传 `LIKE '%运营管理部%'` 给 SQL，让数仓做匹配
2. 如果返回 0 行 → 提示用户"未找到含'运营管理部'的组织，可能是名称简称/全称差异"
3. 如果有多个匹配（少见，因为 LIKE 范围广）→ 列出来让用户确认

**特殊处理**：
- 用户说"集团" / "集团本部" → 一定要带 `manager_unit_name_cn = '腾讯集团本部'`（否则会把所有授权管理主体合并）
- 用户说 BG 名（"CSIG"/"IEG"/"WXG"）→ 既可以 `manager_unit_name_cn = 'XXX事业群'`，也可以 `recruit_post_org_full_name LIKE '%CSIG%'`；前者更准

### "我"的指代

- 用户说"我的部门" / "我的下属"等 → 调 `get_current_user()` 获取用户所在组织，再传 `recruit_post_org_full_name`

---

## Step 3 详解：SQL 拼装的常见陷阱

### 陷阱 1：跨表 JOIN（T_FLOW + T_POST）

❌ 直接 JOIN：会报 `dos_current_user is ambiguous`
✅ 子查询先过滤再 JOIN（见 README 勘误 A）

### 陷阱 2：T_ASSESS 表 flow_id

❌ `WHERE flow_id = 3`（返回 0）
✅ 不带 flow_id 过滤，只按 `arrive_time` 筛时间窗（见 README 勘误 B）

### 陷阱 3：is_xxx 标志位

❌ `WHERE is_entry = 1`（恒返回 0）
✅ `WHERE is_entry = '是'`

### 陷阱 4：聚合方式

❌ `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`（人次，可能重复）
✅ `COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`（按流程主键去重）

### 陷阱 5：is_disabled vs is_disabled_name

❌ `WHERE is_disabled = '0'`
✅ `WHERE is_disabled_name = '在招'`（v3.0 起 WHERE 安全）

### 陷阱 6：管理主体

❌ `manager_unit_id = '10101'`（v3.0 已废弃）
✅ `manager_unit_name_cn = '腾讯集团本部'`

---

## Step 4 详解：执行错误的应对

| 错误信息 | 可能原因 | 应对 |
| --- | --- | --- |
| `Column 'dos_current_user' is ambiguous` | 跨表 JOIN 没用子查询 | 改写为子查询模式 |
| `Column 'xxx' does not exist` | 字段名拼写错误 / 表选错 | 从 MCP 读 `starrocks://tables/{table_code}` 校验字段 |
| 返回 0 行（疑似不该 0） | 1. `is_xxx = 1` 而非 `'是'`；2. T_ASSESS 加了 `flow_id`；3. `manager_unit_name_cn` 拼写不一致；4. 权限不足 | 按顺序排查 |
| MCP 调用失败 | MCP 未连接 | 引导用户：WorkBuddy 左侧「连接器」→ 右上角「自定义连接器」→ 找到 `hr_data_service` → 点「连接」/「Trust」（完整接入引导见 SKILL.md Step 4）|
| 数值全 0 / `*` | 权限脱敏 | 调 `get_current_user_data_permission` 确认 |

---

## Step 5 详解：脱敏与表达

### 脱敏特征值（按 `hr-data-desensitization` 规则）

| 字段类型 | 脱敏值 |
| --- | --- |
| 数值 | `0`、`-999`、`NULL` |
| 字符串 | `*`、空、`NA` |
| 日期 | `1970-01-01`、`9999-12-31` |
| 个人姓名 | 部分星号（`张*三`） |

### 业务方友好的回答模板

**A 单值**：
```
**2026 年 5 月集团本部社招入职：237 人**

口径：
- 时间窗：hire_date >= 2026-05-01 AND hire_date <= 2026-05-31
- 管理主体：腾讯集团本部
- 国家：中国
- 流程：社招（flow_id=3）

数据截至 2026-06-08（T-1）。
```

**D 总览**（套 card-A）：
```
## 运营管理部社招需求进展（YTD）

### 📊 需求与漏斗
| 指标 | 数值 |
| --- | --- |
| 在招需求数 | xx |
| 总需求数 | xx |
| 已完成需求数（入职） | xx |
| 已完成需求数（offer） | xx |
| 平均招聘天数 | xx |

### 🔄 流程进展
| 阶段 | 人数 |
| --- | --- |
| 评估中 | xx |
| 面试中 | xx |
| offer 中 | xx |
| 入职/调动中 | xx |
| 流程中总人数 | xx |

### 📉 漏斗通过率
（如有数据）

口径：
- 组织：recruit_post_org_full_name LIKE '%运营管理部%'
- 管理主体：腾讯集团本部
- 时间：2026-01-01 至 2026-06-08
```
