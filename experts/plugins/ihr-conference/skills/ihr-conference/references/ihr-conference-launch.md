# conference +launch

> **前置条件：** 先阅读 [`../../ihr-shared/SKILL.md`](../../ihr-shared/SKILL.md) 了解共享运行规则、时间处理方式和 JSON 协议。涉及人员时，先阅读 [`../../ihr-base/references/ihr-base-select-staffs.md`](../../ihr-base/references/ihr-base-select-staffs.md)。

带参创建并发起面谈。该动作有真实副作用，会创建会话、发起三方会议，并可能触发通知；只有用户明确要求创建、预约、安排或发起时才调用。

当前动作入口：

```bash
ihr-cli conference +launch
```

## 典型触发表达

以下问题通常应进入 `+launch`，但前提是人员和时间都已确认：

- 明天下午三点帮我安排张三的周期绩效复盘
- 给李经理和王五创建一个周度 1-on-1
- 预约一个新员工融入 Check-in 面谈
- 发起一次项目复盘会议

以下表达不要直接发起：

- 帮我准备一下面谈参数
- 帮我拟一个绩效面谈安排
- 搜一下张三能不能作为面谈对象

## 标准流程

如果用户只给了人名，先用通用选人能力确认人员 ID：

```bash
ihr-cli base +selectStaffs --searchKeyword "张三" --pageNo 1 --pageSize 10
```

确认 `response.data.dataList[].id` 后，再把该值写入 `+launch` 的参与人 `staffId`。

## 命令

```bash
# 分项参数，适合简单场景
ihr-cli conference +launch \
  --title "张三周期绩效复盘" \
  --purposeId purpose_004 \
  --startTime "2026-05-28T15:00:00+08:00" \
  --duration 30 \
  --interviewMode ONLINE \
  --interviewers '[{"staffId":"staff-001","name":"李经理"}]' \
  --interviewees '[{"staffId":"staff-002","name":"张三"}]'

# JSON 输入，适合参与人较多或字段较复杂的场景
ihr-cli conference +launch --json '{
  "title": "张三周期绩效复盘",
  "purposeId": "purpose_004",
  "templateId": "template_004",
  "startTime": "2026-05-28T15:00:00+08:00",
  "duration": 30,
  "interviewMode": "ONLINE",
  "interviewers": [{"staffId":"staff-001","name":"李经理"}],
  "interviewees": [{"staffId":"staff-002","name":"张三"}],
  "referenceInfo": "重点聊 Q2 目标达成、关键项目复盘和下季度改进计划。"
}'

# 发起前检查请求体
ihr-cli conference +launch \
  --title "张三周期绩效复盘" \
  --purposeId purpose_004 \
  --startTime "2026-05-28T15:00:00+08:00" \
  --interviewMode ONLINE \
  --interviewers '[{"staffId":"staff-001","name":"李经理"}]' \
  --interviewees '[{"staffId":"staff-002","name":"张三"}]' \
  --dry-run
```

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--campaignId <id>` | 否 | 预留字段；当前版本不支持绑定所属专项，传入会报错 |
| `--title <text>` | 是 | 面谈主题 |
| `--purposeId <id>` | 否 | 面谈目的 ID，不传默认 `purpose_001` |
| `--templateId <id>` | 否 | 模板业务 ID，不传按 `purposeId` 默认模板 |
| `--startTime <time>` | 是 | ISO-8601 offset datetime，例如 `2026-05-28T15:00:00+08:00` |
| `--duration <n>` | 否 | 面谈时长分钟，默认 `30`，范围 `1-180` |
| `--interviewMode <mode>` | 是 | `ONLINE` 或 `OFFLINE` |
| `--thirdPartyPlatform <platform>` | 否 | `ONLINE` 默认 `TENCENT_MEETING`，`OFFLINE` 默认 `OFFLINE_MEETING` |
| `--interviewers <json>` | 是 | 面谈官 JSON 数组 |
| `--interviewees <json>` | 是 | 面谈对象 JSON 数组 |
| `--others <json>` | 否 | 其他参与人 JSON 数组 |
| `--referenceInfo <text>` | 否 | 其他参考信息 |
| `--json <json>` | 否 | 直接传入 JSON 字符串，调试用，不能和分项参数混用 |
| `--stdin` | 否 | 从标准输入读取 JSON 字符串，调试用，不能和分项参数混用 |
| `--output-file <file>` | 否 | 将最终 JSON 结果额外写入文件 |
| `--dry-run` | 否 | 只打印请求信息，不真正执行 |

## 静态目的与模板

| purposeId | 目的名称 | templateId | 模板名称 |
|-----------|----------|------------|----------|
| `purpose_001` | 通用会议 | `template_001` | 通用会议 |
| `purpose_002` | 面试记录 | `template_002` | 面试记录 |
| `purpose_003` | 新员工融入Check-in | `template_003` | 新员工融入Check-in |
| `purpose_004` | 周期绩效复盘 | `template_004` | 周期绩效复盘 |
| `purpose_005` | 绩效辅导与提升 | `template_005` | 绩效辅导与提升 |
| `purpose_006` | 个人发展（IDP）面谈 | `template_006` | 个人发展（IDP）面谈 |
| `purpose_007` | 周度1-on-1 | `template_007` | 周度1-on-1 |
| `purpose_008` | 项目复盘 | `template_008` | 项目复盘 |
| `purpose_009` | 离职复盘与洞察 | `template_009` | 离职复盘与洞察 |

规则：

1. 用户明确说“绩效复盘”，使用 `purpose_004` / `template_004`。
2. 用户明确说“绩效辅导”，使用 `purpose_005` / `template_005`。
3. 用户没有表达具体目的时，默认 `purpose_001` / `template_001`，并告知按通用会议创建。
4. 不要传 `templateItemId`；服务端会按 `templateId` 或 `purposeId` 解析最新可用模板项。

## 参与人对象

`interviewers`、`interviewees`、`others` 的每个元素结构：

```json
{
  "staffId": "staff-001",
  "name": "李经理"
}
```

字段规则：

| 字段 | 必填 | 说明 |
|------|------|------|
| `staffId` | 系统内人员必填 | 来自 `base +selectStaffs` 的 `dataList[].id` |
| `name` | 建议 | 展示用姓名 |

LLM 规则：

1. 如果用户只给人名，必须先调用 `ihr-cli base +selectStaffs`。
2. `total=0` 时告诉用户没找到。
3. `total=1` 且姓名高度一致时，可以采用该 `id`。
4. `total>1` 时必须展示候选并让用户确认，不能自动选第一个。

## 时间规则

`startTime` 必须使用 ISO-8601 offset datetime：

```text
2026-05-28T15:00:00+08:00
```

遇到“明天下午三点”“下周一上午十点”这类相对时间时，先基于当前系统日期换算成绝对时间。默认时区按 `Asia/Shanghai`，即 `+08:00`。

## 核心约束

### 1. 真实副作用

`+launch` 会真实创建并发起面谈。用户意图不明确时，先追问或使用 `--dry-run`。

### 2. 人员 ID 不能猜

`staffId` 必须来自选人能力或用户明确提供的确认结果。不能把姓名直接当作 `staffId`。

### 3. 所属专项暂不支持绑定

如果用户提到专项，可以把专项文本放入 `referenceInfo`；不要传 `campaignId`。当前传入 `campaignId` 会返回错误。

### 4. 缺少关键字段先追问

缺少以下任一关键字段时不要发起：

1. `title`
2. `startTime`
3. `interviewMode`
4. `interviewers`
5. `interviewees`

## 输出结果

CLI 统一输出：

```json
{"success":true,"command":"launchConference","request":{},"response":{}}
```

业务字段从 `response.data` 读取，重点包括：

| 字段 | 说明 |
|------|------|
| `response.data.conferenceSessionId` | 面谈会话 ID |
| `response.data.conferenceStatus` | 面谈状态，成功发起后通常为 `READY` |
| `response.data.title` | 面谈主题 |
| `response.data.startTime` | 开始时间 |
| `response.data.duration` | 面谈时长 |
| `response.data.meetingInfo` | 三方会议相关信息，结构由服务端返回 |
| `response.data.participants[]` | 参与人列表 |

## 常见错误与排查

| 错误现象 | 根本原因 | 解决方案 |
|---------|---------|---------|
| `title 不能为空` | 缺少面谈主题 | 先补充主题 |
| `startTime 不能为空` | 缺少开始时间 | 先确认绝对时间 |
| `startTime 必须是 ISO-8601 offset datetime` | 时间格式不对 | 使用 `2026-05-28T15:00:00+08:00` |
| `interviewers 不能为空` | 缺少面谈官 | 先通过 `base +selectStaffs` 确认人员 |
| `interviewees 不能为空` | 缺少面谈对象 | 先通过 `base +selectStaffs` 确认人员 |
| `staffId 不能为空` | 系统内人员没有确认 ID | 不要用姓名猜 ID，先选人 |
| `templateId ... 与 purposeId ... 不匹配` | 模板和目的不一致 | 使用静态表中的同一行组合 |
| `当前版本不支持绑定所属专项` | 传入了 `campaignId` | 暂把专项说明放入 `referenceInfo` |

## 提示

- 简单发起可以用分项参数；参与人多时优先使用 `--json` 或 `--stdin`。
- 发起前不确定时，先用 `--dry-run` 查看最终请求体。
