# 知识库 v3.5 修订日志（2026-06-10）

## 触发场景

用户问："国家=中国 这个固定筛选条件，skill 重新编写后有没有把这个条件加上？"

逐个 T_FLOW 卡核查后发现：**虽然 v3.3 已在 `on-going-post.md` 加了国家过滤、recipes 也都带了，但 4 张原子卡 + 1 张复合卡的"卡顶元数据区"没有显式声明 `:location_country_name` 是必带参数**。这导致 skill 复制片段 SQL 时可能漏拼。

## 问题根因

治理基线对国家有"双重声明"：

| 位置 | 内容 |
| --- | --- |
| 「固定查询条件」 | `location_country_name like '%中国%'` |
| 「动态查询条件」 | `location_country_name`：非必选，默认=中国，可更换 |

v3.1 决策的本意是把"硬编码 LIKE '%中国%'"改成"参数化但默认 '%中国%'"。**用户没说国家时，参数渲染成 '%中国%'，等同必带；用户说亚太/全球时，渲染成对应值。** 国家始终必带，绝非"可不带"。

但 v3.1 修订时只修了 `filter-parameters.md`，没把这个"必带"声明同步到所有指标卡的卡顶元数据区。

## 修订清单

### 1. 卡顶元数据区补 `:location_country_name` 强制声明（4 张原子卡 + 1 张复合卡 + 1 张派生卡）

| 文件 | 修订 |
| --- | --- |
| `derived/recruit-social/snapshot-stages.md` | 卡顶强制过滤段加入「国家必带、管理主体必带」+ 片段 SQL 使用警示包装示例 |
| `atomic/recruit-social/salary-negotiation-count.md` | 卡顶加 v3.4 强制参数声明 |
| `atomic/recruit-social/offer-count.md` | 卡顶加 v3.4 强制参数声明 |
| `atomic/recruit-social/resume-assess-count.md` | 卡顶加 v3.4 强制参数声明 + T_ASSESS 表特殊提醒（也要带国家）|
| `composite/recruit-social/funnel-rates.md` | 卡顶加 v3.4 强制参数声明 + 完整拼装示例 SQL（含 hr-intv-rate 例）|

### 2. SKILL.md 加全局铁律 + 自检 checklist

📁 `Recruit_data_dashboard/SKILL.md`

新增内容：
- 🔴 v3.4 铁律：T_FLOW / T_ASSESS 必带 `:location_country_name` 和 `:manager_unit_name_cn`
- 自检 checklist（4 条）：每次输出 SQL 前必走一遍
- 对片段卡的特殊提醒：复制聚合片段时必须自己包外层 SELECT/FROM/WHERE
- 历史踩坑回顾：TEG 在招需求数 336 → 6917 的 2000% 错误率

## 覆盖度验证

| 类别 | 数量 | 覆盖率 |
| --- | --- | --- |
| 用 T_FLOW/T_ASSESS 的指标卡 | 19 张（不含两个 README）| 100% 卡顶声明国家 ✅ |
| 完整 SQL 卡的国家过滤 | 9 个 SQL 块 | 100% 含 `location_country_name` ✅ |
| recipes 下的所有 SQL | 7 个非废弃 SQL 块 | 100% 含国家过滤 ✅ |

## 后续防御

skill 在拼装任何 T_FLOW SQL 时，按 SKILL.md § v3.4 铁律的 4 条 checklist 自检：

```
[ ] T_FLOW / T_ASSESS 表 → 必须有 location_country_name
[ ] T_FLOW / T_ASSESS 表 → 必须有 manager_unit_name_cn
[ ] T_FLOW 表 → 必须有 staff_type_id = '2' AND flow_id = 3
[ ] T_POST 表 → 必须有 is_disabled_name = '在招' AND recruit_staff_type_name = '正式'
```

任何缺失都视为 SQL 不完整，禁止输出。
