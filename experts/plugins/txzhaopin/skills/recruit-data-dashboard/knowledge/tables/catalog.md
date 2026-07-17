# HR 数仓全量表清单（catalog）

> 数据源：MCP resource `starrocks://tables`
> 抓取时间：2026-06-07，全量 90+ 张
> 表 version 统一为 9
> 字段详情：用 `starrocks://tables/{table_code}` 动态拉取（部分核心表已下载到 `tables/raw/`）

## 一、员工与组织（核心宽表）

| 表名（中文） | table_code | 说明 |
| --- | --- | --- |
| 员工信息宽表（最新T-1数据版） | `catalog_dos_data_analysis_mcp_2.hrdw.Report_Wide_Public_Staff_Info` | 每员工 1 行，T-1 切片，覆盖在职/离职、组织/岗位/职级/汇报、绩效梯队、个人/办公信息、福利/假期等 |
| 员工信息宽表（历史月末快照版） | `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Info` | 同上但按月末 `p_mm` 分区，多月度纵向对比用 |
| 子公司总表-人员基础信息表 | `catalog_dos_da_mcp.hrdw.Report_subsidiary_information` | 子公司员工最新数据 |
| 子公司岗位与汇报链信息表 | `catalog_dos_da_mcp.hrdw.Report_Subsidiary_Postion_Reporting_Information_Form` | 子公司汇报链 |
| 子公司职位职级信息表 | `catalog_dos_da_mcp.hrdw.Report_Subsidiary_PositionandGrade_Information_Form` | 子公司职位职级 |
| 外包人员信息明细表 | `catalog_dos_da_mcp.hrdw.Report_PS_Outsourced_Personnel_Information_List` | 外包员工最新状态 |
| OD-组织机构信息 | `catalog_dos_da_mcp.hrdw.Report_OD_Org_Info` | 全公司当前生效的实体组织+虚拟组织 |
| 岗位与汇报链信息宽表 | `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Postion_Repoting_Link` | 月度汇报链快照（含主岗+兼岗），最长 15 级 |
| 党员信息表 | `catalog_dos_da_mcp.hrdw.Report_Members_Info` | 在职员工党员信息 |
| 产品人力盘点 | `catalog_dos_da_mcp.hrdw.Report_Product_Manpower_Inventory` | PMI 产品视角 |
| 产品人力流转 | `catalog_dos_da_mcp.hrdw.Report_Pmi_Effort_Movement` | 产品人力流转 |

## 二、人员异动

| 表名 | table_code | 说明 |
| --- | --- | --- |
| 人员变动信息宽表 | `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Change_Record` | **核心异动表**，雇佣/调动/专业变化/管理变化/离职 |
| 入职信息宽表 | `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Register_Info` | 入职/入场快照（含待入职） |
| 离职信息宽表 | `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Dimission_Info` | 离职全场景，含流程中 |
| 调动信息宽表 | `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Transfer_Info` | 境内+跨境调动，含流程中 |
| 派驻记录表 | `catalog_dos_da_mcp.hrdw.Report_StaffStation` | 境内派驻流水（派出/派入） |
| 合同明细表 | `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Contract_Info` | 全量合同生命周期 |
| 合同改签表 | `catalog_dos_da_mcp.hrdw.Report_Wide_Public_Staff_Contract_Change_Info` | 改签前后对比 |
| 合同主体明细表 | `catalog_dos_da_mcp.hrdw.Report_Contract_unit_detail` | 海外 ER/BGER 用 |
| 子公司入职信息表 | `catalog_dos_da_mcp.hrdw.Report_Subsidiary_Onboarding_Information_Form` | — |
| 子公司离职信息表 | `catalog_dos_da_mcp.hrdw.Report_Subsidiary_Separation_Information_Form` | — |
| 子公司调动信息表 | `catalog_dos_da_mcp.hrdw.Report_Subsidiary_Staff_Change_Information_Form` | — |
| 子公司合同信息表 | `catalog_dos_da_mcp.hrdw.Report_Subsidiary_Contract_Information_Form` | — |
| 试用期报表 | `catalog_dos_da_mcp.hrdw.Report_ER_trial_period_report` | 入职+试用期考核 |
| 在职核查单据查看 | `catalog_dos_da_mcp.hrdw.Report_Viewing_On_The_Job_Verification_Documents` | — |

## 三、组织 & 编制 & BP

| 表名 | table_code | 说明 |
| --- | --- | --- |
| 编制宽表 | `catalog_dos_da_mcp.hrdw.Report_HC_Management` | **HC 必用**，日切片 `p_dt` |
| 组织异动记录表（新） | `catalog_dos_da_mcp.hrdw.Report_Org_Move_Record_New` | 组织新建/撤销/改名/挂靠/负责人变更 |
| BP 关系链报表 | `catalog_dos_da_mcp.hrdw.Report_BP_bp_mapping` | HRBP 与组织映射 |
| BP 关系链调整表 | `catalog_dos_da_mcp.hrdw.Report_BP_bp_mapping_adjustment` | BP 调整流水 |

## 四、绩效梯队 & 干部

| 表名 | table_code | 说明 |
| --- | --- | --- |
| 职级评估明细表 | `catalog_dos_da_mcp.dataset.Report_Rank_Evaluation_Details` | 职级申报/评估/评审 |
| OD-在职员工评估信息表_员工基干 | `catalog_dos_da_mcp.hrdw.Report_OD_Staff_Eval_Info_junior` | — |
| OD-大评估历史结果表-员工基干 | `catalog_dos_da_mcp.hrdw.Report_OD_Staff_Assess_Result_DF` | — |
| OD-干部能下明细表 | `catalog_dos_da_mcp.hrdw.Report_OD_Manager_Demotion_Info` | 免职/降职/离职/能下活水 |
| OD-干部退出明细表 | `catalog_dos_da_mcp.hrdw.Report_OD_Manager_Quitting` | 降级/免职/离职 |
| OD-青年干部新进表（新） | `catalog_dos_da_mcp.hrdw.Report_OD_Young_Manager_Promotion_Info_New` | 2023-08-16 起新口径 |
| OD-兼岗记录 | `catalog_dos_da_mcp.hrdw.Report_OD_Part_time_job` | 历史+当前兼岗 |

## 五、招聘 - 校招

| 表名 | table_code | 说明 |
| --- | --- | --- |
| New-校招个人简历信息明细表 | `catalog_dos_da_mcp.hrdw.Report_School_Recruit_Personal_Resume_Info` | 简历投递主信息 |
| New-校招简历分配信息明细表 | `catalog_dos_da_mcp.hrdw.Report_School_Recruit_Resume_Deploy` | 简历分配 |
| New-校招推荐锁定信息明细表 | `catalog_dos_da_mcp.hrdw.Report_School_Recruit_Resume_Lock` | 简历推荐 |
| New-校招伯乐信息明细表 | `catalog_dos_da_mcp.hrdw.Report_School_Recruit_Bole_Info` | 内部伯乐 |
| New-校招外部伯乐推荐明细表 | `catalog_dos_da_mcp.hrdw.Report_School_External_Bole_Info` | 外部伯乐 |
| New-校招面试信息明细表 | `catalog_dos_da_mcp.hrdw.Report_School_Recruit_Interview_Info` | **校招面试核心**，2016 至今全环节 |
| New-校招录用信息明细表 | `catalog_dos_da_mcp.hrdw.Report_School_Recruiti_Info_List` | **签约/入职** |
| New-实习生考核信息明细表 | `catalog_dos_da_mcp.hrdw.Report_Intern_Assessment_Info` | 2019 起，含留用建议 |
| New-校招需求信息表 | `catalog_dos_da_mcp.hrdw.Report_Campus_Requirement_Info` | 注意 table_code 含换行 `catalog_dos_da\n_mcp...` |
| 校招面试问卷反馈表（含PCG） | `catalog_dos_da_mcp.hrdw.Report_School_Recruit_Interview_Questionnaire_Feedback` | 面试官问卷 |

## 六、招聘 - 社招 & 活水 & 通用

| 表名 | table_code | 说明 |
| --- | --- | --- |
| 社招简历评估宽表 | `catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment` | 简历到达→通过/放弃/超时 |
| 社招面试全流程宽表 | `catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail` | flow_id=3 社招、flow_id=5 活水 |
| 社招面试全流程 | `catalog_dos_da_mcp.hrdw.Report_Whole_Process_Of_Social_Recruitment_Interview` | 候选人维度全流程 |
| 流程管理-社招面试环节明细 | `catalog_dos_da_mcp.hrdw.Report_Process_M_S_R_and_Interview_Details` | 子环节、处理人、耗时 |
| 流程管理-活水面试全流程（新） | `catalog_dos_da_mcp.hrdw.Report_Process_manage_mobile_interview_flow_new` | — |
| 简历推荐明细表 | `catalog_dos_da_mcp.hrdw.Report_Resume_recommendation_list` | 含链路归因/付费/推荐渠道 |
| 伯乐推荐记录明细 | `catalog_dos_da_mcp.hrdw.Report_Bole_Recommendation_Record_Details` | 社招伯乐推荐 |
| 伯乐信息维表 | `catalog_dos_da_mcp.hrdw.Report_Bole_Info` | 伯乐名单 |
| 链路归因行为明细表 | `catalog_dos_da_mcp.hrdw.Report_Recruit_Bole_Link_Event_Actiontrace` | 简历来源投放数据 |
| 渠道入职信息明细 | `catalog_dos_da_mcp.hrdw.Report_Channel_Entry_Information_Detail` | 推荐+付费渠道入职 |
| 面试官信息 | `catalog_dos_da_mcp.hrdw.Report_InterviewerInfo` | 面试官名单 |
| 面试安排自动化 | `catalog_dos_da_mcp.hrdw.Report_Recruit_Interview_Arrange` | 面试安排单据 |
| 岗位管理-招聘岗位信息 | `catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice` | 当前最新岗位 |
| 小招-报表7-下单帮我沟通简历 | `catalog_dos_da_mcp.hrdw.Report_Report7_Of_Xiaozhao_Help_Me` | 小招帮我沟通单据 |
| 小招-报表7-帮我沟通反馈数据 | `catalog_dos_da_mcp.hrdw.Report_Report7_Of_Xiaozhao_Help_Me_Communicate_Feedback_Data` | 沟通结果 |

## 七、学堂 & 培训

| 表名 | table_code | 说明 |
| --- | --- | --- |
| 学堂-课程信息表 | `catalog_dos_learn_credit_service.hrdw.dw-api-public-qlearning-pub-course-statement-df-mcp` | 课程维表 |
| 学堂-课程学习行为记录表 | `catalog_dos_learn_credit_service.hrdw.t_ads_dw_qlearning_lrs_behavioral_for_staff` | 学习行为事实表 |
| 学堂-讲师信息表 | `catalog_dos_learn_credit_service.hrdw.t_dwm_dw_lecturer_lecturer_lectures_info_df` | 讲师资质能力 |
| 学堂-班级信息表 | `catalog_dos_learn_credit_service.hrdw.fdw_ads_tbiplus_qlearning_act_class` | 班级运营+反馈 |
| 对外课程内容表 | `catalog_dos_da_mcp.hrdw.Report_OCourse_List` | — |
| 对外课程申请表 | `catalog_dos_da_mcp.hrdw.Report_OCourse_Apply_List` | — |
| 对外课程讲师信息表 | `catalog_dos_da_mcp.hrdw.Report_OCourse_Lecturer_List` | — |
| 导师辅导记录报表 | `catalog_dos_da_mcp.hrdw.Report_Tutor_Counseling_Record` | 岗位/多元导师 |
| 知点控权数据集接口-1 | `catalog_dos_learn_credit_service.hrdw.dw_private_od_knowledge_points_interface_1` | 知点-1 |
| 知点控权数据集接口-2 | `catalog_dos_learn_credit_service.hrdw.dw_private_od_knowledge_points_interface_2` | 知点-2 |
| 知点控权数据集接口-3 | `catalog_dos_learn_credit_service.dw_private_od_knowledge_points_interface_3` | 知点-3（注意 catalog 路径变化） |
| 知点控权数据集接口-4 | `catalog_dos_learn_credit_service.hrdw.dw_private_od_knowledge_points_interface_4` | 知点-4 |

## 八、福利 / 加班 / 假期 / 安居 / Q币

| 表名 | table_code | 说明 |
| --- | --- | --- |
| 休假申请数据大宽表 | `catalog_dos_da_mcp.hrdw.Report_Large_Wide_Table_Of_Leave_Application_Data` | 各类假期申请 |
| 福利-节假日加班申请（新） | `catalog_dos_da_mcp.hrdw.Report_Benefits_Holiday_Overtime_Application_new` | 申请数据 |
| 福利-节假日加班记录（新） | `catalog_dos_da_mcp.hrdw.Report_Benefits_Holiday_Overtime_Record_new` | 实际加班记录 |
| 福利-周末加班申请（新） | `catalog_dos_da_mcp.hrdw.Report_Benefits_Weekend_Overtime_Request_new` | 申请数据 |
| 福利-周末加班记录（新） | `catalog_dos_da_mcp.hrdw.Report_Benefits_Weekend_Overtime_Record_new` | 实际加班记录 |
| 安居计划申请明细 | `catalog_dos_da_mcp.hrdw.Report_Housing_Plan_Apply_Detail` | 申请明细 |
| 安居计划贷款及还款 | `catalog_dos_da_mcp.hrdw.Report_Housing_Plan_Loan_Payment` | 贷款+还款 |
| 安居计划每期还款明细 | `catalog_dos_da_mcp.hrdw.Report_Housing_Plan_Repayment_Record` | 每期还款 |
| 安居申请【当月各环节耗时】统计列表 | `catalog_dos_da_mcp.hrdw.Report_Housingplan_stepcosttime_list` | — |
| 周年Q币员工信息明细表 | `catalog_dos_da_mcp.hrdw.Report_Q_Coin_Employee_Information_List` | — |
| Q币兑换明细表 | `catalog_dos_da_mcp.hrdw.Report_Q_Coin_Exchange_Details` | — |

## 九、商保 / 公社

| 表名 | table_code | 说明 |
| --- | --- | --- |
| 公社商保-公社有效账户 | `catalog_dos_da_mcp.dataset.Report_Valid_Account` | — |
| 公社商保-员工积分汇总查询 | `catalog_dos_da_mcp.dataset.Report_Staff_Point_Summary_Query` | — |
| 公社商保-员工积分明细查询 | `catalog_dos_da_mcp.dataset.Report_Staff_Point_Details_Query` | — |
| 公社商保-产品信息 | `catalog_dos_da_mcp.hrdw.Report_Flex_Core_Product_Info` | — |
| 公社商保-正常订单除理疗体检 | `catalog_dos_da_mcp.dataset.Report_Normal_Order` | — |
| 公社商保-正常订单理疗体检 | `catalog_dos_da_mcp.dataset.Report_Phys_Check` | — |

## 十、敬满 / 用户反馈

| 表名 | table_code | 说明 |
| --- | --- | --- |
| 敬满量标题数据宽表 | `catalog_dos_da_mcp.hrdw.Report_ER_Scale` | 量标 |
| 敬满开放题数据宽表 | `catalog_dos_da_mcp.dataset.Report_ER_Open_ended` | 开放题 |
| 用户评价明细表 | `catalog_dos_da_mcp.hrdw.Report_User_Feedback_Evaluate_Form` | — |
| 用户声音明细表 | `catalog_dos_da_mcp.hrdw.Report_User_Feedback_Voice_Form` | — |

## 十一、流程引擎

| 表名 | table_code | 说明 |
| --- | --- | --- |
| 流程定义信息表 | `catalog_dos_da_mcp.hrdw.Report_Liu_Cheng_Ding_Yi_Xin_Xi_Biao` | 已接入流程的定义 |
| 流程委托授权信息表 | `catalog_dos_da_mcp.hrdw.Report_Liu_Cheng_Wei_Tuo_Shou_Quan_Xin_Xi_Biao` | 委托授权 |
| 流程实例流程颗粒度明细表 | `catalog_dos_da_mcp.hrdw.Report_Liu_Cheng_Shi_Li_Liu_Cheng_Ke_Li_Du_Ming_Xi_Biao` | 流程级 |
| 流程实例环节颗粒度明细表 | `catalog_dos_da_mcp.hrdw.Report_Liu_Cheng_Shi_Li_Huan_Jie_Ke_Li_Du_Ming_Xi_Biao` | 环节级 |
| 流程实例待办明细表 | `catalog_dos_da_mcp.hrdw.Report_Liu_Cheng_Shi_Li_Dai_Ban_Ming_Xi_Biao` | 待办 |
| 权限中台流程定义信息表 | `catalog_dos_da_mcp.hrdw.Hris_flow_typ` | flow_type |
| 权限中台流程实例信息表 | `catalog_dos_da_mcp.hrdw.Hris_flow_instance` | flow_instance |
| 权限中台流程实例步骤信息表 | `catalog_dos_da_mcp.hrdw.Hris_flow_instance_step` | flow_instance_step |

## 十二、服务监控

| 表名 | table_code | 说明 |
| --- | --- | --- |
| hr-ai-data MCP服务用户请求记录表 | `catalog_dos_da_mcp.hrdw.Report_HR_AI_Data_MCP_Service_User_Request_Record` | 准实时（小时级） |
| DOS数据接口请求记录表 | `catalog_dos_da_mcp.hrdw.Report_DOS_Data_API_User_Request_Record` | 区分应用：data-analysis-mcp / DIY-Tool / learn-credit-service |

## 十三、字典/维表（共用，识别脱敏与码值）

| table_code | 用途 |
| --- | --- |
| `catalog_dos_da_mcp.hrdw.a370651772b848cfa5dc7ef602243d69` | **组织维表**（用于下级组织展开） |
| `catalog_dos_da_mcp.hrdw.dw-api-public-core-personnel-filters-dictionary-workSpaceCity` | 工作地 |
| `catalog_dos_da_mcp.hrdw.dw-api-public-core-personnel-filters-dictionary-staffType` | 员工类型 |
| `catalog_dos_da_mcp.hrdw.dw-api-public-core-personnel-filters-dictionary-staffStatus` | 在职状态 |
| `catalog_dos_da_mcp.hrdw.dw-api-public-core-personnel-filters-dictionary-recruitmentType` | 招聘类型 |
| `catalog_dos_da_mcp.hrdw.dw-api-public-dictionary-manage-unit-name` | 管理主体 |
| `catalog_dos_da_mcp.hrdw.dw-api-public-dictionary-manager-level-name` | 管理职级 |
| `catalog_dos_da_mcp.hrdw.dw-api-public-dictionary-pro-position-level-name` | 专业职级 |
| `catalog_dos_da_mcp.hrdw.dw-api-public-dictionary-whether-if` | 是/否（布尔类） |
| `catalog_dos_da_mcp.hrdw.public-dictionary-std-dictionary-item-df-transferProcessingType` | 流程状态（异动） |
| `catalog_dos_da_mcp.hrdw.dw-api-public-std-staff-subtype` | 员工子类型 |
| `catalog_dos_da_mcp.hrdw.dw-api-public-dictionary-contract-parties` | 合同主体（合同公司） |

> 注：字典表名包含连字符 `-`，写 SQL 时必须用反引号包裹：`catalog_dos_da_mcp.hrdw.\`dw-api-public-...\``

## 十四、特殊提示

1. **多版本同名宽表**：「员工信息宽表」存在 T-1 版（`catalog_dos_data_analysis_mcp_2`）和月末快照版（`catalog_dos_da_mcp`），按需求选用。
2. **table_code 包含换行**：`catalog_dos_da\n_mcp.hrdw.Report_Campus_Requirement_Info` 实际有换行符，使用前需清理。
3. **catalog 路径有差异**：知点接口-3 走的是 `catalog_dos_learn_credit_service.dw_private_...`（无 `hrdw` 中段），其他知点接口走 `catalog_dos_learn_credit_service.hrdw.dw_private_...`。
