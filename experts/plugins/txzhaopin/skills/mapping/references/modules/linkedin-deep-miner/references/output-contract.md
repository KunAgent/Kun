## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# 数据契约：linkedin-deep-miner → org-knowledge-base

> 本文档定义 linkedin-deep-miner 挖掘结果如何映射到 org-knowledge-base 的 JSON Schema。  
> 这是两个 Skill 之间的"接口规范"，必须严格遵守，否则数据无法流转。

---

## 一、整体数据流

```
linkedin-deep-miner Stage 4 输出
        │
        ▼
[LinkedIn Candidate 对象数组]
        │
        ▼ 字段映射（本文档定义）
        │
        ▼
[org-knowledge-base personnel 对象数组]
        │
        ▼ 写入
        │
        ▼
iWiki 用户目录/01-公司组织库/{company_id}.json
        │
        ▼ org-knowledge-base 渲染
        │
        ▼
iWiki 用户目录/01-公司组织库/{company_id} 的组织架构章节或附件
```

---

## 二、LinkedIn Candidate Schema（中间格式）

linkedin-deep-miner 在 Stage 4 输出的候选人对象格式：

```json
{
  "linkedin_slug": "david-hoyer-12345",
  "name": "David Hoyer",
  "name_zh": null,
  "current_title": "Executive Director",
  "title_abbr": "ED",
  "current_company": "Goldman Sachs",
  "company_id": "goldman-sachs",
  "department": "TMT",
  "team": null,
  "location": "Hong Kong",
  "education_hint": "LSE",
  "education_full": [
    {"school": "London School of Economics", "degree": null, "major": null}
  ],
  "previous_company_hint": "Citi",
  "work_history": [
    {"period": "至今", "company": "Goldman Sachs", "title": "Executive Director"},
    {"period": "至 2020", "company": "Citi", "title": null}
  ],
  "linkedin_url": "https://www.linkedin.com/in/david-hoyer-12345",
  "snippet_source": "David Hoyer | Executive Director at Goldman Sachs | Hong Kong | LSE...",
  "source_query": "site:linkedin.com/in \"Goldman Sachs\" \"TMT\" \"Hong Kong\"",
  "verified": true,
  "verified_via": "google_cache",
  "confidence": 0.92,
  "discovered_at": "2026-06-01T15:00:00+08:00"
}
```

---

## 三、字段映射表（核心规则）

| LinkedIn Candidate | → | org-knowledge-base personnel | 映射规则 |
|---|---|---|---|
| `linkedin_slug` | → | `id` | `"person-" + linkedin_slug.replace("-", "")` |
| `name` | → | `name` | 直接复制 |
| `name_zh` | → | `name_zh` | 中文名（如有） |
| `current_title` | → | `title` | 标准化为全称（用 title-mapping.md） |
| `title_abbr` | → | `title_abbr` | 直接复制 |
| `company_id` | → | （归属公司文件） | 决定写到哪个 JSON |
| `department` | → | `department_id` | 映射到 org_structure 中对应节点 ID |
| `team` | → | `team_id` | 映射到具体团队节点（可空） |
| `location` | → | `base_city` | 中英文规范化 |
| `education_hint` | → | `background_brief` | 拼接到背景简介 |
| `education_full` | → | `education` | 直接复制数组 |
| `work_history` | → | `work_history` | 直接复制数组 |
| `linkedin_url` | → | `linkedin_url`（新增字段） | 保留链接 |
| `snippet_source` | → | （进 update_history） | 不入主对象 |
| `source_query` | → | `discovery_query`（新增） | 记录命中 query |
| `verified` | → | `verified`（新增） | 验证状态 |
| `confidence` | → | `confidence`（新增） | 置信度 0~1 |
| `discovered_at` | → | `added_at` | 首次发现时间 |
| 固定值 | → | `source` | `"LinkedIn 自动挖掘"` |
| 固定值 | → | `inferred_reporting` | `true`（除非 Stage 5 验证了汇报关系） |

---

## 四、对 personnel schema 的扩展（新增字段）

为支持挖掘场景，对 org-knowledge-base 的 `personnel` 对象**新增以下字段**（向后兼容）：

```json
{
  "id": "person-davidhoyer12345",
  "name": "David Hoyer",
  "title": "Executive Director",
  "title_abbr": "ED",
  "department_id": "team-tmt",
  "team_id": null,
  "reporting_to": null,
  "reporting_type": "direct",
  "inferred_reporting": true,
  "base_city": "Hong Kong",
  "background_brief": "LSE · 前 Citi · 对接腾讯",
  "work_history": [...],
  "education": [...],
  "source": "LinkedIn 自动挖掘",
  "added_at": "2026-06-01T15:00:00+08:00",
  "updated_at": "2026-06-01T15:00:00+08:00",

  // ===== linkedin-deep-miner 新增字段 =====
  "linkedin_url": "https://www.linkedin.com/in/david-hoyer-12345",
  "discovery_query": "site:linkedin.com/in \"Goldman Sachs\" \"TMT\"",
  "verified": true,
  "verified_via": "google_cache",
  "confidence": 0.92,
  "discovery_method": "linkedin-deep-miner-v1.0"
}
```

---

## 五、增量合并规则

### 场景 1：新候选人（公司中不存在同名人员）
- 直接追加到 `personnel` 数组
- `source = "LinkedIn 自动挖掘"`

### 场景 2：已存在同名人员（人工录入或之前挖过）
**冲突检测优先级**：
1. **保护人工录入信息**：如已有人员 `source` 不是 LinkedIn 来源 → 仅补充 LinkedIn 拿到的、原本为空的字段
2. **更新 LinkedIn 来源信息**：如已有人员 `source` 也是 LinkedIn → 用新数据覆盖（信息可能更新）
3. **冲突字段记录**：写入 `update_history`：
   ```json
   {
     "timestamp": "2026-06-01T15:00:00+08:00",
     "source": "LinkedIn 自动挖掘",
     "changes": "更新 David Hoyer 职位：ED → Managing Director",
     "conflicts": [
       {"field": "title", "old": "ED", "new": "MD", "resolution": "采用新值（LinkedIn）"}
     ]
   }
   ```

### 场景 3：组织架构节点不存在
当 LinkedIn 候选人的 `department` 在现有 `org_structure` 找不到对应节点时：
- 自动创建新节点（type: `team` 或 `department`）
- 节点 ID 格式：`team-{部门拼音/英文}`
- 标注 `created_by_linkedin: true`

---

## 六、置信度处理规则

LinkedIn 挖掘的置信度会影响 org-knowledge-base 的展示：

| confidence 区间 | 处理 | 架构图标识 |
|---|---|---|
| 0.85 - 1.0 | 高置信，直接入库 | 正常人员节点 |
| 0.6 - 0.85 | 中置信，入库但标"待确认" | 节点加 ⚠️ 标记 |
| 0.4 - 0.6 | 低置信，入库到 candidates_pending 数组 | 不上架构图，仅列表 |
| < 0.4 | 不入库 | — |

**candidates_pending 字段**（新增到 company JSON 根级）：
```json
{
  "candidates_pending": [
    {
      "name": "...", 
      "confidence": 0.45,
      "reason": "snippet 信息不完整",
      "discovered_at": "..."
    }
  ]
}
```

用户可在后续手动确认后将其转为正式人员。

---

## 七、典型映射示例

### 示例 1：高置信完整候选人

**LinkedIn Candidate**：
```json
{
  "linkedin_slug": "david-hoyer",
  "name": "David Hoyer",
  "current_title": "Executive Director",
  "title_abbr": "ED",
  "current_company": "Goldman Sachs",
  "company_id": "goldman-sachs",
  "department": "TMT",
  "location": "Hong Kong",
  "education_hint": "LSE",
  "previous_company_hint": "Citi",
  "confidence": 0.92,
  "verified": true
}
```

**映射到 org-knowledge-base personnel**：
```json
{
  "id": "person-davidhoyer",
  "name": "David Hoyer",
  "title": "Executive Director",
  "title_abbr": "ED",
  "department_id": "dept-tmt",
  "base_city": "Hong Kong",
  "background_brief": "LSE · 前 Citi",
  "source": "LinkedIn 自动挖掘",
  "added_at": "2026-06-01T15:00:00+08:00",
  "linkedin_url": "https://www.linkedin.com/in/david-hoyer",
  "verified": true,
  "confidence": 0.92,
  "discovery_method": "linkedin-deep-miner-v1.0"
}
```

### 示例 2：低置信候选人（进 pending）

**LinkedIn Candidate**（confidence: 0.45）：
```json
{
  "name": "John Smith",
  "current_title": "VP",
  "current_company": "Goldman Sachs",
  "snippet_source": "John Smith | VP at investment bank...",
  "confidence": 0.45
}
```

**映射结果**（不上架构图）：
```json
// 写入 goldman-sachs.json 的 candidates_pending 数组
{
  "name": "John Smith",
  "linkedin_slug": null,
  "current_title": "VP",
  "confidence": 0.45,
  "reason": "snippet 未明确部门、地域，且未指明是否仍在 GS",
  "discovered_at": "2026-06-01T15:00:00+08:00",
  "discovery_query": "..."
}
```

---

## 八、给 org-knowledge-base 的扩展请求

为完整支持挖掘场景，org-knowledge-base 的 SKILL.md 需要做以下小改动（向后兼容）：

1. **新增字段支持**：`personnel` 对象额外字段 `linkedin_url`, `confidence`, `verified`, `discovery_method`, `discovery_query`
2. **新增数组**：公司根 JSON 增加 `candidates_pending[]` 字段
3. **HTML 渲染区分**：
   - 高置信人员：正常渲染
   - 中置信人员：节点右上角加 ⚠️ 角标
   - pending 人员：在架构图下方独立"待确认候选人"列表
4. **数据来源标注**：人员卡片底部显示 source（"沟通"/"LinkedIn 自动挖掘"）

这些改动**第一阶段不必立即实施**——只要本 Skill 按本契约写出 JSON，org-knowledge-base 兼容读取即可。完整可视化升级可在第二阶段做。
