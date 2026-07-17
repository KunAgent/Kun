# 腾讯云技术支持 (Cloud Ops Team)

三位腾讯云技术专家组成的团队，提供从迁移上云到日常运维的端到端服务。

## 类型

Team 型（专家团）

## 功能

- **多云统一治理**（CloudQ）：多云统一管理、架构可视化、智能巡检与风险评估、成本优化（由内置 `cloudq` Skill 承载）
- **工单管理与智能问答**（AndonQ）：工单查询、24/7 智能客服、全产品线 API 接入（由内置 `andonq` Skill 承载）
- **云迁移规划**（MigraQ）：跨云资源扫描、规格映射推荐、TCO 成本分析、迁移方案制定（由从 WorkBuddy Skill Center 加载的 `migraq` Skill 承载）

## 团队成员

| 角色 | 名称 | 职责 |
|------|------|------|
| 主理人 | 首席技术支持官 | 需求分析、专家调度、结果整合 |
| DevOps专家 | CloudQ | 售前售中：多云治理、架构可视化、智能巡检 |
| 售后服务专家 | AndonQ | 售后：工单管理、24/7 智能问答、技术支持 |
| 上云迁移专家 | MigraQ | 云迁移：跨云迁移规划、资源扫描、TCO 分析 |

## 内置技能（Skills）

专家团内置以下三个 Skill，**无需用户额外安装**：

| 技能 | 承载成员 | 说明 |
|------|---------|------|
| `cloudq` | CloudQ | 封装腾讯云智能顾问 API、多云架构治理、智能巡检、Well-Architected 评估、AI 云诊断、AK/SK 与 OAuth 鉴权、免密链接生成等核心能力 |
| `andonq` | AndonQ | 封装 AndonQ OAuth2 临时码鉴权、环境检测、ChatCompletionsAndonQ SSE 流式接口调用与 SessionID 管理；所有业务能力由后端接口承载 |
| `MigraQ` | MigraQ | 封装腾讯云迁移平台（CMG/MSP）SSE 流式调用，支持售前免鉴权（资源扫描、选型推荐、TCO 分析、迁移方案规划等）与执行类鉴权两种模式 |

## 目录结构

```
cloud-ops-team/
├── .workbuddy-plugin/
│   └── plugin.json
├── agents/
│   ├── cloud-ops-team-lead.md   # 主理人
│   ├── cloud-q.md               # CloudQ（预加载 cloudq skill）
│   ├── andon-q.md               # AndonQ（预加载 andonq skill）
│   └── migra-q.md               # MigraQ（预加载 MigraQ skill）
├── avatars/                     # 团队及成员头像
│   ├── team.png
│   ├── cloud-ops-team-lead.png
│   ├── cloud-q.png
│   ├── andon-q.png
│   └── migra-q.png
├── skills/
│   ├── cloudq/
│   │   ├── SKILL.md
│   │   ├── references/api/CloudQChatCompletions.md
│   │   └── scripts/             # check_env / login / tcloud_sse_api 等
│   ├── andonq/
│   │   ├── SKILL.md
│   │   ├── references/api/ChatCompletionsAndonQ.md
│   │   └── scripts/             # check_env / andon_auth / andon_sse_api
│   └── migraq/
│       ├── SKILL.md
│       ├── references/api/      # MigraQChatCompletions 等接口文档
│       └── scripts/             # check_env / migrateq_sse_api
├── settings.json                # 主理人 = cloud-ops-team-lead
└── README.md
```

## 使用示例

- 我们的云资源有哪些风险
- 查看我最近的腾讯云工单状态
- 规划从 AWS 迁移到腾讯云的方案
- 帮我开通智能顾问并对生产架构做一次智能巡检
- 工单 202604010721 最新进展是什么？
- 从阿里云迁移到腾讯云，做一次 TCO 分析

## 路由策略（主理人执行）

| 用户意图关键词 | 调度专家 |
|---------------|---------|
| 巡检、架构、多云管理、风险评估、成本优化、可视化、产品咨询、选型、售前、售中 | CloudQ |
| 工单、ticket、报障、故障、售后、技术支持 | AndonQ |
| 迁移、migration、搬迁、上云、TCO、规格映射 | MigraQ |
| 从XX云迁移到腾讯云并做评估 | MigraQ → CloudQ |
| 全面云运维诊断 | CloudQ + AndonQ |

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 打包

```bash
zip -r cloud-ops-team.zip cloud-ops-team/
```
