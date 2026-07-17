# hr-data-service 总览

## 1. 服务定位

`HRIT/hr-ai-data/hr_data_service` 是腾讯 HR 数据中台对外提供的 MCP 服务，承担：

- **数仓 SQL 查询**（StarRocks，腾讯 HR 全域宽表）
- **业务术语/指标定义查询**（286 个业务术语）
- **数据权限自查**（行权限 + 列权限）
- **HR AI 数据上下文供给**（给 AI Agent / Skill 用）

后端入口（前端用）：
```
POST https://dos-dataview-mcp.woa.com/api/query   { sql: "..." }
```

MCP 入口（Skill / Agent 用）：
```
url: https://dos-dataview.mcp.it.woa.com/mcp
protocol: streamable-http
```

## 2. 资产组成与外部依赖

本 skill 自身只维护**社招指标库**（`metrics/`）+ 数仓元数据缓存（`tables/`）+ 术语（`slangs/`）+ 规则（`rules/`）。

通用 HR 数仓能力来自外部插件 `hr-ai-data`（来源 marketplace `hrssc/codebuddy`），
本 skill **不内置其副本**，运行时按需 `use_skill` 调用：

| 外部 Skill（来自 hr-ai-data） | 用途 |
| --- | --- |
| `hr-data-sql-builder` | NL2SQL（社招指标库未覆盖的查询：校招/编制/员工/异动/绩效） |
| `data-warehouse-api-codegen` | 前端调用数仓接口代码生成 |
| `data-permission-checker` | 数据权限解读 / 脱敏排查 |

> 始终生效的三条规则已本地缓存在 `rules/`：
> `hr-data-desensitization.md` / `hr-datawarehouse-api-constraint.md` / `hr-starrocks-query-conventions.md`。

## 3. 工具列表（已通过 mcp_get_tool_description 校验）

| 工具 | 入参 | 说明 |
| --- | --- | --- |
| `get_current_user` | — | 返回当前 staffId / loginName |
| `get_current_user_data_permission` | `tableCode` | 返回当前用户对该表的 hasPermission/roles/dataScopes/dataRight |
| `starrocks_query` | `sql`, `userQuestion` | 执行 StarRocks SQL（仅 SELECT） |
| `slang_query` | `terms: string[]` | 查询术语完整定义（含 SQL 模版/口径） |
| `check_version` | `version?` | 检查插件是否需要升级 |

## 4. Resources 列表（关键）

| URI | 内容 |
| --- | --- |
| `starrocks://tables` | 全量表清单元数据（含 desc / write_sql_background / default_parameters） |
| `starrocks://tables/{table_code}` | 单表的字段数组（columns） |
| `starrocks://slangs` | 286 个业务术语名称 + 同义词 |

## 5. 数据域全景（从 90+ 张表归纳）

| 业务域 | 主要宽表/明细表 |
| --- | --- |
| **员工现状** | 员工信息宽表（T-1 / 月末快照）、子公司总表、外包人员明细 |
| **人员异动** | 人员变动信息宽表、入职/离职/调动信息宽表、合同改签表、派驻记录表 |
| **组织管理** | OD-组织机构信息、组织异动记录表、岗位与汇报链宽表、BP 关系链 |
| **编制管理** | 编制宽表（HC 定额 / 剩余 HC / 待流入待流出） |
| **绩效梯队** | OD-在职员工评估信息表、OD-大评估历史结果表、职级评估明细表 |
| **干部管理** | OD-干部能下/退出/青年干部新进 |
| **校招** | 校招个人简历/简历分配/锁定/伯乐/面试/录用/实习生考核/校招外部伯乐 |
| **社招** | 社招简历评估/面试全流程/面试环节明细、链路归因、伯乐推荐、面试官信息 |
| **学堂学习** | 课程信息/学习行为记录/讲师信息/班级信息/对外课程 |
| **合同合规** | 合同明细表、合同改签表、合同主体明细、子公司合同信息 |
| **福利&加班** | 节假日/周末加班申请/记录、休假申请大宽表、安居计划申请/还款、Q币 |
| **流程引擎** | 流程定义/实例/环节/待办/委托授权 |
| **服务监控** | hr-ai-data MCP 用户请求记录、DOS 数据接口请求记录 |
| **海外** | 合同主体明细表（含海外）、调动信息宽表（含跨境调动） |
| **党务** | 党员信息表 |
| **OPD/学发** | 导师辅导记录、试用期报表、敬满量标/开放题、用户评价/声音 |
| **字典维表** | a37065... 组织维表、工作地/员工类型/招聘类型/管理职级/专业职级/合同主体/含否 等 |

## 6. 选表速查

| 需求 | 优先表 |
| --- | --- |
| 在职人数 / 员工现状 / 人员结构 | `Report_Wide_Public_Staff_Info`（T-1 或月末快照） |
| 入职/离职/调动/晋升/异动 | `Report_Wide_Public_Staff_Change_Record` |
| 编制 / HC / 剩余 HC / 流程中 | `Report_HC_Management`（日切片） |
| 校招 / 实习生 招聘 | `Report_School_Recruit_Interview_Info` + `Report_School_Recruiti_Info_List` |
| 社招 / 活水 | `Report_Recruit_Flow_Detail` + `Report_Recruit_Resume_Assessment` |
| 汇报链 / 下属 / 管理幅度 | `Report_Wide_Public_Postion_Repoting_Link` |
| 合同到期 / 续签 | `Report_Wide_Public_Staff_Contract_Info` |
| HRBP 关系 | `Report_BP_bp_mapping` |
| 组织变更（改名/新建/撤销） | `Report_Org_Move_Record_New` |
| 派驻 | `Report_StaffStation` |
| 学习/学时 | `t_ads_dw_qlearning_lrs_behavioral_for_staff` + `dw-api-public-qlearning-pub-course-statement-df-mcp` |
