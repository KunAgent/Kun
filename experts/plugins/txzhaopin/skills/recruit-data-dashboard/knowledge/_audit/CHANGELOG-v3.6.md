# CHANGELOG v3.6（2026-06-11）

## 触发来源
用户复核 recipes/recruit-social/ 下 4 个文件是否符合 v3.0~v3.5 全部规则。

## 发现的真问题

### 🔴 真问题 1：card-A T_POST 子查询缺 recruit_staff_type_name

**位置**：`metrics/recipes/recruit-social/card-A-demand-overview.md`
- A1 单独 SQL 的 T_POST 子查询（第 48 行起）
- A3-A12 拼装 SQL 的 T_POST 子查询（第 234 行起）

**治理基线明确要求**（Row 4 社招已完成需求数入职、Row 5 社招已完成需求数 offer、Row 6 社招平均招聘天数等）：

```
【筛选条件】
1、岗位员工类型（Report_Position_Management_Recruitment_Position_Information_Daily_Slice.recruit_staff_type_name）=正式
   且（Report_Recruit_Flow_Detail.staff_type_id）= 2
2、岗位所属国家（Report_Recruit_Flow_Detail.location_country_name） like '%中国%'
```

`recruit_staff_type_name` = '正式'（T_POST 侧的岗位员工类型过滤）和 `staff_type_id` = '2'（T_FLOW 侧的员工类型过滤）是**双重过滤**，必须**两边都带**才符合 治理基线语义。

之前 card-A 的 SQL 只在 T_FLOW 侧带了 `staff_type_id = '2'`，T_POST 侧没带 `recruit_staff_type_name = '正式'`，会导致**实习岗位/外包岗位**被混入。

### 修订内容

1. ✅ A1 单独 SQL 的 T_POST 子查询加 `AND recruit_staff_type_name = '正式'`
2. ✅ A3-A12 拼装 SQL 的 T_POST 子查询加 `AND recruit_staff_type_name = '正式'`

### 业务影响

- **数值偏差**：之前 A 卡返回的"已完成入职/offer 数"可能包含**实习岗位入职**和**外包岗位入职**的人头
- **预估影响**：在腾讯当前社招数据下，实习/外包占比较小，估计偏差在 ±5% 以内（具体需要修订后跑一遍对比）
- **修订后**：纯正式岗位口径，与 治理基线完全对齐

## 长期防御：新增 R2.9 回归规则

**触发条件**：完整 SQL 卡同时使用 T_FLOW + T_POST（或 T_ASSESS + T_POST）联合查询时，T_POST 子查询必须带 `recruit_staff_type_name = '正式'`。

**位置**：`scripts/regression_check.py` Rule R2 内新增 R2.9 子规则。

**自检验证**：
- 故意删 card-A 的 `recruit_staff_type_name` 过滤 → 脚本精准定位 R2.9 报错 ✅
- 恢复后 → 6/6 规则通过、退出码 0 ✅

## 4 个 recipes 文件最终核查结果

| 文件 | 状态 |
|---|---|
| `card-A-demand-overview.md` | ✅ v3.6 修订到位（+ recruit_staff_type_name） |
| `card-B-funnel-counts.md` | ✅ 全部规则通过（仅用 T_FLOW / T_ASSESS） |
| `card-C-funnel-rates.md` | ✅ 全部规则通过 |
| `card-D-helper.md` | ✅ 全部规则通过 |

## 累计版本历史

| 版本 | 关键修订 |
|---|---|
| v3.0 | 聚合方式（DISTINCT）+ 字段勘误（is_xxx='是'） |
| v3.1 | 国家从固定改为动态参数 + 维度调整 |
| v3.2 | 时点边界翻转 + 渠道收到评估数口径 |
| v3.3 | TEG 在招需求数 6917→336 重大 bug 修复 |
| v3.4 | 5 张缺卡补齐 + 42 同义词补全 + offer 中卡完整化 |
| v3.5 | 4 张原子卡 + 1 张复合卡的卡顶国家/管理主体声明 + SKILL.md 全局铁律 |
| **v3.6** | **card-A T_POST 子查询补 recruit_staff_type_name + 新增 R2.9 回归规则** |
