# 校园简历搜索接口 🔍

根据多个筛选条件搜索符合要求的校园简历。

## 📋 接口信息

| 项目 | 值 |
|------|-----|
| URL | `/resume/campus/api/v1/resume/search` |
| Method | POST |
| Content-Type | application/json |

## 🎯 使用流程

⚠️ **重要**：在调用本接口前，必须先完成以下步骤：

### 第一步：阅读简历筛选手册

查看 [简历筛选手册](../guides/resume-filtering-manual.md)，了解完整的筛选流程和所有可用的筛选条件。

### 第二步：查阅具体的筛选条件文档

根据用户需求，到 `filters/` 目录下查找对应的筛选条件文档。每个文档包含：
- 参数名称和类型
- 如何获取可选值
- 参数值的格式要求
- 使用示例

**示例**：要筛选"985院校，成绩排名前10%，获得过ICPC奖项的硕士生"
- 查阅 [`filters/school-level.md`](../filters/school-level.md) → 得知 `schoolLevel: ["985"]`
- 查阅 [`filters/grade-rank.md`](../filters/grade-rank.md) → 得知 `schoolRank: ["前5%", "前10%"]`
- 查阅 [`filters/competition-award.md`](../filters/competition-award.md) → 得知 `award: ["ICPC国际大学生程序设计竞赛"]`
- 查阅 [`filters/education.md`](../filters/education.md) → 得知 `education: [3]`（3=硕士）

### 第三步：构建完整的请求参数

将所有筛选条件组合到一起，加上必需参数。

## 📝 必需参数

以下参数是**必须提供**的，无论是否使用筛选条件：

```javascript
{
  // 分页参数
  page: 1,                                          // 页码，从1开始
  limit: 20,                                        // 每页数量，建议20
  
  // 搜索标识
  searchId: "search-" + Math.random().toString(36).substr(2),  // 唯一搜索ID
  
  // 搜索策略（必需）
  searchStrategy: {
    version: "V3",                                  // 固定值
    strategy: "strategy-V3"                         // 固定值
  },
  
  // ... 筛选条件
}
```

## 🔴 默认筛选条件（重要）

**以下两个条件是默认值，用户未明确指定时必须包含：**

### 1. 毕业时间：2027年（默认）

```javascript
{
  graduate_time_begin: "2027-01-01",  // 必须：格式 YYYY-MM-DD
  graduate_time_end: "2027-12-31"     // 必须：格式 YYYY-MM-DD
}
```

**说明**：当前主要招聘对象是2027届毕业生，因此默认筛选2027年毕业的候选人。

**⚠️ 仅当用户明确指定其他年份时才修改**，例如：
- 用户说"找2026届的学生" → 改为 `2026-01-01` 到 `2026-12-31`
- 用户说"不限毕业年份" → 可以去掉此条件或扩大范围

### 2. 简历状态：仅查看可发起面试的简历（默认）

```javascript
{
  startInterviewEnable: 1,  // 必须：1=仅查看可发起面试的
  is_full: 0,               // 0=不筛选
  is_mine: 0,               // 0=不筛选
  is_bole: 0                // 0=不筛选
}
```

**说明**：默认只显示可以发起面试的简历，过滤掉已被锁定、无法面试的简历，提高筛选效率。

**⚠️ 仅当用户明确指定其他状态时才修改**，例如：
- 用户说"查看我的简历" → 改为 `is_mine: 1, startInterviewEnable: 0`
- 用户说"查看伯乐推荐" → 改为 `is_bole: 1, startInterviewEnable: 0`
- 用户说"查看所有简历" → 全部设为 `0`

**详细文档**：[简历状态标签筛选条件](../filters/resume-status-tags.md)

## 📋 筛选条件参数

所有筛选条件参数的详细说明都在各自的文档中。以下仅列出参数名称，**具体用法请查阅对应文档**：

| 筛选条件 | 参数名 | 文档路径 |
|---------|--------|---------|
| **关键词模糊搜索** | `keyword` | [filters/keyword-search.md](../filters/keyword-search.md) |
| 简历状态标签 | `is_full` / `is_mine` / `startInterviewEnable` / `is_bole` | [filters/resume-status-tags.md](../filters/resume-status-tags.md) |
| 毕业时间 | `graduate_time_begin` / `graduate_time_end` | [filters/graduate-time.md](../filters/graduate-time.md) |
| 学校查询范围 | `last_school` | [filters/school-query-scope.md](../filters/school-query-scope.md) |
| 院校等级 | `schoolLevel` | [filters/school-level.md](../filters/school-level.md) |
| 学校名称 | `school` | [filters/school-name.md](../filters/school-name.md) |
| 学历 | `education` | [filters/education.md](../filters/education.md) |
| 专业 | `specialityList` | [filters/major.md](../filters/major.md) |
| 期望工作地 | `work_city` | [filters/work-city.md](../filters/work-city.md) |
| 工作地可调配 | `is_deploy` | [filters/deploy.md](../filters/deploy.md) |
| 应聘项目 | `recruit_project` | [filters/recruit-project.md](../filters/recruit-project.md) |
| 应聘职位 | `station` | [filters/position.md](../filters/position.md) |
| 技术方向 | `techDirectionsTxt` | [filters/tech-direction.md](../filters/tech-direction.md) |
| 技能标签 | `skillList` | [filters/skill-tags.md](../filters/skill-tags.md) |
| 流程状态 | `flow_status` | [filters/flow-status.md](../filters/flow-status.md) |
| 当前锁定部门 | `lock_idepts` | [filters/lock-departments.md](../filters/lock-departments.md) |
| 投递意向部门 | `idepts` | [filters/intention-departments.md](../filters/intention-departments.md) |
| 实习公司 | `companyList` | [filters/internship-company.md](../filters/internship-company.md) |
| 竞赛获奖 | `award` | [filters/competition-award.md](../filters/competition-award.md) |
| 奖学金 | `scholarships` | [filters/scholarship.md](../filters/scholarship.md) |
| 成绩排名 | `schoolRank` | [filters/grade-rank.md](../filters/grade-rank.md) |
| 测评记录 | `assessmentFinishStatus` | [filters/assessment-record.md](../filters/assessment-record.md) |
| 实习考核记录 | `select_tags` (fid=4) | [filters/internship-assessment.md](../filters/internship-assessment.md) |
| 面试记录 | `select_tags` (fid=2) | [filters/interview-record.md](../filters/interview-record.md) |
| 玩过的游戏品类 | `play_game_categories` | [interfaces/get-play-game-categories.md](../interfaces/get-play-game-categories.md) |
| 未读简历筛选 | `isUnRead` + `viewedDays` | [filters/unread-viewed-days.md](../filters/unread-viewed-days.md) |

## 💡 完整示例

### 示例：筛选985高校的优秀学生

```javascript
POST /resume/campus/api/v1/resume/search

{
  // 必需参数
  page: 1,
  limit: 20,
  searchId: "search-mmyhn6ys-konkm7dpg",
  searchStrategy: {
    version: "V3",
    strategy: "strategy-V3"
  },
  // 🔴 默认条件1：毕业时间2027年
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31",
  
  // 🔴 默认条件2：仅查看可发起面试的简历
  startInterviewEnable: 1,
  is_bole: 0,
  is_full: 0,
  is_mine: 0,
  
  // 筛选条件
  schoolLevel: ["985"],                             // 985院校
  schoolRank: ["前5%", "前10%"],                    // 成绩排名前10%
  education: [3],                                    // 硕士（3=硕士）
  work_city: [2, 1],                              // 北京(2)或深圳总部(1)
  
  // 其他参数（使用默认值/空值表示不筛选）
  highlightFlag: true,
  viewedDays: null,
  orderBy: "",
  isAssessmentPass: 0,
  keyword: "",
  id: null,
  mobile: "",
  idcard: "",
  name: "",
  last_school: 0,
  school: [],
  specialityList: [],
  skillList: [],
  recruit_project: [],
  pratice_time_list: [],
  station: [],
  flow_status: [],
  is_deploy: null,
  lock_idepts: [],
  idepts: [],
  companyList: [],
  award: [],
  scholarships: [],
  assessmentFinishStatus: [],
  score_type: [],
  master: "",
  tech_ability_tags: [],
  game_design_ability_tags: [],
  techDirectionsTxt: [],
  play_game_categories: [],
  select_tags: [],
  earliest_entry_date_start: "",
  earliest_entry_date_end: "",
  register_time: "",
  register_time_end: "",
  last_update: "",
  last_update_end: ""
}
```

---

## 📤 返回结果

返回数据路径：`response.data.data.list`（两层 `data`）。

```json
{
  "status": 200,
  "data": {
    "message": "",
    "status": 0,
    "data": {
      "list": [ /* 简历数组 */ ]
    }
  }
}
```

---

### 🔴 粗读字段选择策略（CRITICAL — 必须遵守）

**搜索接口每条简历返回 67 个字段，其中大部分对粗读筛选无用。直接将完整 JSON 输出到对话上下文会严重浪费 token。**

**每次搜索后必须执行以下步骤**：
1. **将 mcporter 返回的完整 JSON 存入临时文件**（不要直接输出到对话）
2. **根据本次筛选需求，从下方字段表中选择需要的字段**
3. **用脚本从文件中只提取选定字段**，格式化后输出到对话上下文
4. **全局 rid 去重**：多轮搜索时用 rid 去重，避免重复候选人

**⚠️ 严禁行为**：
- ❌ 直接将 mcporter 返回的完整 JSON 输出到对话上下文
- ❌ 不做字段筛选就开始粗读评估
- ❌ 把 `tagList`（数字数组）、`lockBg`/`lockBgTxt` 等无用字段带入上下文

**✅ 正确做法**：
```
1. mcporter call ... > 结果存入临时文件
2. 根据筛选需求确定本次提取字段（参考下方场景推荐）
3. 用 python/jq 从文件提取选定字段 → 格式化为精简列表/表格
4. 只将精简结果输出到对话上下文，用于粗读评估
```

---

### 📊 完整字段清单 & 推荐等级

> **推荐等级说明**：⭐必看 = 每次粗读都需要；📋常用 = 根据需求选用；⚪可选 = 特殊场景才需要；🚫忽略 = 粗读时不需要

#### 一、核心身份信息

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `rid` | string | 简历UUID（去重&链接必需） | ⭐必看 |
| `id` | number | 简历数字ID | 🚫忽略 |
| `name` | string | 候选人姓名 | ⭐必看 |
| `sex` | string | 性别（"男"/"女"） | ⚪可选 |
| `mobile` | string | 手机号（脱敏） | 🚫忽略 |
| `photo` | string | 照片URL | 🚫忽略 |
| `filePath` | string | 简历附件路径 | 🚫忽略 |

#### 二、教育背景

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `school` | string | 学校名称 | ⭐必看 |
| `eduDepartment` | string | 院系名称 | 📋常用 |
| `speciality` | string | 专业名称 | ⭐必看 |
| `educationTxt` | string | 学历文本（"本科"/"硕士研究生"/"博士研究生"） | ⭐必看 |
| `education` | number | 学历代码（0=本科,3=硕士,4=博士） | 🚫忽略 |
| `schoolCountry` | string | 学校所在国家 | ⚪可选 |
| `graduateTimeTxt` | string | 毕业时间（"2027-08-01"） | 📋常用 |
| `graduateTime` | number | 毕业时间戳 | 🚫忽略 |

#### 三、院校&能力标签

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `schoolLevelTag` | string[] | 院校等级标签（"985"/"211"/"C9"/"海外 QS100 高校"等） | ⭐必看 |
| `tagTxtList` | string[] | 综合标签（含院校等级 + "测评通过" 等状态标签） | 📋常用 |
| `tagList` | number[] | 标签ID数组（纯数字，对人不可读） | 🚫忽略 |
| `highlightTags` | string[] | 亮点标签（"教育背景优"/"竞赛获奖"等） | ⭐必看 |
| `skillTag` | string[]∣null | 技能标签（可能为 null） | 📋常用 |

#### 四、投递岗位信息

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `station` | number | 岗位ID | 🚫忽略 |
| `stationTxt` | string | 岗位名称（"AI产品经理培训生"等） | ⭐必看 |
| `subDirectionId` | number | 子方向ID | 🚫忽略 |
| `subDirectionName` | string | 子方向名称 | ⚪可选 |
| `stationWithSubDirection` | string | 岗位+子方向完整名称 | 🚫忽略（与stationTxt重复） |

#### 五、流程&状态

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `flowStatus` | number | 流程状态码 | 🚫忽略 |
| `flowStatusTxt` | string | 流程状态（"待筛选"/"面试中"/"已录用"等） | 📋常用 |
| `recruitProjectTxt` | string | 招聘项目（"应届实习"/"校园招聘"） | 📋常用 |
| `recruitProject` | number | 招聘项目代码 | 🚫忽略 |
| `recruitType` | number | 招聘类型代码 | 🚫忽略 |
| `channelTxt` | string | 投递渠道（"官网投递"/"校园伯乐推荐"等） | ⚪可选 |
| `channel` | number | 渠道代码 | 🚫忽略 |

#### 六、BG&部门（锁定信息）

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `bgTxt` | string | 投递BG（"IEG"/"WXG"/"无明确意向"等） | 📋常用 |
| `bg` | number | BG代码 | 🚫忽略 |
| `iDeptTxt` | string | 投递部门名称 | ⚪可选 |
| `iDeptId` | number | 部门ID | 🚫忽略 |
| `lockBgTxt` | string | 锁定BG名称 | ⚪可选 |
| `lockBg` | number | 锁定BG代码 | 🚫忽略 |
| `lockIDeptId` | number | 锁定部门ID | 🚫忽略 |
| `lockIDeptTxt` | string | 锁定部门名称 | ⚪可选 |

#### 七、城市&调配

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `expectWorkCityTxt` | string | 期望工作城市（"深圳总部,上海"） | 📋常用 |
| `recruitCityTxt` | string | 面试城市 | ⚪可选 |
| `recruitCity` | number | 面试城市代码 | 🚫忽略 |
| `isDeploy` | number | 是否服从调配（1=服从） | ⚪可选 |

#### 八、成绩&评测

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `rankLevelTxt` | string | 成绩排名文本（"前5%"/"前10%"等，可能为空） | 📋常用 |
| `rankLevel` | number | 排名等级代码 | 🚫忽略 |
| `rank` | number | 排名数值 | 🚫忽略 |
| `score` | number | 分数 | 🚫忽略 |
| `scoreType` | string | 分数类型 | 🚫忽略 |
| `assessScore` | number | 测评分数 | ⚪可选 |

#### 九、阅读&更新状态

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `updateTimeTxt` | string | 简历更新时间（"2026-03-02"） | 📋常用 |
| `updateTimeStr` | string | 更新时间描述（"2个月内更新过"） | ⚪可选 |
| `updateTime` | number | 更新时间戳 | 🚫忽略 |
| `numByRead` | number | 被查看次数 | ⚪可选 |
| `numByRemarked` | number | 被备注次数 | ⚪可选 |
| `isRead` | boolean | 是否已读 | ⚪可选 |
| `readTimeTxt` | string∣null | 阅读时间 | 🚫忽略 |
| `interviewTimeTxt` | string∣null | 面试时间 | ⚪可选 |

#### 十、其他标记

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `isFull` | number | 是否简历完整 | 🚫忽略 |
| `isPublic` | number | 是否公开 | 🚫忽略 |
| `cheatFlag` | number | 作弊标记 | 🚫忽略 |
| `badFlag` | number | 不良标记 | 🚫忽略 |
| `isFavorite` | boolean | 是否已收藏 | 🚫忽略 |
| `isSubscribe` | boolean | 是否已关注 | 🚫忽略 |
| `projectFlag` | boolean | 项目标记 | 🚫忽略 |
| `mobilePrev` | string | 前手机号 | 🚫忽略 |

#### 十一、可能为 null 的扩展字段

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `interviewRecordTag` | array∣null | 面试记录标签 | ⚪可选 |
| `otherHighlight` | array∣null | 其他亮点 | ⚪可选 |
| `educationList` | array∣null | 教育经历列表（通常为 null，需精读获取） | 🚫忽略 |
| `projectList` | array∣null | 项目经历列表（通常为 null，需精读获取） | 🚫忽略 |
| `workExperienceList` | array∣null | 工作经历列表（通常为 null，需精读获取） | 🚫忽略 |
| `images` | array∣null | 图片列表 | 🚫忽略 |

---

### ✅ 推荐提取字段组合（按场景）

#### 场景 A：通用筛选（最常用）

```
rid, name, school, speciality, educationTxt, stationTxt, schoolLevelTag, highlightTags, flowStatusTxt, expectWorkCityTxt
```

适用于：大多数筛选场景，快速浏览候选人概况。

#### 场景 B：侧重能力匹配

```
rid, name, school, speciality, educationTxt, stationTxt, schoolLevelTag, highlightTags, skillTag, rankLevelTxt, eduDepartment
```

适用于：需要关注技能标签和成绩排名的场景。

#### 场景 C：侧重部门/城市匹配

```
rid, name, school, speciality, educationTxt, stationTxt, schoolLevelTag, bgTxt, iDeptTxt, expectWorkCityTxt, flowStatusTxt, recruitProjectTxt
```

适用于：为特定BG/部门/城市筛选候选人的场景。

---

### 🛠️ 提取脚本模板

```python
# 粗读字段提取模板 — 场景 A（通用筛选）
import json, sys

data = json.load(sys.stdin)
resumes = data['data']['data']['list']
print(f"本页结果数: {len(resumes)}")
print()

for r in resumes:
    tags = ','.join(r.get('schoolLevelTag') or [])
    highlights = ','.join(r.get('highlightTags') or [])
    skills = ','.join(r.get('skillTag') or [])
    print(f"rid: {r['rid']}")
    print(f"  姓名: {r['name']} | 学校: {r['school']} | 专业: {r['speciality']} | 学历: {r['educationTxt']}")
    print(f"  岗位: {r['stationTxt']} | 状态: {r['flowStatusTxt']} | 期望城市: {r.get('expectWorkCityTxt','')}")
    print(f"  院校标签: {tags} | 亮点: {highlights}" + (f" | 技能: {skills}" if skills else ""))
    print()
```

---

### 生成简历详情页链接

使用返回的 `rid` 参数生成简历详情页链接：

**URL 模板（最简格式）**：
```
https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={rid}
```

**参数说明**：
- `rid`: 简历的 UUID（从搜索结果的 `list[].rid` 字段获取）⭐ **必需**

**⚠️ 注意**：
- `searchId` 和 `pi` 参数**可以省略**，不影响简历详情页的打开
- 最简格式只需要 `rid` 参数即可

**示例**：
```javascript
// 最简格式（推荐）
const resumeUrl = `https://zhaopin.woa.com/resume/campus/ResumeDetail?rid=4bbfc1da-7175-41fe-9b1a-bfb9b580ad45`;

// 批量生成所有简历的详情页链接
const resumeLinks = data.list.map(resume => ({
  name: resume.name,
  school: resume.school,
  url: `https://zhaopin.woa.com/resume/campus/ResumeDetail?rid=${resume.rid}`
}));
```

**完整格式（可选）**：
```
https://zhaopin.woa.com/resume/campus/ResumeDetail?rid={rid}&searchId={searchId}&pi={index}
```

如果需要保留搜索上下文，可以添加：
- `searchId`: 本次搜索的唯一ID（请求参数中的 `searchId`）
- `pi`: 简历在搜索结果中的索引位置（从1开始）

但在展示给用户时，**只需要提供 `rid` 参数的最简格式即可**。

## ⚠️ 注意事项

1. **必须先阅读筛选条件文档**：不要凭猜测填写参数！每个筛选条件的格式和取值方式都不同。**必须完整阅读相关文档**，不得跳过或只看部分内容。
2. **筛选逻辑**：
   - 同一筛选条件内：OR 逻辑（满足任意一个即可）
   - 不同筛选条件间：AND 逻辑（必须同时满足所有条件）
3. **空值表示不筛选**：空数组 `[]` 或 `null` 表示不限制该条件
4. **searchStrategy 固定**：`version: "V3", strategy: "strategy-V3"` 是固定值，不要修改
5. **毕业时间必需**：即使不关心毕业年份，也要提供一个范围（如2027-01-01至2027-12-31）
6. **⚠️ 获取结果后需要二次筛选**：
   - **第一步：粗读**搜索结果中的基本信息（学校、专业、成绩、竞赛等），筛选出优质候选人
   - **第二步：精读**筛选出的简历详情（项目、实习、技能），深度判断匹配度
   - 最终推荐最匹配的简历（≤10条），为每条生成匹配理由
7. **⚠️ 禁止生成文件**：
   - 不要生成任何产物文件（HTML/JSON/Excel/Markdown等）
   - 只能在对话中用 **Markdown 表格**展示筛选结果
   - 必须包含简历详情页链接和匹配理由

## 🔗 相关文档

- [简历筛选手册](../guides/resume-filtering-manual.md) - 完整的筛选流程指引
- [get-search-strategy](./get-search-strategy.md) - 获取搜索策略版本

## 🚀 mcporter 调用方式

通过 mcporter CLI 直接调用 recruit-mcp 的 CallAPI 接口：

```bash
# 基本搜索（使用默认参数）
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.post_v1_resume_search'

# 带筛选条件的搜索
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.post_v1_resume_search' params='{"keyword":"Python","page":1,"limit":20}'
```

> 💡 **说明**：
> - 所有搜索参数通过 `params` JSON 对象传递
> - 返回结果包含匹配的简历列表和总数
> - 无需浏览器导航或 JS 注入，直接调用即可
