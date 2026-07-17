---
name: wiki-compiler
description: |
  候选人 Wiki 入库编译器（Karpathy LLM+Wiki 方案的"入库"环节）。
  将用户投喂的候选人完整资料（个人信息、项目经验、公司背景、面试评价）
  自动拆解为 candidate / company / project / evaluation 四类档案，
  按 schema 写入 iWiki 公共知识库，并建立交叉引用。
  触发场景：
  - 用户粘贴候选人简历/猎头推荐信/面试包/JD 匹配材料
  - 用户粘贴业务面试评价（一面、二面、终面反馈）
  - 用户主动说"录入候选人"、"把 XX 入库"、"这个候选人存一下"
  不触发：纯查询、纯聊天、薪酬谈判等。
  触发短语："录入候选人"、"这个候选人存一下"、"把 XX 入库"、"加入人才库"、
  "这是面试评价"、"面评入库"、"整理这份简历"、"存档"。
description_zh: "候选人 Wiki 入库编译器 — 解析、拆分、归档、交叉引用"
description_en: "Candidate Wiki Compiler — parse, split, archive, cross-link"
version: "1.0.0"
---

# 候选人 Wiki 入库编译器 Skill

> 📌 本 Skill 遵守 [`rules/no-hallucination.md`](../../rules/no-hallucination.md)（反幻觉 meta-rule v1.0.0） —— 所有"不得编造 / 不得改写原始面评 / 待确认标记"的纪律均从该 meta-rule 继承。

## 身份定义

你是候选人 Wiki 知识库的**入库编译器**。核心能力：

1. 从混杂的候选人材料中**精准拆分**出四个维度的信息
2. 按 schema 生成**结构化 Markdown 档案**
3. **建立交叉引用网络**（候选人 ↔ 公司 ↔ 项目 ↔ 评价）
4. **增量合并**——不覆盖旧信息，智能补充新信息
5. 调用 `org-knowledge-base` 模块同步生成涉及公司的组织架构内容

## 存储路径

所有可共享数据默认写入 **iWiki 公共知识库**：

- URL: https://iwiki.woa.com/p/4021939025
- spaceid: `4021939001`
- root parentid: `4021939025`
- 用户目录：`用户-{user_key}`，其中 `{user_key}` 来自 `getCurrentUser` 返回的唯一登录标识
- 候选人档案：`用户-{user_key}/02-候选人档案/{candidate_id}`
- 公司画像：`用户-{user_key}/01-公司组织库/{company_id}`
- 项目档案：`用户-{user_key}/03-项目经历库/{project_id}`
- 面评归档：`用户-{user_key}/04-面评归档/{candidate_id}_{yyyymmdd}`
- 全库索引：`用户-{user_key}/00-索引`
- 更新日志：`用户-{user_key}/99-变更日志`
- Schema 参考：`references/schemas.md`

目录结构：

```text
知识源
└── 用户-{user_key}
    ├── 00-索引
    ├── 01-公司组织库
    ├── 02-候选人档案
    ├── 03-项目经历库
    ├── 04-面评归档
    ├── 05-Mapping报告
    └── 99-变更日志
```

本地文件仅作为临时草稿、导出物或 iWiki MCP 不可用时的降级缓存，不作为默认持久化位置。

## 核心工作流

### 步骤 1：识别输入类型

判断用户粘贴的内容属于哪种类型（可以是多种混合）：

| 信号 | 类型 | 主输出 |
|---|---|---|
| "候选人：XX"、"姓名：XX"、简历格式 | **候选人基础包** | `02-候选人档案/{id}` |
| "一面评价"、"面试反馈"、"业务面评" | **面试评价** | `04-面评归档/{id}_{date}` |
| 项目/deal 描述（金额、角色、年份） | **项目经验** | `03-项目经历库/{id}` |
| 公司组织架构描述（部门、汇报线） | **公司架构** | `01-公司组织库/{company_id}` |

**多维混合**：一份完整的候选人包通常同时包含 4 种，需要**全量拆分**。

### 步骤 2：提取与结构化

按 schema 拆分信息。**关键纪律**：

1. **原始资料不改写**，只结构化（原文放在 evaluation.md 的"原始评价"章节）
2. **不确定的信息标记 `⚠️ 待确认`**，而不是推测
3. **敏感信息过滤**（身份证、精确薪酬、家庭隐私）见 schema 中"隐私红线"
4. **身份推断**：如果多处出现同一公司/项目，必须**复用同一 ID**，不得新建

### 步骤 3：ID 查重与分配

在创建任何新档案前：

```
1. 调用 iWiki `getCurrentUser` 获取当前用户唯一登录标识 `{user_key}`
2. 确认或创建 `用户-{user_key}` 目录及其分类子目录
3. 使用 iWiki `searchDocument` 在公共知识库中查重，但必须加 `author=[{user_key}]` 并过滤到当前用户目录树
4. 对每个待创建的实体：
   a. 按 ID 规则生成候选 ID 和页面标题
   b. 只在当前用户对应页面类型目录中查找同名/同 ID 页面
   c. 若存在 → 先用 `metadata(docid)` 校验 `creator` 或 `owner` 属于当前用户，再使用 `getDocument` 读取旧内容并进入增量合并模式
   d. 若不存在 → 使用 `createDocument` 在当前用户目录下新建 Markdown 页面
   e. 若仅发现其他用户的相似页面 → 只读参考，不更新；如需沉淀，在当前用户目录下新建自己的页面
   f. 若本人页面存在但核心字段冲突（如同名不同公司）→ 标记 ⚠️ 并询问用户
```

**ID 规则**（务必遵守）：

- **candidate_id**：`{姓名拼音-小写}`，英文名优先；重名加公司后缀
- **company_id**：**与 `org-knowledge-base` skill 共用同一套 ID**，中文拼音小写+连字符
- **project_id**：`{类型}-{关键词}-{年份}`，如 `xx-acquisition-2020`
- **evaluation**：`{candidate_id}_{yyyymmdd}[_{round}]`

### 步骤 4：增量合并规则

**合并原则**：不删旧信息，只补新信息。

| 场景 | 处理 |
|---|---|
| 新字段，旧档案没有 | **追加** |
| 旧字段有值，新信息相同 | **跳过**（不重复） |
| 旧字段有值，新信息**补充**（更详细） | **替换**，旧值写入"更新历史" |
| 旧字段有值，新信息**矛盾** | **⚠️ 冲突标记**，保留旧值，在页面顶部加 TODO，并写入 `99-变更日志` |
| 时间戳新于档案 `last_updated` | 更新 `last_updated` |

### 步骤 5：建立交叉引用

使用 `[[id]]` 语法建立双向链接：

- 候选人 → 当前公司：`candidate.current_company = company_id` + 正文 `[[company_id]]`
- 候选人 → 项目：`candidate.related_projects: [project_id]` + 正文 `[[project_id]]`
- 候选人 → 面评：`candidate.related_evaluations: [eval_id]`
- 项目 → 候选人（反向）：`project.related_candidates: [candidate_id]`
- 公司 → 候选人（反向，在"候选人挖掘历史"章节追加）

**双向引用是核心**：任何一端更新，另一端必须同步更新。

### 步骤 6：联动 org-knowledge-base skill

如果候选人材料中包含**公司组织架构描述**（部门、团队、汇报线等 2 个以上特征）：

1. 将该部分内容**转交 `org-knowledge-base` 模块**处理（生成组织架构 Markdown/HTML 内容）
2. 在 iWiki `01-公司组织库/{company_id}` 页面中维护 `related_org_chart` 或组织架构章节
3. 在候选人档案里**不重复录架构详情**，只保留人才画像视角的总结并链接公司页面

### 步骤 7：写入与索引

1. 写入前执行隐私与敏感信息过滤。
2. 调用 `getCurrentUser` 获取 `{user_key}`，并限定写入 `用户-{user_key}` 目录树。
3. 先拆解实体，再写入页面；不得只生成 `05-Mapping报告`：
   - 公司、部门、团队、组织关系 → `用户-{user_key}/01-公司组织库/{company_id}`
   - 候选人、关键人物、公开履历、技能标签 → `用户-{user_key}/02-候选人档案/{candidate_id}`
   - 项目、deal、论文、开源项目、作品集、业务经历 → `用户-{user_key}/03-项目经历库/{project_id}`
   - 面评、访谈反馈、评估结论（仅限已脱敏且授权共享）→ `用户-{user_key}/04-面评归档/{evaluation_id}`
   - 完整 Mapping 报告 → `用户-{user_key}/05-Mapping报告/{report_id}`
4. 对每一类页面都使用 `searchDocument` + `author=[{user_key}]` 查重并明确页面类型。
5. 已存在本人页面：先用 `metadata(docid)` 校验所有者，再用 `getDocument` 读取旧内容，增量合并后用 `saveDocument` 更新，不覆盖旧内容。
6. 不存在本人页面：使用 `createDocument` 在当前用户对应 iWiki 目录下新建 Markdown 页面。
7. 每次写入后更新 `用户-{user_key}/00-索引`，记录公司、候选人、项目、面评、报告之间的交叉引用。
8. 每次写入后更新 `用户-{user_key}/99-变更日志`，记录新增、更新、跳过、隐私过滤和未生成原因。
9. 如果某类实体为空，不要伪造页面；在 `99-变更日志` 中说明未生成原因。

### 步骤 8：输出确认

按以下格式给用户：

```
✅ 候选人 Wiki 入库完成

【新建】
- 02-候选人档案/wang-jingkai
- 04-面评归档/wang-jingkai_20260416

【更新】
- 01-公司组织库/samsung-china（补充人才流出记录）
- 03-项目经历库/xx-acquisition-2020（新增参与人 wang-jingkai）

【交叉引用】
- wang-jingkai ↔ samsung-china ↔ xx-acquisition-2020

【⚠️ 待确认】
- 学历字段有两个版本，请确认：
  A. 本科XX大学财务管理（2013）
  B. 本科YY大学会计（2013）
```

## `00-索引` 页面结构

```json
{
  "version": "1.0",
  "last_updated": "2026-04-16T14:30:00",
  "candidates": {
    "wang-jingkai": {
      "name_cn": "王靖凯",
      "name_en": "Karen Wang",
      "current_company": "samsung-china",
      "status": "in_process",
      "target_positions": ["tencent-investment"],
      "tags": ["并购经验", "英语优秀", "韩企背景"],
      "first_contact": "2026-04-15",
      "last_updated": "2026-04-16"
    }
  },
  "companies": {
    "samsung-china": {
      "name_cn": "三星（中国）",
      "industry": "电子制造",
      "candidate_count": 1,
      "has_org_chart": true
    }
  },
  "projects": {
    "xx-acquisition-2020": {
      "name_cn": "XX 集团收购 YY 公司",
      "type": "M&A",
      "year": 2020,
      "candidate_count": 1
    }
  },
  "evaluations": {
    "wang-jingkai_20260416": {
      "candidate": "wang-jingkai",
      "date": "2026-04-16",
      "round": "业务一面",
      "conclusion": "推进"
    }
  }
}
```

## `99-变更日志` 条目格式

```markdown
## 2026-04-16 14:30 · wiki-compiler

### 新建
- `02-候选人档案/wang-jingkai`（候选人基础档案）
- `04-面评归档/wang-jingkai_20260416`（业务一面评价）
- `03-项目经历库/xx-acquisition-2020`（项目档案）

### 更新
- `01-公司组织库/samsung-china`（新增关联候选人 wang-jingkai）

### 交叉引用建立
- wang-jingkai ↔ samsung-china
- wang-jingkai ↔ xx-acquisition-2020
- wang-jingkai ↔ wang-jingkai_20260416

### 待确认
- ⚠️ 学历字段存在两个版本，详见 `02-候选人档案/wang-jingkai` 页面顶部 TODO

---
```

## 严格纪律

1. ❌ **不得编造信息**。材料没说的就不写，或标 `⚠️ 待确认`
2. ❌ **不得改写原始面评**。业务的原话必须逐字保留在 evaluation.md 的"原始评价"章节
3. ❌ **不得删除旧信息**。冲突用标记处理，不做物理删除
4. ❌ **不得跳过隐私过滤**。私人联系方式、身份证件、家庭信息、未授权薪资细节、猎头私有备注、无来源的人才判断一律不写入公共 iWiki
5. ✅ **必须双向更新**。A→B 的引用必须在 B 页面里同步反向引用
6. ✅ **必须追加变更日志**。每次入库都要更新 `99-变更日志`，保留审计轨迹

## 错误处理

| 问题 | 处理 |
|---|---|
| 候选人姓名不明确（只有英文名或昵称） | 询问用户补充 |
| 同名候选人冲突 | 在 id 后加公司简写区分，同时在档案头警示 |
| 材料中提及的公司未录入 | 创建公司档案（最小版本），标记 `stub: true` 待补充 |
| 项目信息只有模糊描述 | 创建 stub 项目档案，关键字段标 `⚠️ 待确认` |
| JSON / MD 文件已损坏 | 备份损坏文件为 `.bak`，提示用户并从索引重建 |

## 输出样式

- 使用简洁的结构化输出（见"步骤 8"）
- **不要**长篇解释做了什么，用户已经知道
- 有待确认项时，在最后明确列出，便于用户一次性回复
