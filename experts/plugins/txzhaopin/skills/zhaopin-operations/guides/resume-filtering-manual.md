# 简历筛选手册 📋

本手册包含筛选条件目录和参数速查，供搜索前查阅。

---

## 🎯 搜索参数构建指南

### 默认条件（用户未指定时必须带上）

```json
{
  "graduate_time_begin": "2027-01-01",
  "graduate_time_end": "2027-12-31",
  "startInterviewEnable": 1,
  "is_full": 0,
  "is_mine": 0,
  "is_bole": 0
}
```

### 必需参数模板

```json
{
  "page": 1,
  "limit": 20,
  "searchId": "search-随机字符串",
  "searchStrategy": {"version": "V3", "strategy": "strategy-V3"},
  "graduate_time_begin": "2027-01-01",
  "graduate_time_end": "2027-12-31",
  "startInterviewEnable": 1
}
```

### 筛选逻辑

- **同一条件内**：OR（`school: [清华, 北大]` = 清华或北大）
- **不同条件间**：AND（school + education = 必须同时满足）
- **空数组/null**：不筛选该条件

### 🔴 条件分类规则

**硬性条件（用户明确指定，禁止扩展）**：
城市（`work_city`）、毕业时间（`graduate_time`）、学历（`education`）、学校/院校等级（`school`/`schoolLevel`）、专业（`specialityList`）、岗位（`station`）

> 这些维度用户指定了什么就用什么，**禁止自行扩展**。

**可扩展条件（鼓励在多轮中扩展同义词）**：
技能/技术栈、核心经验/业务领域、项目/工具名、实习公司

> 这些维度在 keyword 中使用，**鼓励后续轮次扩展同义词、相近技能、相关产品名**，用 OR（`|`）组合扩大候选集。

### 🔴 keyword 使用规则

1. **有筛选字段的维度禁止放入 keyword**（学校、专业、学历、城市、院校等级等必须用结构化参数）
2. **keyword 中 AND（`+`）最多 2 个**（最多 3 个词的 AND 组合）

---

## 📚 筛选条件目录

### 基本信息类

| 筛选条件 | 参数名 | 文档 | 说明 |
|---------|--------|------|------|
| 关键词搜索 | `keyword` | `filters/keyword-search.md` | 全文模糊搜索，支持 `|`(OR) `+`(AND) `""`(精确) |
| 毕业时间 | `graduate_time_begin/end` | `filters/graduate-time.md` | 格式 `YYYY-MM-DD` |
| 学校查询范围 | `last_school` | `filters/school-query-scope.md` | 0=最高学历, 1=所有学历 |
| 院校等级 | `schoolLevel` | `filters/school-level.md` | 985/211/C9/QS100 等 |
| 学校名称 | `school` | `filters/school-name.md` | 严格过滤（按最高学历匹配） |
| 学历 | `education` | `filters/education.md` | 1=大专,2=本科,3=硕士,4=博士 |
| 专业 | `specialityList` | `filters/major.md` | 需先搜索获取专业ID |

### 工作与岗位类

| 筛选条件 | 参数名 | 文档 | 说明 |
|---------|--------|------|------|
| 应聘职位 | `station` | `filters/position.md` | 岗位ID数组，查 `data/position-id-mapping.json` |
| 期望工作地 | `work_city` | `filters/work-city.md` | 城市ID数组 |
| 工作地可调配 | `is_deploy` | `filters/deploy.md` | 0=不限,1=服从,2=不服从 |
| 应聘项目 | `recruit_project` | `filters/recruit-project.md` | 1=校招,2=实习 |
| 投递意向部门 | `idepts` | `filters/intention-departments.md` | 部门ID数组 |

### 技能与能力类

| 筛选条件 | 参数名 | 文档 | 说明 |
|---------|--------|------|------|
| 技术方向 | `techDirectionsTxt` | `filters/tech-direction.md` | 技术方向数组 |
| 技能标签 | `skillList` | `filters/skill-tags.md` | 1103个技能标签 |
| 竞赛获奖 | `award` | `filters/competition-award.md` | 32种竞赛 |
| 玩过的游戏品类 | `play_game_categories` | `interfaces/get-play-game-categories.md` | 22种游戏品类（字符串数组） |

### 成绩与荣誉类

| 筛选条件 | 参数名 | 文档 | 说明 |
|---------|--------|------|------|
| 成绩排名 | `schoolRank` | `filters/grade-rank.md` | 1=前5%,2=前10%,3=前20%,4=其他 |
| 奖学金 | `scholarships` | `filters/scholarship.md` | 1=有,0=不限 |

### 实习经历类

| 筛选条件 | 参数名 | 文档 | 说明 |
|---------|--------|------|------|
| 实习公司 | `companyList` | `filters/internship-company.md` | 公司名称 |

### 流程与状态类

| 筛选条件 | 参数名 | 文档 | 说明 |
|---------|--------|------|------|
| 简历状态标签 | `is_full/is_mine/startInterviewEnable/is_bole` | `filters/resume-status-tags.md` | 互斥标签 |
| 流程状态 | `flow_status` | `filters/flow-status.md` | 待筛选/面试中/已offer等 |
| 当前锁定部门 | `lock_idepts` | `filters/lock-departments.md` | 部门ID数组 |
| 测评记录 | `assessmentFinishStatus` | `filters/assessment-record.md` | 测评状态 |
| 实习考核 | `select_tags` (fid=4) | `filters/internship-assessment.md` | 考核标签 |
| 面试记录 | `select_tags` (fid=2) | `filters/interview-record.md` | 面试状态 |
| 未读简历筛选 | `isUnRead` + `viewedDays` | `filters/unread-viewed-days.md` | 必须组合使用，过滤已读简历 |

---

## 💡 搜索示例

### 示例1：985院校成绩优秀的硕士

```json
{
  "schoolLevel": ["985"],
  "schoolRank": ["前5%", "前10%"],
  "education": [3],
  "graduate_time_begin": "2027-01-01",
  "graduate_time_end": "2027-12-31",
  "startInterviewEnable": 1
}
```

### 示例2：有大模型经验的候选人

```json
{
  "keyword": "大模型|LLM|GPT|Transformer|BERT",
  "education": [3, 4],
  "schoolLevel": ["985", "海外 QS100 高校"],
  "graduate_time_begin": "2027-01-01",
  "graduate_time_end": "2027-12-31",
  "startInterviewEnable": 1
}
```

### 示例3：特定岗位 + 学校

```json
{
  "school": ["华中科技大学"],
  "station": [406],
  "graduate_time_begin": "2027-01-01",
  "graduate_time_end": "2027-12-31",
  "startInterviewEnable": 1
}
```

---

## 🔗 接口快速参考

### 搜索简历

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.post_v1_resume_search' \
  params='{"keyword":"xxx","pageNum":1,"pageSize":30,"graduate_time_begin":"2027-01-01","graduate_time_end":"2027-12-31","startInterviewEnable":1}'
```

### 获取简历详情

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId' \
  params='{"rid":"xxx-xxx-xxx"}'
```

> 返回三层嵌套：`response.data.data.data.resumeInfo`

### 搜索学校ID

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_dictionary_searchSchool' \
  params='{"keyword":"清华"}'
```

### 搜索专业ID

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_dictionary_getTagList' \
  params='{"tagType":"major","keyword":"计算机"}'
```

### 收藏简历

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_favorite_addResume' \
  params='{"resumeId": ${resumeId}}'
```

> `resumeId` 是简历数字 ID（搜索结果的 `id` 字段），不是 `rid`。操作幂等，重复收藏不报错。

### 锁定简历

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.post_v1_resumeRecommend_lockCampusResume' \
  params='{"rid": "${rid}"}'
```

> `rid` 是简历 UUID。锁定后简历状态变为"已锁定"，其他面试官暂时无法操作。`staffId`/`bgId` 自动取当前登录用户。

---

## 📋 简历详情页链接格式

```
https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={rid}
```

- `rid` 必须是完整 UUID（如 `f012efe2-81f2-4a1f-bb95-811c1354d5ec`），不要截断，不要用数字 `id` 替代
