# API 规范 · post_api_process_get_list

> **接口 ID**：`recruit.social-todo-center.post_api_process_get_list`
> **名称**：社招流程跟踪 - 招聘经理获取负责的社招流程数据列表
> **方法**：POST `/api/process/get_list`
> **类型**：⚠️ **社招专用**（校招流程不走此接口）
> **限流**：1000 次/分（全局默认）
> **鉴权**：复用 recruit-mcp 的 TAIHU_TOKEN + ZHAOPIN_TOKEN
> **官方文档**：<https://test-api.zhaopin.woa.com/project/573/interface/api/70330>

---

## 接口语义

**用途**：获取**招聘经理（含拥有跨人查询权限的人）**负责的社招流程数据列表（与「待办」不同——待办是 task-level，流程是 case-level）。

> ⚠️ **接口实现陷阱（v1.1.1 实测发现，n=5 验证）**：本接口**必须显式传 `statusCode`**（如 `All` / `Interviewing` / `Offering` 等）才会返回数据。如果完全不传 `statusCode`（即使其他过滤正确），接口会固定返回 `total=0, rows=[]`，但 `code=200, success=true` 不会报错——很容易被误判成"权限不足"或"无数据"。
>
> **正确的最小可行参数**：
> ```json
> {"statusCode": "All", "done": false, "currentPage": 1, "pageSize": 50}
> ```
>
> 脚本 `fetch_process.py` 已默认补 `statusCode=All` + `done=false`。如果 agent 绕过脚本直接调 MCP 接口，**务必**手动带上这两个字段。

**查询范围**：不传 hrs/interviewers 等过滤 = 拉**当前登录人作为招聘经理 / 面试官**所能看到的流程。
- ⚠️ 如果用户拥有**跨人查询权限**，想查**别的招聘经理 / 面试官**负责的流程，**必须**显式传 `hrs`、`interviewers` 或 `hrIds` 参数；不传 = 还是只能看到自己的。
- 如果用户既不是招聘经理也不是任何流程的面试官，会返回空集（不一定 403，可能 200 + total=0）。

---

## 请求参数（全部可选 · 按需传）

### 🔥 高频过滤维度

| 参数 | 类型 | 说明 |
|---|---|---|
| `currentPage` | int | 页码（默认 1）|
| `pageSize` | int | 每页条数（默认 20，最大建议 200）|
| `hrs` | string[] | **招聘 HR 英文名列表** — 有跨人查询权限时可用，查别人负责的流程 |
| `hrIds` | int[] | 招聘 HR 员工 ID 列表 |
| `candidate` | string | 候选人姓名（对应待办 CandidateName）|
| `fuzzyQuery` | string | 模糊查询关键字（候选人/岗位/部门等任意维度） |
| `applyNo` | string | 申请单号 |
| `done` | bool | 已办/待办过滤（true=已办 / false=待办 / null=全部）|

### 🏢 组织维度

| 参数 | 类型 | 说明 |
|---|---|---|
| `deptIds` | int[] | 部门 ID（接口**没有 BG 维度**，只能按部门过滤）|
| `postIds` | int[] | 职位 ID |
| `positionStatus` | string | 岗位状态：`enable` / `disable` / `all` |

### 🚦 状态/环节维度

| 参数 | 类型 | 说明 |
|---|---|---|
| `statusCode` | string | 流程大状态。可选值：`All` / `Resume_Screening`（简历评估）/ `Interviewing`（面试阶段）/ `Offering`（offer阶段）/ `Offer_Toning`（背调）/ `Eevaluation`（综合测评，**注意 e 拼写**）/ `Onboarding`（入职中）/ `Onboard`（已入职）/ `Ending`（已结束）|
| `stateIds` | int[] | 状态 ID 数组（细颗粒）|
| `stepIds` | int[] | 环节 ID 数组（细颗粒）|
| `stepCode` | string | 环节 Code，依赖 `statusCode`，详见下方[环节码字典](#环节码-stepcode-字典) |
| `interviewStatus` | string | 面试安排状态（仅 `statusCode=Interviewing` 有效）：`wait_arrangement`（待面试安排）/ `interview_arrangement`（面试邀约中）/ `had_arrangement`（已安排面试）/ `hold_interview`（面试待定）/ `pass_interview`（面试通过）|
| `interviewChildStatus` | string | 面试子状态（仅 `interviewStatus=""` 有效）：`wait_interview`（已安排未到时间）/ `wait_evaluate`（已安排待面试官评价）|
| `evaluationStatus` | string | 综合测评状态：`测评中` / `测评待提交` / `测评已提交` |
| `referenceCheckStatus` | string | 背调状态（仅 `statusCode=Offer_Toning`）：`submit` / `checking` / `uploaded` |
| `endStatus` | string | 结束状态（仅 `statusCode=Ending`）：`resume_knockout` / `resume_timeout` / `interview_giveup` / `offering_offer_giveup` / `onboarding_giveup` / `Offer_Toning_giveup` / 等 |

### 👥 人员维度

| 参数 | 类型 | 说明 |
|---|---|---|
| `creators` | string[] | 申请人英文名列表 |
| `formCreators` | string[] | 面试流程发起人英文名 |
| `interviewers` | string[] | 面试官英文名 |
| `currentProcessStaffs` | string[] | 当前处理人英文名 |
| `processStaffIds` | int[] | 待办处理人 ID 列表 |
| `referer` | string[] | 推荐人英文名 |

### ⏰ 时间维度（格式：`起始时间戳-结束时间戳`，毫秒）

| 参数 | 说明 |
|---|---|
| `applyTime` | 应聘时间 |
| `arriveTime` | 待办到达时间 |
| `processTime` | 提交时间 |
| `interviewTime` | 面试时间 |
| `sendOfferTime` | 发送 offer 时间 |
| `inauguralDate` | 入职时间 |
| `appealTime` | 渠道申诉时间 |
| `submitReferenceCheckTime` | 提交背调时间 |

### 🎯 候选人维度

| 参数 | 类型 | 说明 |
|---|---|---|
| `candidateAge` | string | 年龄范围（如 `18-25`）|
| `candidateWorkYear` | string | 工作年限（如 `1-3`）|
| `candidateEducation` | string | 学历：`educationLevel1` ~ `educationLevel4` / `all` |
| `candidateCompanies` | string[] | 公司列表 |
| `candidatePositions` | string[] | 职位列表 |

### 📦 单据类型

| 参数 | 类型 | 说明 |
|---|---|---|
| `processFlowType` | string | `bole`（伯乐推荐）/ `lietou`（猎头）/ `web_recommend`（媒体严选）/ `ats`（他人推荐）/ `new_flow`（新流程）/ `old_flow`（旧流程）|
| `interviewRounds` | string[] | 面试轮次：`all` / `1` / `2` / `3` / `4` / `5` / `more` |

### 🛠️ 排序与扩展

| 参数 | 类型 | 说明 |
|---|---|---|
| `orderField` | string | 排序字段：`createTime`（应聘时间）/ `lastUpdateTime`（最后操作时间）/ `arriveTime`（待办到达时间）|
| `isDesc` | bool | 是否降序，默认 `true` |
| `realCount` | bool | 是否取真实分页数量 |
| `withDetailResumeData` | bool | 是否附带简历详细信息（默认 false）|

---

## 环节码 stepCode 字典

不同 `statusCode` 下的可选 `stepCode`：

### `statusCode=Resume_Screening`（简历评估）
- `HR_Resume_Screening`（HR 面试官筛选）
- `Interview_Resume_Screening`（业务面试官筛选）
- `Resume_Screening`（简历筛选）
- `Interviewer_Screening`（业务面试官初筛）
- `Manger_Screening`（招聘经理筛选）
- `Web_Resume_Screening`（媒体优选筛选）

### `statusCode=Interviewing`（面试阶段）
- `Initial_Interview`（初试阶段）
- `Repeat_Interview`（复试阶段）
- `Channel_Interview`（通道分会复试）
- `Committee_Interview`（面委会面试）
- `Qualification_Interview`（HR 资格面试）
- `Interview_Arrangement`（面试安排）
- `Professional_Interview`（部门内专业面试）
- `Department_Interview`（用人决策者面试）
- `Executive interview`（高管面试）
- `HRD interview` / `HRBP interview`
- `Evaluation_interviews`（测评环节）

### `statusCode=Offering`（Offer 阶段）
- `Salary_Negotiation`（HR 薪酬谈判）
- `C_BG_Approval`（C&BG）
- `Offer_Candidate_Communication`（人选沟通）
- `Department_Approval`（业务部门）/ `HRD_Approval`（BG HRD）
- `top_manager`（高管）/ `Committee_Approval`（人委）
- `offer`（offer）

### `statusCode=Offer_Toning`（背调）
- `Before_Offer_Tone` / `Mid_Offer_Tone` / `After_Offer_Tone`

### `statusCode=Onboarding`（入职阶段）
- `Confirmed_Entry_Time`（待确认入职时间）
- `REG_ResourceAssetsConfirm`（资源工作确认）
- `REG_ContractSignedConfirm`（文件签署确认）
- `REG_FormalitiesHandle`（现场手续办理）
- `REG_RegisterAdmissionConfirm`（入职入场确认）

---

## 响应字段（重点）

```json
{
  "code": "200",
  "message": "",
  "requestId": "...",
  "success": true,
  "data": {
    "total": 42,
    "rows": [
      {
        "flowMainId": 4174192,           // 流程主表 ID
        "traceId": 202036914,             // 待办跟踪 ID
        "processNo": 12345,               // 序号
        "flowId": 3,
        "flowName": "面试流程",

        "candidateId": 9999999,           // 候选人 ID（示例值）
        "candidateName": "示例候选人",      // 候选人名称（PII 水印后输出）
        "candidateGender": "女",
        "resumeId": "xxxxxxxx-xxxx-...",   // 简历 ID（即 RID）
        "phone": "138****1234",            // 候选人手机
        "email": "x@y.com",                // 候选人邮箱

        "postId": 100000,
        "postName": "<岗位名>",
        "deptId": 10000,
        "deptName": "<部门名>",
        "postDeptName": "...",             // 岗位所属部门
        "degreeName": "本科",
        "staffTypeName": "正式员工",

        "stepId": 38,
        "stepName": "HR 资格面试",         // 当前环节名称

        "ownerId": 99999,
        "ownerName": "<英文名>",           // 当前处理人

        "createTime": "2026-05-29 11:14:40",
        "arriveTime": "2026-05-29 11:14:40",
        "lastUpdateTime": "2026-05-29 11:14:40",
        "processTime": "",

        "url": "https://zhaopin.woa.com/...",  // ⭐ 处理链接（直接用，不要自己拼）

        "stateId": 3,
        "stateName": "面试中",             // 流程当前状态
        "creator": "<英文名>",             // ⭐ 单据创建者（招聘经理英文名，常用于反向识别"这条流程的招聘经理是谁"）
        "hr": "<英文名>",                  // ⭐ 招聘 HR 英文名

        "elapsedDay": 3,                  // ⭐ 当前环节耗时（天）
        "totalElapsedDay": 18,             // ⭐ 总耗时（天）

        "currentProcessStaff": ["xxx"],    // 当前处理人英文名数组
        "interviewerStaffName": ["xxx"],   // 当前面试官英文名数组

        "isDepute": false,
        "isDone": false,
        "secret": false,                   // 是否保密
        "actionName": "...",
        "remainDays": "5",                 // 剩余天数

        "recruitStateAndLinks": [...],     // 当前状态及链接列表
        "remarks": [...]                    // 备注列表
      }
    ]
  }
}
```

### ⭐ 与 v1.0.0（错误版）的字段差异（必须修正）

| v1.0.0 错误猜测 | ✅ 官方实际字段 |
|---|---|
| `currentStep` | `stepName` |
| `elapsedDaySum` | `totalElapsedDay` |
| `statusName` | `stateName` |
| `bgName` | ❌ 接口没有 BG 维度，只有 `deptName` 和 `postDeptName` |
| `recruitPostName` | `postName` |
| `departmentName` | `deptName` |
| `employeeId` | `candidateId` |
| `rid` | `resumeId` |

---

## 错误处理

| 错误 | 含义 | 处理 |
|---|---|---|
| 401 Unauthorized | 太湖 Token 过期 | 回 CodeBuddy 设置面板覆盖 |
| 403 Forbidden | 招活 Token 无招聘经理权限 | **本接口要求招聘经理权限，普通面试官账号必然 403**。话术明确告诉用户"如果你只是面试官，请改用 interview-assistant 查面试待办"，**严禁**让用户去重申 Token |
| 500 操作失败 | 后端依赖异常 | 联系 HR 业务运维 |

⚠️ **403 是最高频错误**——很多同学是面试官但不是招聘经理，调这个接口必然 403。
