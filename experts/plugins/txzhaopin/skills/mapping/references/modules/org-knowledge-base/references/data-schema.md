## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# 组织架构知识库 — JSON 数据结构定义

## 00-索引 — 索引文件

```json
{
  "version": "1.0",
  "last_updated": "2026-04-16T16:00:00+08:00",
  "companies": [
    {
      "company_id": "yunfeng",
      "name": "云峰基金",
      "name_en": "Yunfeng Capital",
      "industry": "PE/VC",
      "created_at": "2026-04-16T16:00:00+08:00",
      "updated_at": "2026-04-16T16:00:00+08:00",
      "personnel_count": 3,
      "department_count": 3
    }
  ]
}
```

## {company_id}.json — 公司数据文件

### 完整结构

```json
{
  "company_id": "yunfeng",
  "name": "云峰基金",
  "name_en": "Yunfeng Capital",
  "aliases": ["云峰"],
  "industry": "PE/VC",
  "sub_industry": "综合型PE",
  "headquarters": "上海",
  "description": "综合型PE基金，覆盖科技、消费、医疗三大行业",
  "created_at": "2026-04-16T16:00:00+08:00",
  "updated_at": "2026-04-16T16:00:00+08:00",
  "update_history": [
    {
      "timestamp": "2026-04-16T16:00:00+08:00",
      "source": "候选人沟通 - 金笑健",
      "changes": "初始录入：科技组架构、人员信息"
    }
  ],
  "org_structure": {
    "id": "root",
    "name": "云峰基金",
    "type": "company",
    "headcount": null,
    "children": [
      {
        "id": "dept-tech",
        "name": "科技组",
        "type": "department",
        "headcount": "10+",
        "headcount_note": "10+人",
        "children": [
          {
            "id": "team-software-ai",
            "name": "软件+AI应用赛道",
            "type": "team",
            "headcount": null,
            "children": []
          },
          {
            "id": "team-hardware-semi",
            "name": "硬件半导体赛道",
            "type": "team",
            "headcount": null,
            "note": "有2个SA+1个ED，平行汇报给合伙人",
            "children": []
          },
          {
            "id": "team-auto-energy",
            "name": "汽车新能源赛道",
            "type": "team",
            "headcount": null,
            "children": []
          }
        ]
      },
      {
        "id": "dept-consumer",
        "name": "消费组",
        "type": "department",
        "headcount": null,
        "children": []
      },
      {
        "id": "dept-healthcare",
        "name": "医疗组",
        "type": "department",
        "headcount": null,
        "children": []
      }
    ]
  },
  "personnel": [
    {
      "id": "person-jinxiaojian",
      "name": "金笑健",
      "title": "Senior Associate",
      "title_abbr": "SA",
      "department_id": "dept-tech",
      "team_id": "team-hardware-semi",
      "reporting_to": "合伙人",
      "reporting_type": "parallel",
      "inferred_reporting": false,
      "base_city": "上海",
      "background_brief": "上交管理学本·北大金融硕",
      "work_history": [
        {
          "period": "2020.6-至今",
          "company": "云峰基金",
          "department": "科技组",
          "title": "Senior Associate"
        }
      ],
      "education": [
        {
          "school": "上海交通大学",
          "degree": "本科",
          "major": "管理学"
        },
        {
          "school": "北京大学",
          "degree": "硕士",
          "major": "金融"
        }
      ],
      "source": "候选人沟通",
      "added_at": "2026-04-16T16:00:00+08:00",
      "updated_at": "2026-04-16T16:00:00+08:00"
    }
  ],
  "notes": [
    {
      "content": "科技组内部SA和ED平行汇报，都直接汇报给合伙人",
      "source": "金笑健沟通",
      "added_at": "2026-04-16T16:00:00+08:00"
    }
  ]
}
```

### 字段说明

#### org_structure 节点类型（type）
| 值 | 说明 |
|---|---|
| `company` | 公司根节点 |
| `department` | 部门/行业组 |
| `team` | 团队/赛道/小组 |
| `sub_team` | 子团队 |

#### personnel 字段说明
| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 格式：`person-{姓名拼音}` |
| `name` | ✅ | 中文姓名 |
| `title` | ✅ | 职位全称 |
| `title_abbr` | ❌ | 职位缩写（SA/ED/VP/MD/Partner等） |
| `department_id` | ✅ | 所属部门 ID，对应 org_structure 中的 id |
| `team_id` | ❌ | 所属团队 ID |
| `reporting_to` | ❌ | 汇报对象（人名或职位） |
| `reporting_type` | ❌ | `direct`（默认）/ `parallel` / `matrix` / `dotted` |
| `inferred_reporting` | ❌ | 汇报关系是否为推断，默认 `false` |
| `base_city` | ❌ | 工作所在城市 |
| `background_brief` | ❌ | 不超过两行的简要背景 |
| `work_history` | ❌ | 工作经历列表 |
| `education` | ❌ | 教育经历列表 |
| `source` | ✅ | 信息来源 |
| `added_at` | ✅ | 录入时间 ISO 8601 |
| `updated_at` | ✅ | 更新时间 ISO 8601 |

#### industry 可选值
- `PE/VC`：私募股权/风险投资
- `Hedge Fund`：对冲基金
- `Investment Bank`：投资银行
- `Consulting`：咨询
- `Tech`：科技
- `Finance`：金融
- `Other`：其他

### 增量更新规则

1. **新增部门**：在 `org_structure.children` 中追加新节点
2. **新增人员**：在 `personnel` 数组中追加新对象
3. **更新人员信息**：
   - 基于 `name` 匹配已有人员
   - 新字段直接填入
   - 冲突字段以新信息为准，旧信息移入 `update_history`
4. **更新部门信息**：基于 `name` 模糊匹配，更新 headcount 等
5. **每次更新**：
   - 更新根节点的 `updated_at`
   - 在 `update_history` 中追加变更记录
   - 更新 `00-索引` 中的统计数据
