# 宏观一致性扫描报告（v3.5 后续）

> 扫描时间：2026-06-10 18:00

> 范围：5 大类一致性问题（时间方向 / 聚合方式 / 强制过滤 / is_xxx 值 / JOIN 策略）


## C3_T_ASSESS不应带flow_id (2 处)

- 📍 `recipes/recruit-social/card-B-funnel-counts.md` § ## B11 + B12 SQL（来源表 T_ASSESS，⚠️ **不加 flow_id 过滤**）
  - 详情：检查是否在 T_ASSESS 上加了 flow_id 过滤
- 📍 `recipes/recruit-social/card-C-funnel-rates.md` § ### 方案 2：SQL CTE 包装（一次出全部数）
  - 详情：检查是否在 T_ASSESS 上加了 flow_id 过滤

## C3_T_FLOW缺manager_unit_name_cn (1 处)

- 📍 `dimensions/recruit-social/filter-parameters.md` § ### 渲染示例（B 卡 SQL，带筛选参数）

## C3_T_POST缺recruit_staff_type_name (1 处)

- 📍 `dimensions/recruit-social/filter-parameters.md` § ### 1. `:is_disabled_name`（v3.0 起所有指标都可用）

## C4_is_disabled使用1/0而非is_disabled_name (1 处)

- 📍 `dimensions/recruit-social/filter-parameters.md` § ### 1. `:is_disabled_name`（v3.0 起所有指标都可用）
  - 详情：is_disabled = '1'