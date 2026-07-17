---
name: ihr-conference
description: "iHR360 面谈/会议：搜索历史面谈记录、按需读取会话文档预览、带参创建并发起面谈。查询历史面谈时先搜索候选；读取内容时再取文档；发起面谈前必须确认人员 ID 和时间。"
metadata:
  requires:
    bins: ["ihr-cli"]
  cliHelp: "ihr-cli conference --help"
---

# conference (v1)

**CRITICAL — 开始前 MUST 先阅读 [`../ihr-shared/SKILL.md`](../ihr-shared/SKILL.md)，其中包含共享运行规则、时间处理原则和 JSON 协议。**

## 核心概念

- **ConferenceSession**：面谈/会议会话，通过 `conferenceSessionId` 标识。
- **Search Result**：首轮搜索返回的候选会话集合，包含 `conferenceSessionIds`、`returnedCount`、`truncated` 和可选 `previewItems`。
- **Preview Item**：标准化会话预览项，包含搜索状态、时间、多类预览文本，以及 `currentQueryUserIdentity`。结果受当前用户权限过滤影响，部分字段可能被裁剪为空。
- **Session Documents**：按会话 ID 读取的文档化预览结果，是搜索后的第二步动作。
- **Launch Request**：带参创建并发起面谈的请求。目的和模板使用静态 ID，人员必须先通过 `ihr-cli base +selectStaffs` 查找并确认。

## 核心场景

### 1. 搜索历史面谈记录

1. 当用户在问“开过的会”“历史面谈”“最近发生过的面谈”“某段时间聊过什么”时，优先使用本技能。
2. 默认先执行搜索，再决定是否继续读取会话文档。
3. 搜索结果很多时，优先返回候选和预览，不要直接全量读取详情。

### 2. 读取会话文档

1. 当用户已经指定会话，或明确需要摘要、待办、转写摘要等内容时，再读取会话文档。
2. `+documents` 是 `+search` 之后的第二步动作，不应默认替代搜索。

### 3. 创建并发起面谈

1. 当用户明确说“发起、预约、创建会议、安排面谈”时，才使用 `+launch`。
2. 如果用户只说“准备一下、拟一个面谈安排”，不要发起；可以先整理参数或使用 `--dry-run`。
3. 如果只给了人名，必须先调用 `ihr-cli base +selectStaffs` 查找候选并确认 `id`，不能凭姓名猜 staffId。
4. 如果缺少时间、面谈官、面谈对象，先追问，不调用发起接口。

## 资源关系

```text
ConferenceSession
├── Search Result
│   ├── conferenceSessionIds[]
│   └── previewItems[]
│       ├── status
│       ├── startTime / endTime / createTime
│       ├── finalScore
│       ├── basicText / outlineText / smartMinutesText / topicText
│       ├── summaryText / todoText / transcriptSummaryText
│       └── currentQueryUserIdentity
└── Session Documents
    └── previewItems[]
        ├── status
        ├── startTime / endTime / createTime
        ├── basicText / outlineText / smartMinutesText / topicText
        ├── summaryText / todoText / transcriptSummaryText
        └── currentQueryUserIdentity

Launch Request
├── purposeId / templateId
├── startTime / duration / interviewMode
├── interviewers[]
├── interviewees[]
└── others[]
```

> **路由规则**：用户先问“有哪些历史面谈/聊过什么/最近开过什么”时，优先使用 `+search`。只有在用户明确需要阅读内容、摘要、待办、转写摘要，或已指定 `conferenceSessionId` 时，才进入 `+documents`。用户明确要创建、预约或发起面谈，且关键参数已确认时，才进入 `+launch`。
>
> **禁止误用**：`+launch` 有真实副作用，会创建会话并发起三方会议。人员、时间或意图不确定时不要调用。
>
> **默认策略**：先搜候选，再按需读文档；不要把会话文档读取当成首轮入口。
>
> **权限语义**：`previewItems` 是权限敏感结果。当前 controller 会先过滤不可见会话，再返回预览；`currentQueryUserIdentity` 描述当前查询用户在该会话中的身份，文本字段也可能因权限被裁剪为空。
>
> **人员依赖**：`+launch` 依赖 `ihr-cli base +selectStaffs`。分项参数或 JSON 里的系统内人员必须使用已确认的 `staffId`，不要把姓名直接当作人员 ID。

## Shortcuts（推荐优先使用）

Shortcut 是对常用操作的高级封装（`ihr-cli conference +<verb>`）。有 Shortcut 的操作优先使用。

| Shortcut | 说明 |
|----------|------|
| [`+search`](references/ihr-conference-search.md) | 搜索历史面谈记录，支持结构化条件、文本搜索和首轮预览 |
| [`+documents`](references/ihr-conference-documents.md) | 按会话 ID 读取文档化预览结果 |
| [`+launch`](references/ihr-conference-launch.md) | 带参创建并发起面谈，要求人员 ID 已确认 |

## Current Implementation

当前主实现已经在 `ihr-cli` 子项目内：

| Shortcut | 当前命令 |
|----------|----------|
| `ihr-cli conference +search` | `ihr-cli conference +search` |
| `ihr-cli conference +documents` | `ihr-cli conference +documents` |
| `ihr-cli conference +launch` | `ihr-cli conference +launch` |

## Scenes

可复用的自然语言测试问题集位于：

1. [`scenes/ihr-conference-skill-test-questions.txt`](scenes/ihr-conference-skill-test-questions.txt)

## 直接资源

当前底层对应的服务端接口：

1. `POST /v1/analysis/search/queryConference`
2. `POST /v1/analysis/search/genConferenceSessionDocuments`
3. `POST /v1/analysis/conference/launchConference`

但在 skill 层，优先使用 shortcut 心智，而不是直接暴露底层接口名。
