# 流程专家（Workflow Expert）

> 一站式汇金工作流专家，覆盖**流程设计**（查询/创建/修改流程画布）和**流程单操作**（创建/待办/详情）。

## 专家类型

Agent 型 · `09-OperationsHR`

---

## 能力概览

### 流程设计（Workflow Design）
| 能力 | 类型 | 触发词示例 |
|------|------|-----------|
| 查询流程列表 | 展示类 | 有哪些流程、查流程列表 |
| 查看流程画布详情 | 展示类 | 查流程 P xxx 详情、看图纸 |
| 创建流程 | 操作类 | 创建流程、新建一个流程 |
| 修改流程 | 操作类 | 修改流程名称、更改流程管理员 |

### 流程单操作（Workflow Instance）
| 能力 | 类型 | 触发词示例 |
|------|------|-----------|
| 查询我的待办 | 展示类 | 待办、我的待办流程单 |
| 查询我创建的流程单 | 展示类 | 我创建的流程单 |
| 查询流程单详情 | 展示类 | T2026xxx 详情、审批进度 |
| 创建流程单 | 操作类 | 创建流程单、发起申请 |

---

## 标准工作流程（SOP）

```
用户输入
   ↓
① 意图识别（流程设计 / 流程单操作 · 展示类 / 操作类）
   ↓
② 调用 MCP（mcp_get_tool_description → mcp_call_tool）
   ↓
③-A 展示类 → 套用对应 templates/ 模板渲染输出
③-B 操作类 → 展示确认摘要 → 等待用户确认 → 执行 → 返回结果
```

---

## 项目结构

```
workflow-workbuddy-agent/
│
├── .workbuddy-plugin/
│   └── plugin.json                    # 专家元数据配置（版本/技能注册/展示信息）
│
├── agents/
│   └── workflow-assistant.md          # Agent 核心定义
│                                      #   - 意图识别规则
│                                      #   - SOP 三步工作流
│                                      #   - 展示规范 & 操作确认模板
│                                      #   - 异常处理规则
│                                      #   - 扩展指引
│
├── avatars/
│   └── expert.png                     # 专家头像（512×512 px）
│
├── skills/
│   │
│   ├── workflow-design/               # ① 流程设计技能域
│   │   ├── SKILL.md                   #   技能定义 + 各操作标准调用流程
│   │   ├── references/
│   │   │   └── workflow-design-api.md #   MCP 接口参数文档（ListWorkflow/DescribeWorkflow/...）
│   │   └── templates/
│   │       ├── workflow-list.md       #   展示模板：流程列表
│   │       └── workflow-detail.md     #   展示模板：流程画布详情
│   │
│   └── workflow-instance/             # ② 流程单操作技能域
│       ├── SKILL.md                   #   技能定义 + 各操作标准调用流程
│       ├── references/
│       │   ├── workflow-instance-api.md  # MCP 接口参数文档（Create/List/Describe/GetTasks）
│       │   └── status-enum.md            # 状态 & 类型枚举对照表
│       └── templates/
│           ├── instance-list.md       #   展示模板：流程单列表（待办/我的）
│           └── instance-detail.md     #   展示模板：流程单详情 + 审批时间线
│
└── README.md
```

---

## 设计原则

| 原则 | 实现方式 |
|------|---------|
| **可扩展** | 新增能力只需新建 `skills/{domain}/` 并在 `plugin.json` 注册，无需改动 Agent 核心 |
| **可维护** | 接口文档与展示模板独立存放于 `references/` 和 `templates/`，各自单独更新 |
| **可迭代** | Agent MD 中的意图映射表和 SOP 可追加，不影响存量逻辑 |
| **职责分离** | Agent MD = 调度层（意图识别 + 流程控制），Skill = 能力层（接口 + 模板）|
| **展示/操作分类** | 展示类直接渲染；操作类必须先确认再执行，防止误操作 |

---

## 扩展指引

### 新增一个 MCP 接口

1. 在对应 Skill 的 `references/xxx-api.md` 中追加接口文档
2. 在对应 Skill 的 `SKILL.md` 中追加调用流程
3. 在 `agents/workflow-assistant.md` 的意图映射表中追加触发词行

### 新增一个展示样式

在对应 Skill 的 `templates/` 目录下新建 `{name}.md`，按模板格式定义输出结构，并在 SKILL.md 中引用。

### 新增一个能力域（如「流程单审批」「流程单撤回」）

1. 新建 `skills/{new-domain}/` 目录，包含 `SKILL.md` + `references/` + `templates/`
2. 在 `plugin.json` 的 `skills` 数组中注册新路径
3. 在 `agents/workflow-assistant.md` 中更新能力范围说明和意图映射表

---

## 打包

```bash
zip -r workflow-workbuddy-agent.zip workflow-workbuddy-agent/ \
  --exclude "*.git*" --exclude "*/.idea/*"
```

## 头像替换

自动生成的头像位于 `avatars/expert.png`。如需替换：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：≤ 500 KB
