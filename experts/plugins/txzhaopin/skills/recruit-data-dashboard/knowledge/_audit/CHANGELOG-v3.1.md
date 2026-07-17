# v3.1 变更日志（2026-06-09）

> 基于用户对 decision-board.md 的决策，批量更新 .knowledge/ 内容

## 决策回顾

| 决策 | 内容 |
| --- | --- |
| D1 | 国家筛选改为动态参数（默认 `%中国%`，可切 `%亚太%` 等）|
| D2 | 岗位维度删除 `is_secret_post`、`recruit_post_org_id_cb` |
| D3 | 组织维度新增 `recruit_post_org_full_name` |
| D4 | "有简历评估面试数" 的组织维度新增 `recruit_post_org_full_path` |
| D5 | "流程中"默认指 `recruit-flow-total-count`（含简历评估）|
| 改名 | 3 项指标加"社招"前缀 |

## 变更明细

| # | 动作 | 文件 | 描述 |
| --- | --- | --- | --- |
| 1 | D1_国家移出强制过滤 | `.knowledge/metrics/atomic/recruit-social/entry-count.md` | 国家筛选改为动态参数 |
| 2 | D1_国家移出强制过滤 | `.knowledge/metrics/atomic/recruit-social/interview-count.md` | 国家筛选改为动态参数 |
| 3 | D1_国家移出强制过滤 | `.knowledge/metrics/atomic/recruit-social/salary-negotiation-count.md` | 国家筛选改为动态参数 |
| 4 | D1_国家移出强制过滤 | `.knowledge/metrics/atomic/recruit-social/giveup-count.md` | 国家筛选改为动态参数 |
| 5 | D1_国家移出强制过滤 | `.knowledge/metrics/atomic/recruit-social/offer-count.md` | 国家筛选改为动态参数 |
| 6 | D1_国家移出强制过滤 | `.knowledge/metrics/atomic/recruit-social/resume-assess-count.md` | 国家筛选改为动态参数 |
| 7 | D1_国家移出强制过滤 | `.knowledge/metrics/atomic/_README.md` | 国家筛选改为动态参数 |
| 8 | D1_国家移出强制过滤 | `.knowledge/metrics/derived/recruit-social/snapshot-stages.md` | 国家筛选改为动态参数 |
| 9 | D1_国家移出强制过滤 | `.knowledge/metrics/derived/recruit-social/finished-demand.md` | 国家筛选改为动态参数 |
| 10 | D1_国家移出强制过滤 | `.knowledge/metrics/composite/recruit-social/avg-recruit-days.md` | 国家筛选改为动态参数 |
| 11 | D2_岗位维度精简 | `.knowledge/metrics/dimensions/recruit-social/dimensions.md` | 删除 is_secret_post、recruit_post_org_id_cb |
| 12 | D3_组织维度补充 | `.knowledge/metrics/dimensions/recruit-social/dimensions.md` | 新增 recruit_post_org_full_name 推荐写法 |
| 13 | D1_filter-parameters 增加国家示例 | `.knowledge/metrics/dimensions/recruit-social/filter-parameters.md` | 4 种国家筛选用法 |
| 14 | D5_流程中消歧规则 | `.knowledge/metrics/metric-index.md` | 默认指 recruit-flow-total-count |
| 15 | 指标改名 | `.knowledge/metrics/README.md` | 3 项加"社招"前缀 |
| 16 | 指标改名 | `.knowledge/metrics/metric-index.md` | 3 项加"社招"前缀 |
| 17 | 指标改名 | `.knowledge/metrics/composite/_README.md` | 3 项加"社招"前缀 |
| 18 | 指标改名 | `.knowledge/metrics/derived/recruit-social/snapshot-stages.md` | 3 项加"社招"前缀 |
| 19 | 指标改名 | `.knowledge/metrics/composite/recruit-social/avg-recruit-days.md` | 3 项加"社招"前缀 |
| 20 | 指标改名 | `.knowledge/metrics/recipes/recruit-social/card-A-demand-overview.md` | 3 项加"社招"前缀 |