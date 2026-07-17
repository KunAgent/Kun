# 获取简历基本信息接口 📄

通过简历UUID (rid) 获取候选人的基本信息。

## 🚨 使用前自检（CRITICAL）

**在调用此接口前，请完成以下自检**：

- [ ] 我已理解此接口**必须使用GET方法** ⚠️
- [ ] 我已准备好rid列表
- [ ] 我已准备好批量获取的代码（含错误处理和间隔）
- [ ] 我已理解要读取哪些字段（resume_intern_exp/resume_project）
- [ ] 我已理解"通过验证"的标准
- [ ] 我已使用 mcporter call recruit-mcp CallAPI 方式调用接口 ⚠️
- [ ] 我已使用「三步模式」：发请求→wait→读结果 ⚠️
- [ ] 我已对 API 返回字段做防御性编程（null/undefined 检查） ⚠️
- [ ] 批量获取已分批（每批≤6条），批次间隔≥2秒 ⚠️

**✅ 只有全部勾选，才能继续！**

---

### 🔴 多个数组/对象字段可能为 null（CRITICAL — 必须防御）

以下字段在接口文档中标注为 array 或 string[] 类型，但 **实际 API 返回中可能为 `null`**，直接对 `null` 值进行 `len()`、切片 `[:N]`、`for...in` 迭代等操作会导致 `TypeError`：

| 字段 | 文档类型 | 实际可能值 | 触发场景 |
|------|----------|-----------|----------|
| `skillTag` | string[] | `null` | 候选人无技能标签时 |
| `resume_intern_exp` | array | `null` | 候选人无实习经历时 |
| `resume_project` | array | `null` | 候选人无项目经历时 |
| `tagTxtList` | string[] | `null` | 少数情况下 |
| `resumePrizes` | array | `null` | 候选人无获奖时 |

**✅ 正确的防御写法**：
```python
# ❌ 错误 — 如果值是 None 会抛出 TypeError
skills = resume_info.get('skillTag', [])
for s in skills[:3]:  # TypeError: 'NoneType' object is not subscriptable

# ✅ 正确 — 使用 `or []` 将 None 转为空列表
skills = resume_info.get('skillTag') or []
for s in skills[:3]:  # 安全
```

> `dict.get(key, default)` 只在 key **不存在**时返回 default；如果 key 存在但值为 `None`，仍返回 `None`。
> 因此必须用 `or []` 兜底。

---

## ⚠️ 常见错误

### ❌ 错误1：使用POST方法
```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId'
```

### ✅ 正确方式：使用GET方法
```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId'
```

**🔴 重要**：如果你使用POST，接口将返回405错误！

---

## 📋 接口信息

| 项目 | 值 |
|------|-----|
| **路径** | `/resume/campus/api/v1/resume/getResumeByRid` |
| **方法** | `GET` |
| **认证** | ✅ 需要（Cookie认证） |

## 📥 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `rid` | `string` | ✅ | 简历UUID（从搜索结果或URL中获取） |

**示例**:
```
GET /resume/campus/api/v1/resume/getResumeByRid?rid=d4f583bb-5d2d-4662-be77-2b73ec8e15e5
```

## 📤 返回数据

> 🔴 **关键提醒**：实际取值路径为 `response.data.data.resumeInfo`（两层 `data`）。
>
> ⚠️ `resumeInfo.school` 和 `resumeInfo.education` 可能为 `null`，需从 `education_list` 获取。
>
> ⚠️ `resumeInfo.name` 可能为 `*****`，此时应使用搜索接口返回的姓名（搜索接口的 `name` 字段始终有值），通过 `rid` 关联。

---

### 🔴 精读字段选择策略（CRITICAL — 必须遵守）

**返回的 `resumeInfo` 包含 125 个字段，绝大多数对筛选无用。直接输出完整返回会浪费大量上下文。**

**精读前必须执行以下步骤**：
1. **根据本次筛选需求，从下方字段表中自行确定需要提取的字段**
2. **编写提取脚本，只提取选定字段**，不要把完整 JSON 返回到对话上下文
3. **长文本字段**（`work_summary`/`proj_summary`）截取前 150 字
4. **实习/项目经历只提取最近 2 段**，更早的经历跳过
5. **教育经历只提取最高学历**，本科信息仅在需要校验学校时提取
6. **严禁**直接将 mcporter 返回的完整 JSON 作为精读结果

---

### 📊 完整字段清单 & 推荐等级

> **推荐等级说明**：⭐必看 = 几乎每次精读都需要；📋常用 = 根据需求选用；⚪可选 = 特殊场景才需要

#### 一、基本信息（resumeInfo 顶层字段）

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `rid` | string | 简历UUID | ⭐必看 |
| `id` / `resume_id` | string | 简历数字ID | ⚪可选 |
| `name` | string | 姓名（精读接口可能为 `*****`，应优先使用搜索接口的姓名） | ⭐必看 |
| `sex` | string | 性别 | ⚪可选 |
| `highest_school` | string | 最高学历学校 | ⭐必看 |
| `highest_education` | string | 最高学历（硕士研究生/博士研究生） | ⭐必看 |
| `speciality` | string | 专业名称 | ⭐必看 |
| `graduate_time` | string | 毕业时间（`YYYY-MM-DD HH:mm:ss`） | 📋常用 |
| `station_txt` | string | 投递岗位名称 | ⭐必看 |
| `station` | string | 投递岗位ID | ⚪可选 |
| `flow_txt` | string | 流程状态（待筛选/面试中等） | 📋常用 |
| `bg_txt` | string | 投递BG（如 "TEG"） | 📋常用 |
| `idept_ex_txt` | string | 投递部门详情 | 📋常用 |
| `expect_work_city_txt` | string | 期望工作城市 | ⚪可选 |
| `recruit_project_txt` | string | 招聘项目（校招/实习） | 📋常用 |
| `latestPositionTitle` | string | 最近实习职位名称 | 📋常用 |
| `latestEmployerName` | string | 最近实习公司名称 | 📋常用 |
| `other_info` | string | 自我评价/技能描述 | 📋常用 |
| `foreign_language_txt` | string | 外语水平（CET-4/CET-6） | ⚪可选 |
| `foreign_language_score` | string | 外语成绩 | ⚪可选 |
| `pratice_time_txt` | string | 可实习时长 | ⚪可选 |
| `week_attendance_day` | number | 每周可出勤天数 | ⚪可选 |
| `is_deploy` | string | 是否服从调配 | ⚪可选 |
| `school` | null/string | ⚠️ 常为 null，用 `highest_school` 代替 | — |
| `education` | null/string | ⚠️ 常为 null，用 `highest_education` 代替 | — |

#### 二、标签 & 技能

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `tagTxtList` | string[]∣null | 院校标签（985/211/C9/QS100等），⚠️ 可能为 null | ⭐必看 |
| `skillTag` | string[]∣null | 技能标签（NLP/LLM/python等），⚠️ 可能为 null | ⭐必看 |
| `dev_language` | object[] | 编程语言 `[{language_name}]` | ⚪可选 |

#### 三、教育经历（`education_list` 数组）

| 子字段 | 类型 | 说明 | 推荐 |
|--------|------|------|------|
| `school` | string | 学校名称 | ⭐必看 |
| `department` | string | 院系 | 📋常用 |
| `speciality` | string | 专业 | ⭐必看 |
| `edu_txt` | string | 学历文本（本科/硕士研究生/博士研究生） | ⭐必看 |
| `school_rank_txt` | string | 成绩排名（前5%/前10%/前20%/其他） | ⭐必看 |
| `gpa` | number | GPA 分数 | 📋常用 |
| `gpaBase` | number | GPA 满分（4/5/100） | 📋常用 |
| `lab` | string | 实验室名称 | 📋常用 |
| `master` | string | 导师姓名 | ⚪可选 |
| `direction` | string | 研究方向 | 📋常用 |
| `paper` | string | 论文信息（⚠️ 重要！含发表期刊） | ⭐必看 |

#### 四、实习经历（`resume_intern_exp` 数组，⚠️ 可能为 null）

| 子字段 | 类型 | 说明 | 推荐 |
|--------|------|------|------|
| `employer_name` | string | 实习公司 | ⭐必看 |
| `position_title` | string | 实习职位 | ⭐必看 |
| `work_start_date_str` | string | 开始时间 | 📋常用 |
| `work_end_date_str` | string | 结束时间（"至今"=在实习） | 📋常用 |
| `work_summary` | string | 工作描述（⚠️ 可能很长，建议截取前 200 字） | ⭐必看 |

#### 五、项目经历（`resume_project` 数组，⚠️ 可能为 null）

| 子字段 | 类型 | 说明 | 推荐 |
|--------|------|------|------|
| `project_name` | string | 项目名称 | ⭐必看 |
| `proj_role` | string | 项目角色 | 📋常用 |
| `proj_start_date_str` | string | 开始时间 | ⚪可选 |
| `proj_end_date_str` | string | 结束时间 | ⚪可选 |
| `proj_summary` | string | 项目描述（⚠️ 可能很长，建议截取前 200 字） | ⭐必看 |

#### 六、其他

| 字段 | 类型 | 说明 | 推荐 |
|------|------|------|------|
| `resumePrizes` | array/null | 获奖列表 | 📋常用 |
| `award` | string | 获奖信息文本 | 📋常用 |
| `scholarship` | string | 奖学金信息 | ⚪可选 |
| `student_leader` | string | 学生干部经历 | ⚪可选 |

---

### ✅ 推荐提取字段组合（按场景）

#### 场景 A：AI/NLP/大模型方向筛选（最常用）

```
resumeInfo: highest_school, highest_education, speciality, station_txt, flow_txt, tagTxtList, skillTag, latestEmployerName, latestPositionTitle
education_list[]: school, speciality, edu_txt, school_rank_txt, gpa, gpaBase, paper, lab
resume_intern_exp[](最近2段): employer_name, position_title, work_start_date_str, work_end_date_str, work_summary(前150字)
resume_project[](最近2段): project_name, proj_role, proj_summary(前150字)
```

#### 场景 B：快速初筛（只看院校+经历概要）

```
resumeInfo: highest_school, highest_education, speciality, station_txt, tagTxtList, skillTag, latestEmployerName
education_list[]: school, edu_txt, school_rank_txt, paper
```

#### 场景 C：深度技术匹配

```
在场景 A 基础上，额外关注:
resumeInfo: other_info, dev_language, ai_skill
education_list[]: lab, direction, paper（完整内容）
resume_intern_exp[]: work_summary（完整内容）
resume_project[]: proj_summary（完整内容）
```

---

### 失败响应

```json
{
  "msg": "简历不存在或无权限查看",
  "code": 404,
  "data": null
}
```

## 💡 使用示例

### 示例1：在浏览器 Console 中调用

```bash
# 简历基本信息
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId'
```

### 示例2：从搜索结果获取简历详情

```bash
# 简历基本信息
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId'
```

### 示例3：获取 resumeId 用于后续调用

```bash
# 简历基本信息
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId'

# 联系方式
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_resume_getResumeContactInfo'
```

## 🔗 相关接口

- [`get-resume-contact-info`](./get-resume-contact-info.md) - 获取完整联系方式（需要权限）
- [`get-quality-assessment`](./get-quality-assessment.md) - 获取AI质量评估
- [`get-resume-scores`](./get-resume-scores.md) - 获取简历评分
- [`get-assess-list`](./get-assess-list.md) - 获取测评记录
- [`get-interview-records`](./get-interview-records.md) - 获取面试记录
- [`search-campus-resume`](./search-campus-resume.md) - 简历搜索接口（返回 rid）

## ⚠️ 注意事项

1. **认证要求**: 必须已登录招聘系统，携带有效的 Cookie
2. **rid vs resumeId**: 
   - `rid` 是 UUID 格式的字符串，用于URL和前端路由
   - `resumeId` 是数字ID，用于大部分后端API
   - 本接口是从 `rid` 转换到 `resumeId` 的桥梁
3. **联系方式脱敏**: 手机号和邮箱在此接口中是脱敏显示的
4. **权限控制**: 需要有查看简历的权限
5. **批量获取规范（CRITICAL）**: 
   - **严禁** 使用 `Promise.all` 一次性并行请求所有简历！会被服务端限流或超时
   - 必须 **分批串行**：每批 5-6 条，批次间隔 2-3 秒
   - 每批请求使用不同的 `window._xxx` 变量名存储结果（如 `window._batch1`、`window._batch2`）
   - 失败的请求记录 rid，全部批次完成后统一重试

### 📋 批量获取正确模板

```bash
# === 批量获取简历详情 ===
# 逐条获取（每条间隔 1-2 秒，避免限流）

# 获取单条简历基本信息
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId' params='{"rid":"<简历rid>"}'

# 获取联系方式
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_resume_getResumeContactInfo' params='{"resumeId":"<简历rid>"}'

# 批量场景：循环调用上述命令，每批 5-6 条，批次间隔 2-3 秒
```

## 🤔 常见问题

**Q: rid 和 resumeId 有什么区别？**

A: 
- `rid` 是 UUID 格式（如 `d4f583bb-5d2d-4662-be77-2b73ec8e15e5`），用于URL和前端
- `resumeId` 是数字ID（如 `3547501`），用于后端API
- 通过本接口可以从 `rid` 获取 `resumeId`

**Q: 为什么联系方式是脱敏的？**

A: 这是初步信息接口，要获取完整联系方式需要调用专门的接口并通过权限验证。

**Q: 如果简历不存在会返回什么？**

A: 返回 404 状态码，`msg` 字段会说明原因（简历不存在或无权限查看）。

**Q: 可以通过 resumeId 直接获取简历信息吗？**

A: 本接口只支持 `rid` 参数。如果已有 `resumeId`，可以直接调用其他详情接口。

## 📖 相关文档

- [简历详情接口分析报告](../reports/resume-detail-apis.md) - 完整的简历详情接口清单
- [简历筛选手册](../guides/resume-filtering-manual.md) - 返回筛选导航
