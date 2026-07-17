## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# ArtStation → org-knowledge-base 数据契约

本契约定义如何把 ArtStation 搜索结果转换为 `org-knowledge-base` 知识库可消费的 JSON 格式，实现游戏/影视美术人才与组织架构的统一沉淀。

---

## 一、契约总览

```
ArtStation 搜索结果（Excel/JSON）
        ↓
to_mapping_kb.py（转换器）
        ↓
{workspace}/iWiki 用户目录/01-公司组织库/{company_id}.json
{workspace}/iWiki 用户目录/01-公司组织库/{company_id}.html
        ↓
org-knowledge-base 自动渲染树形架构图
```

---

## 二、公司维度组织规则（按工作室）

ArtStation 搜索结果中的"工作室"信息从以下字段推断：

| ArtStation 字段 | 提取规则 | 示例 |
|----------------|---------|------|
| `headline` | 解析"@" 或 "at" 之后的内容 | "Concept Artist at miHoYo" → 工作室 = miHoYo |
| `headline` | 中文 "在 XX 工作 / XX 公司" | "在腾讯天美工作的 3D 艺术家" → 工作室 = 腾讯天美 |
| `about` | 简介中提到的雇主信息 | "Currently working at Naughty Dog..." → 工作室 = Naughty Dog |
| **未识别** | 标记为 `freelancer` | 自由职业艺术家分到独立公司 `freelance-artists` |

**company_id 命名规范**：
- 工作室名小写 + 中划线连接：`mihoyo` / `tencent-tianmei` / `naughty-dog`
- 自由艺术家统一池：`freelance-artists`
- 其他无法识别归属：`unknown-studio-{n}`

---

## 三、组织架构生成规则（按工种分组）

每个工作室的 `org_structure` 按以下美术工种自动分组：

```
{工作室名}（公司）
├── Concept Art（部门）
│   ├── Character Concept（团队）
│   ├── Environment Concept（团队）
│   └── Prop / Vehicle / Weapon Concept（团队）
├── 3D Art（部门）
│   ├── Character Modeling（团队）
│   ├── Environment Art（团队）
│   ├── Hard Surface（团队）
│   └── Texture / Material（团队）
├── 2D Illustration（部门）
│   ├── Original Painting（团队）
│   └── Marketing Art（团队）
├── Animation（部门）
├── VFX（部门）
├── Lighting（部门）
└── UI/UX（部门）
```

**工种识别（从 skills + headline 多源）**：
| 关键词（不区分大小写） | 归属部门 | 归属团队 |
|---------------------|---------|---------|
| concept art / 概念设计 | Concept Art | Character Concept / Environment Concept |
| character concept / 角色原画 | Concept Art | Character Concept |
| environment concept / 场景原画 | Concept Art | Environment Concept |
| 3D character / character modeling / 角色建模 | 3D Art | Character Modeling |
| environment artist / 场景艺术家 | 3D Art | Environment Art |
| hard surface | 3D Art | Hard Surface |
| texture / material / substance | 3D Art | Texture / Material |
| illustration / 插画 | 2D Illustration | Original Painting |
| animator / animation / 动画 | Animation | （工种为团队）|
| VFX / 特效 | VFX | （工种为团队）|
| lighting | Lighting | （工种为团队）|
| UI / UX | UI/UX | （工种为团队）|

无法识别工种 → 归到 `Other`

---

## 四、人员字段映射（ArtStation API → personnel）

| ArtStation 字段 | personnel 字段 | 转换规则 |
|----------------|----------------|---------|
| `id` | `id` | `"artist-{username}"` |
| `full_name` | `name` | 直接映射 |
| `username` | `username` | 直接映射，用于回链 |
| `headline` | `title` | 直接映射（原始）|
| `headline` | `title_abbr` | 提取职级缩写：Senior/Lead/Principal/Junior 等 |
| 解析 | `department_id` | 按工种识别（见上表） |
| 解析 | `team_id` | 按工种识别（见上表） |
| `country` + `city` | `base_city` | `"{city}, {country}"` |
| `headline` + `about` | `background_brief` | 拼接 + 截断到 120 字 |
| `permalink` | `source_urls[0]` | 主页链接 |
| `email` (子域名提取) | `contact_email` | 真实邮箱（如有） |
| `qq` / `wx` / `weibo` | `contact_chinese` | 中国艺术家额外联系方式 |
| `skills[]` + `software[]` | `skills` | 数组 |
| `followers_count` | `followers_count` | 数值 |
| `social_profiles[]` | `social_profiles` | 数组（含 LinkedIn/Twitter） |
| - | `source` | 固定 `"artstation-talent-finder v1.0"` |
| - | `confidence` | API 数据 = `"high"` |
| - | `added_at` / `updated_at` | 当前时间 ISO8601 |

---

## 五、JSON 输出标准格式

### 单个工作室文件（如 `mihoyo.json`）

```json
{
  "company_id": "mihoyo",
  "name": "米哈游",
  "name_en": "miHoYo",
  "aliases": ["miHoYo", "米哈游", "mhy", "HoYoverse"],
  "industry": "Game",
  "sub_industry": "AAA Game / Mobile Game",
  "headquarters": "Shanghai",
  "description": "AAA 游戏研发 · 旗舰项目《原神》《崩坏：星穹铁道》《绝区零》",
  "created_at": "2026-06-05T17:04:00+08:00",
  "updated_at": "2026-06-05T17:04:00+08:00",
  "update_history": [
    {
      "timestamp": "2026-06-05T17:04:00+08:00",
      "source": "artstation-talent-finder v1.0（首次实跑）",
      "changes": "ArtStation 搜索关键词 'character concept shanghai' + '角色原画' 共找到 18 位归属 miHoYo 的艺术家"
    }
  ],
  "org_structure": {
    "id": "root",
    "name": "miHoYo",
    "type": "company",
    "children": [
      {
        "id": "dept-concept-art",
        "name": "Concept Art",
        "type": "department",
        "children": [
          {"id": "team-character-concept", "name": "Character Concept", "type": "team", "children": []},
          {"id": "team-environment-concept", "name": "Environment Concept", "type": "team", "children": []}
        ]
      },
      {
        "id": "dept-3d-art",
        "name": "3D Art",
        "type": "department",
        "children": [
          {"id": "team-character-modeling", "name": "Character Modeling", "type": "team", "children": []}
        ]
      }
    ]
  },
  "personnel": [
    {
      "id": "artist-zhang_artist",
      "name": "张三",
      "username": "zhang_artist",
      "title": "Senior Character Concept Artist at miHoYo",
      "title_abbr": "Senior",
      "department_id": "dept-concept-art",
      "team_id": "team-character-concept",
      "base_city": "Shanghai, China",
      "background_brief": "10 years concept art exp · 原神角色原画 · 风格：写实+东方奇幻",
      "skills": ["Concept Art", "Character Design", "Photoshop", "ZBrush"],
      "followers_count": 45000,
      "contact_email": "zhang@email.com",
      "contact_chinese": "QQ:12345678",
      "social_profiles": [
        {"type": "twitter", "url": "https://twitter.com/zhang_artist"}
      ],
      "source": "artstation-talent-finder v1.0",
      "source_urls": ["https://www.artstation.com/zhang_artist"],
      "confidence": "high",
      "added_at": "2026-06-05T17:04:00+08:00",
      "updated_at": "2026-06-05T17:04:00+08:00"
    }
  ],
  "notes": [
    {"content": "ArtStation 检索时间：2026-06-05，搜索关键词覆盖 character concept / 角色原画 / shanghai", "source": "artstation-talent-finder"}
  ]
}
```

---

## 六、增量合并规则

当 `{company_id}.json` 已存在时，转换器执行以下合并逻辑：

1. **去重 personnel**：
   - 若 `username` 相同 → 跳过新增，但允许更新 `followers_count` / `skills` / `email` 字段
   - 若 `username` 不同但 `name` 同 → 标记为 `pending-review`，写入 `open_questions`
2. **合并 org_structure**：
   - 部门/团队节点不存在则新增
   - 已存在则保留
3. **追加 update_history**：
   - 每次执行追加一条记录，含时间戳 + 关键词 + 新增/更新人数
4. **保留旧字段**：
   - 来自其他 Skill（如 linkedin-deep-miner）的 personnel 不被覆盖
   - 通过 `source` 字段区分数据来源

---

## 七、跨 Skill 联动（与 linkedin-deep-miner）

如果某工作室同时被两个 Skill 挖过：

```
LinkedIn 挖到的：Art Director / Lead Artist （Senior 层）
        ↓ 入库到 mihoyo.json (department_id="leadership-art")
ArtStation 挖到的：Concept Artist / 3D Artist （执行层）
        ↓ 入库到 mihoyo.json (department_id="dept-concept-art" 等)

→ 同一 JSON 文件，不同 source 字段区分
→ 生成 HTML 时呈现完整组织架构（管理层 + 执行层）
```

---

## 八、HTML 渲染要求

调用 `org-knowledge-base/scripts/generate-chart.md` 中的标准模板，新增**美术行业专属节点样式**：

- 美术节点底色：浅紫色 `#e9d5ff`
- 邮箱标识：节点底部 ✉ icon
- 高粉丝（>10k）标识：节点右上角 ⭐
- 自由职业标识：节点边框虚线

---

## 九、错误降级

| 场景 | 处理 |
|------|------|
| ArtStation 搜索结果为空 | 不创建 JSON 文件，直接告诉用户"无结果"|
| 工作室无法识别 | 全部归到 `freelance-artists.json` |
| 邮箱提取失败 | `contact_email` 字段留空，不影响入库 |
| 已有 JSON 文件被锁 | 写入 `.tmp` 后再 rename |
| 多人同名不同 username | 全部入库，但写入 `notes` 提示去重 |
