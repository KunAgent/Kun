# hr-data-service 知识库（本地缓存）

> 抓取自 MCP Server `HRIT/hr-ai-data/hr_data_service`
> 抓取时间：2026-06-07

本目录是 hr-data-service 关联知识的本地副本，便于离线查阅、规则编辑和团队共享。
**生产查询仍应直接走 MCP**，本目录数据可能落后于线上版本（线上 version=9）。

## 目录结构

```
.knowledge/
├── README.md                      # 本文件，导航
├── overview.md                    # 整体架构、Skills/Rules/Commands 总览
├── tables/
│   ├── catalog.md                 # 全量表清单（90+ 张），按业务域分组
│   ├── core-tables.md             # 8 张核心宽表的字段、SQL 背景与默认参数
│   └── raw/                       # 从 MCP 下载的字段详情 JSON 原始文件
│       ├── Report_Wide_Public_Staff_Info_T-1.json          # 员工信息宽表（最新 T-1）
│       ├── Report_Wide_Public_Staff_Info_snapshot.json     # 员工信息宽表（月末快照）
│       ├── Report_Wide_Public_Staff_Change_Record.json     # 人员变动信息宽表
│       ├── Report_Wide_Public_Staff_Register_Info.json     # 入职信息宽表
│       ├── Report_Wide_Public_Staff_Dimission_Info.json    # 离职信息宽表
│       ├── Report_Wide_Public_Staff_Transfer_Info.json     # 调动信息宽表
│       ├── Report_Wide_Public_Staff_Contract_Info.json     # 合同明细表
│       ├── Report_Wide_Public_Postion_Repoting_Link.json   # 岗位与汇报链信息宽表
│       ├── Report_HC_Management.json                       # 编制宽表
│       ├── Report_OD_Org_Info.json                         # OD-组织机构信息
│       ├── Report_BP_bp_mapping.json                       # BP 关系链
│       ├── Report_StaffStation.json                        # 派驻记录表
│       └── Report_Org_Move_Record_New.json                 # 组织异动记录表
├── metrics/                                # ⭐️ 指标知识库（治理框架，2026-06-07 重构）
│   ├── README.md                           # 治理框架说明（必读）
│   ├── metric-index.md                     # 多视角索引（按类型/业务过程/数据源/卡片）
│   ├── indicators.md                       # 通用指标（在职/HC/校招漏斗等历史口径）
│   ├── atomic/                             # 🟢 原子指标（25 个招活-社招）
│   │   ├── _README.md
│   │   └── recruit-social/                 # 7 个文件，按业务节点分组
│   ├── composite/                          # 🟠 复合指标（11 个：漏斗率+总需求+平均招聘天数）
│   │   ├── _README.md
│   │   └── recruit-social/                 # 3 个文件
│   ├── derived/                            # 🟣 派生指标（8 个：含子查询+时点快照+跨表 JOIN）
│   │   ├── _README.md
│   │   └── recruit-social/                 # 3 个文件
│   ├── dimensions/                         # 📐 维度定义 + 🎚️ 运行时筛选参数
│   │   └── recruit-social/
│   │       ├── dimensions.md               # 组织/岗位/招聘经理/渠道/国家（GROUP BY 切片轴）
│   │       └── filter-parameters.md        # ⭐️ 11 个运行时筛选参数（WHERE 可绑定）
│   ├── recipes/                            # 🍳 用法样例（前端/卡片拼装 SQL）
│   │   └── recruit-social/                 # 4 张卡片完整拼装样例
│   └── recruit-social/_legacy/             # 🗄️ 历史归档（按 A/B/C/D 卡片分组旧版）
├── source/                                 # 业务方提供的原始档案
│   ├── 社招统计指标.raw.json               # 治理基线 结构化解析结果
│   └── _classification.json                # 44 个指标的治理分类结果
├── slangs/
│   ├── glossary.md                # 业务术语清单（286 个，含同义词）
│   └── definitions.md             # 关键术语的完整定义
└── rules/                         # 项目规则原文（来自插件 rules/）
    ├── hr-data-desensitization.md
    ├── hr-datawarehouse-api-constraint.md
    └── hr-starrocks-query-conventions.md
```

> 📌 **本 skill 为独立社招指标驾驶舱**：只维护社招指标库（`metrics/`）。
> 数据查询执行（NL2SQL）、权限排查、前端代码生成等通用 HR 数仓能力**不内置副本**，
> 运行时按需 `use_skill` 调用外部 skill（`hr-data-sql-builder` / `data-permission-checker` /
> `data-warehouse-api-codegen`）即可。详见各 skill 的 description。

## 关键 MCP 入口（运行时使用）

| 用途 | 类型 | URI / 名称 |
| --- | --- | --- |
| 表清单 | resource | `starrocks://tables` |
| 单表字段 | resource | `starrocks://tables/{table_code}` |
| 术语清单 | resource | `starrocks://slangs` |
| 术语查询 | tool | `slang_query(terms: string[])` |
| 执行查询 | tool | `starrocks_query(sql, userQuestion)` |
| 当前用户 | tool | `get_current_user()` |
| 数据权限 | tool | `get_current_user_data_permission(tableCode)` |

## 三大铁律（始终生效）

1. **仅 SELECT，禁止写操作** — 见 `rules/hr-starrocks-query-conventions.md`。
2. **禁止权限控制类 WHERE** — StarRocks 已基于身份做行列权限自动控权。
3. **数仓 HTTP 接口仅前端调用** — `POST https://dos-dataview-mcp.woa.com/api/query`，需 `credentials: 'include'` / `withCredentials: true`。

## 运行时按需调用的外部 Skill（本 skill 不内置副本）

> 本 skill 专注社招指标口径。以下通用 HR 数仓能力由 agent 在需要时 `use_skill` 调用外部 skill 完成，
> 不在本 skill 内维护文档副本，避免口径与维护分叉。

| 外部 Skill | 何时调用 |
| --- | --- |
| `hr-data-sql-builder` | 社招指标库**未覆盖**的查询（校招/编制/员工现状/异动/绩效…）的 NL2SQL |
| `data-permission-checker` | 查询结果出现疑似脱敏值时，排查权限范围 |
| `data-warehouse-api-codegen` | 需要把 SQL 落成前端调用数仓接口代码时 |
