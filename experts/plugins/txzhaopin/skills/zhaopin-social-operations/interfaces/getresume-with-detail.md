# interfaces/getresume-with-detail.md

社招简历详情接口（含面试流程 + 沟通记录）。

## 基本信息

- **apiId**: `recruit.social-resume.get_api_resume_detail_getresume_with_detail`
- **方法**: GET
- **权限**: 与 `getresume` 一致

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `rid` | string | ✅ | 简历 RID（UUID） |
| `fromPlace` | string | ✅ | 访问来源，MCP 过来的**必须传 `MCP`** |

## 返回结构（实测确认 2026-04-21）

> ⚠️ 详情接口返回的顶层结构是三个并列 key，不是嵌套在 resume 里。

### 顶层

```json
{
  "resume": {...},          // 核心简历数据
  "flowList": [...],        // 面试流程列表
  "contactRecords": [...]   // 沟通记录列表
}
```

### resume 子对象关键字段名（实测）

| 字段名 | 说明 | 踩坑注意 |
|---|---|---|
| `RID` | 简历 UUID | **大写**（搜索结果中是小写 `rid`） |
| `name` | 姓名 | 部分权限下脱敏为 `*****` |
| `age` | 年龄 | |
| `gender` | 性别 | |
| `workCity` | 当前工作城市 | |
| `extendWorkYearValue` | 总工作年限 | 动态计算值，优先使用 |
| `currentJobTitle` | 当前职位 | |
| `lastCompany` | 最近公司 | 空时从 resumeWorkExp[0] 补 |
| `education` | 最高学历 | |
| `school` | 最高学历院校 | |
| `status` | 状态码 | |
| `statusText` | 状态文本 | |
| `isLock` | 锁定标志 | |
| `resumeWorkExp` | 工作经历列表 | **不是** `workExperienceList` |
| `resumeProject` | 项目经历列表 | **不是** `resumeProjectExp` |
| `resumeEdu` | 教育经历列表 | **不是** `resumeEducation` |
| `resumeTagSkills` | 技能标签 | **字符串数组**（非对象数组） |

### resumeWorkExp 子字段

```
employerName, department, positionTitle, industry,
workStartDate, workEndDate, workPlace, workSummary
```

### resumeProject 子字段

```
projectName, projStartDate/projectStartDate, projEndDate/projectEndDate,
projSummary/projectSummary
```

### resumeEdu 子字段

```
eduSchool/schoolName, eduLevel/degree, eduMajorName/majorName,
eduStartDate/startDate, endDate,
is985, is211, isC9, overSea
```

## 精读字段白名单（v6.0 · `deep_read.py` 内置过滤）

v6.0 由 `scripts/deep_read.py` 调用本接口并按以下白名单字段过滤后输出，模型只看精简后的字段：

```
基本信息：RID, name, age, gender, workCity,
  extendWorkYearValue, currentJobTitle, lastCompany,
  education, school, status, statusText, isLock

工作经历：resumeWorkExp[0:2]（只看前 2 段）
  employerName, department, positionTitle, industry,
  workStartDate, workEndDate, workPlace,
  workSummary（只看前 200 字）

项目经历：resumeProject[0:2]（只看前 2 段）
  projectName, projStartDate, projEndDate,
  projSummary（只看前 200 字）

教育经历：resumeEdu（全部保留）
  eduSchool, eduLevel, eduMajorName, eduStartDate, endDate,
  is985, is211, isC9, overSea

技能标签：resumeTagSkills（字符串数组）

面试流程摘要（可选，用于风险判断）：
  flowList 最近 1 条的 postName, stateName, lastUpdateTime
```

### ❌ 主动忽略（MCP 返回但不评估）

- 自我评价（SelfEvaluation）
- 证书列表（CertList）
- 语言能力（LangList）
- 培训经历（TrainList）
- 面试评价 / 沟通记录详情
- 期望薪资 / 到岗时间
- 附件 / 照片

## 风险字段（精读时重点看）

- `status` != 1 → 锁定/已进流程（参见 `isLock`）
- `flow_count > 0` + `latest_flow.stateName` 非"已完结" → **候选人在其他岗位面试中**
- `contact_count > 5` → 被频繁沟通过，可能已有谈判

## 调用方式

v6.0 由 `scripts/deep_read.py` 通过 `mcp_client.MCPClient` 统一调用，**Agent 不应直接 `mcp_call_tool` 调本接口**：

```bash
python3 {skillDir}/scripts/deep_read.py --rids "rid1,rid2,..." --offset 0 --limit 5
```

脚本内部：
- 按 offset/limit 截取本批 rid
- 顺序调用本接口拉详情（每条独立 HTTP 请求）
- 用本文件的"精读字段白名单"过滤字段
- 输出精简 JSON 到 stdout（不落盘）

详见 SKILL.md 阶段 5 与 `references/step5-deep-read-schema.md`。

## 注意事项

1. `name` 字段在某些权限下会是 `*****`（脱敏），这时应使用搜索接口返回的 `name`，以 `rid` 关联
2. `lastCompany` 为空时可从 `resumeWorkExp` 的最近一段补全
