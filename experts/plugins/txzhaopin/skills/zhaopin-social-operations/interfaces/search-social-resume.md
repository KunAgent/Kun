# interfaces/search-social-resume.md

社招简历搜索接口。

## 基本信息

- **apiId**: `recruit.social-resume.post_api_resume_query_query`
- **方法**: POST
- **说明**: 使用指定条件在社招简历库搜索
- **权限**: 需 `Recruit_SosoSearchNew` 权限

## 默认使用的搜索参数（脚本已固化）

> 本章节列出的参数是 `parallel_search.py` 构造 rounds 时会用到的字段。其他字段一律不用，避免画蛇添足。

### 硬约束类（用户明指必须照搬，不得扩展）

| 参数名 | 类型 | 说明 |
|---|---|---|
| `location` | string[] | 当前工作城市（ES: WorkPlace），列表元素为 OR 关系 |
| `expectLocation` | string[] | 期望工作城市。⚠️ **v6.1.0 起脚本会自动从 `location` 派生做双子请求 OR，不要手写** |
| `supportNoExpectCity` | bool | **v6.1.0 新增**。仅在 `expectLocation` 子请求中生效。true=同时纳入期望城市为空的候选；false/不传=只要明确期望匹配的。⚠️ 实测：单独配 `location` 不生效（见下方"城市字段实测结论"） |
| `workYearStart` | int | 工作年限下限（年） |
| `workYearEnd` | int | 工作年限上限（年） |
| `minDegree` | string | 最低学历："高中"/"本科"/"硕士"/"博士" |
| `schoolLevelTags` | string[] | 学校梯队：`C9`/`211`/`985`/`海外高校`/`港澳台院校`/`国内普通高校` |
| `ageStart` | int | 年龄下限 |
| `ageEnd` | int | 年龄上限 |
| `gender` | string | "男"/"女" |

### 城市字段实测结论（v6.1.0 / 2026-04-26）

| 参数组合 | 行为 |
|---|---|
| 只传 `location=[深圳]` | 过滤"当前城市=深圳"的候选 |
| 只传 `expectLocation=[深圳]` | 过滤"期望=深圳"的候选 |
| **同时传 `location` 和 `expectLocation`** | **AND 关系**（实测两字段都=深圳时 2487 人 < 只传 location 的 5915 人） |
| 单独传 `location` + `supportNoExpectCity` | 开关不生效（两值结果相同） |
| 单独传 `expectLocation` + `supportNoExpectCity=true` | 开关在 expectLocation 路生效 |

**结论**：需要 OR 效果，必须由脚本拆成双子请求分别查再客户端合并。`social_search.py` 已实现此逻辑。

### 公司类（用户明指则不扩展，用户未指则可补）

| 参数名 | 类型 | 说明 |
|---|---|---|
| `currentCompany` | string[] | **当前/最后一段工作经历**的公司（精准收口用） |
| `allCompany` | string[] | **所有工作过**的公司（扩展收口用） |

### 领域/技能/职位类（允许扩展）

| 参数名 | 类型 | 说明 |
|---|---|---|
| `searchKey` | **string** | 全文关键词（单字符串，多个词用**空格**分隔） |
| `searchKeyUseAnd` | bool | true=AND，false=OR（默认） |
| `positionTags` | string[] | 职位标签（可选值：后台/前端/硬件/测试/数据/运维/算法/产品经理/游戏策划/HRBP 等。完整可选值通过 `/api/resume_query/tag_suggest?dataType=position` 获取） |
| `skillTags` | string[] | 技能标签（通过 `tag_suggest?dataType=skill` 获取完整可选值） |

### 状态/分页类（强制默认值）

| 参数名 | 类型 | 说明 | 脚本默认值 |
|---|---|---|---|
| `locked` | int | 0=未锁定 1=锁定 | **0**（强制） |
| `from` | int | 起始行 | 0 |
| `size` | int | 每页条数（≤200） | 50 |
| `statusIds` | int[] | 1=待筛选/2=推荐中/.../7=其他 | 可不传 |
| `diggerSearchId` | string | **必传**随机 UUID，`mcp-recruit-xxx` 格式 | 脚本自动生成 |

## 返回结构

> ⚠️ **实测确认（2026-04-21）**：搜索接口返回的字段名是**小写驼峰**，不是大写首字母。下表为实际返回字段名。

### 顶层

```json
{
  "resumes": [...],       // 简历列表
  "totalCount": 150       // 总命中数（不是 TotalNum）
}
```

### 返回判断要点

- **总数字段**: `totalCount`（非 `TotalNum`）
- **简历 ID**: `rid`（非 `Rid`），UUID 格式
- **锁定判断**: 搜索参数 `locked: 0` 已过滤锁定简历；返回结果中 `atsRights` 非空 = 当前登录人无权限查看 → 在脚本中过滤
- **搜索高亮**: `highLightOthers`（非 `OtherHighlight`），是**对象数组**，每个对象含 `shortContent` / `allContent` 字段
- **分页重复**：多轮搜索必用 `rid` 去重（脚本已处理）

## 简历链接拼接格式

```
https://zhaopin.woa.com/resume/resume_detail?rid={rid}&fromplace=MCP
```

其中 `{rid}` = 搜索返回的 `data.resumes[].rid`（UUID）。`fromplace=MCP` 必带。

## 默认返回字段（粗读使用·实测字段名）

`mcp_client.py` 的 `slim_search_result()` 函数提取以下字段，**输出 key 与接口原始字段保持一致（小写驼峰）**：

| 字段名（小写驼峰） | 说明 |
|---|---|
| `rid` | 简历 UUID |
| `extId` | 扩展 ID |
| `resumeId` | 简历 ID |
| `name` | 姓名 |
| `gender` | 性别 |
| `age` | 年龄 |
| `workPlace` | 当前工作城市（可能含 HTML 高亮标签） |
| `expectWorkCitys` | 期望工作城市 |
| `lastEduLevel` | 最高学历 |
| `lastEduSchool` | 最高学历院校 |
| `lastEduMajorName` | 最高学历专业 |
| `lastEmployerName` | 最近雇主 |
| `lastEmployerTitle` | 最近职位 |
| `lastEmployerIndustry` | 最近行业 |
| `workYearsNumber` | 工作年限（数字） |
| `workYearsText` | 工作年限（文本） |
| `status` | 状态码 |
| `statusText` | 状态文本 |
| `locked` | 锁定标志 |
| `highLightOthers` | 搜索高亮（对象数组，含 shortContent / allContent） |
| `educationList` | 教育经历列表 |
| `updateTime` | 更新时间 |

教育列表子字段：`school`、`degree`、`major`、`is985`、`is211`、`isC9`、`overSea`

> ⚠️ **字段命名标准**：粗筛脚本 `rough_screen.py` 内部统一以**小写驼峰** key 读取本表字段；若修改 `slim_search_result()`，必须同步更新本表与 `rough_screen.py`。

## 调用方式

由 `scripts/social_search.py` + `scripts/mcp_client.py` 调用（Python 直接 JSON-RPC 调 MCP，不走 mcporter CLI）。

```bash
python3 {skillDir}/scripts/social_search.py --output candidates.jsonl
```

脚本内部自动处理：Token 三级回退发现、3 路并发搜索、去重、atsRights 过滤、字段精简、JSONL 落盘。
