---
name: 腾讯云天御风控Skill
description: "腾讯云天御风控Skill是一款面向企业客户的全链路风险防控解决方案Skill，用Agent重构风控运营链路，在对话中完成风险分析与策略调优——从被动响应，走向主动防御。提供从风险感知、智能归因到专属策略设计的一站式服务，覆盖账号保护、营销保护、交易保护、设备风险识别等关键场景。"
homepage: https://cloud.tencent.com/product/rce
author: tencent-cloud-rce
---

# 腾讯云天御风控Skill

> 风险感知 — 风险识别 — 风险处置，全链路业务风控能力的对话式入口。

本 Skill 在 腾讯云RCE 控制台云 API 之上提供**对话式管理与查询入口**：通过自然语言指令，AI 助手将用户意图翻译为合规的云 API 3.0 调用，完成风险态势查询、策略管理、名单维护、案件溯源等运营操作，结果以结构化形式返回。鉴权、参数装配与错误处理均在 Skill 内部闭环。

> - 产品官网：[https://cloud.tencent.com/product/rce](https://cloud.tencent.com/product/rce)
> - 产品文档：[https://cloud.tencent.com/document/product/1343/52538](https://cloud.tencent.com/document/product/1343/52538)

## 核心能力

| 场景 | 典型能力 |
| --- | --- |
| **风险态势** | 请求总览、风险趋势、策略效果总览、规则/策略/事件维度命中分析 |
| **风险查询** | 按 `AccountType` + `AccountId` 查询用户风险画像（`DescribeIDRisk`）、按 `ReqId` 反查单笔请求案件（`DescribeHistoryRecordList`） |
| **策略管理** | 策略 CRUD、策略复制、按服务批量创建|
| **名单管理** | 黑白名单创建、名单数据批量导入、名单查询与失效管理 |
| **风险监控** | 监控规则 CRUD、风险监控管理（`CreateRiskMonitoringManagement` 等）、监控触发链路查询 |
| **数据与模型** | 数据报表 CRUD、任务列表、加密数据解密查询|

## 适用人群

- 腾讯云RCE 控制台的**风控运营 / 策略工程师**：日常态势巡检、策略调优、案件分析
- **业务侧研发**：临时拉取风险数据、按 `ReqId` 排查疑似误伤
- **风控产品经理**：查询命中趋势、生成最近7天风险周报

## 使用示例

### 1. 风险态势巡检

> **用户**：查一下今天注册风险的请求总览。
>
> **Skill 行为**：调用 `DescribeRequestsOverView`，传入对应注册场景 `EventId` 与今日时间窗口，返回总请求量、命中量、命中率与按拒绝原因的细分。

### 2. 单笔案件溯源

> **用户**：`ReqId=Req-2026060512345678`，看下命中详情。
>
> **Skill 行为**：调用 `DescribeHistoryRecordList`，按 `ReqId` 精确反查，返回命中策略、命中规则、关键风险特征与原始请求字段。

### 3. 名单维护

> **用户**：把这 5 个手机号导入黑名单 `nl-xxxxxxxx`，备注"聚集刷单"。
>
> **Skill 行为**：调用 `ImportNameListData`，批量提交导入任务，返回成功/失败明细与异步任务 ID。

## 安装

在支持 Anthropic Agent Skills 规范的 Agent 客户端 / IDE 中：

```
根据 https://skillhub.cn/skills/tencent-rce-skill 安装腾讯云天御风控Skill
```

或在客户端的 Skills 入口搜索 **腾讯云天御风控Skill** 直接安装。

## 鉴权与权限

- 通过 `amccli`（Agent 身份权限中心模式）完成 OAuth 授权，**不会向用户索取** `SecretId` / `SecretKey` 等任何长期凭证。
- 首次使用会输出腾讯云授权 URL，浏览器登录授权后凭证态自动持久化。
- 调用权限严格受所授权腾讯云子账号在 RCE 控制台的 CAM 权限约束，**Skill 不具备越权能力**。
- 如需切换账号或重新授权，向 Agent 显式说明"换账号 / 重新授权"即可触发授权预热流程。

## 数据合规

- 所有请求/响应仅经过腾讯云官方 API 网关，**不经第三方中转**。
- Skill 不会上传业务数据至任何外部服务。
- 涉及敏感字段的接口（如 `DescribeDecryptedContent` 等）默认按腾讯云 RCE 既有合规策略执行，调用前提示数据敏感性。

---

## ⚠️ AI Agent 必读（Skill 加载方约定）

**本 SKILL.md 仅为对外展示用的产品概览。所有 RCE 业务调用规范、`AUTH_CONFIG` 凭证、命令格式、参数语义、SOP 与踩坑经验均位于同目录的 [`AGENT.md`](./AGENT.md)。**

AI Agent 在执行任何 RCE 相关操作前，**必须**先读取并完整加载执行手册：

```bash
cat AGENT.md
```

加载后按 `AGENT.md` 中的 **「特别注意」→「前置条件：检测并自动安装 amccli」→「环境变量（AUTH_CONFIG）」→「强制 SOP」** 顺序执行；接口入参以 `AGENT_unix.md` / `AGENT_windows.md` 内各接口的说明为准。

> ❌ **严禁**仅凭本 SKILL.md 的概览信息直接拼装 `amccli` 命令——会因缺失 `AUTH_CONFIG`、参数打平规则、字符串入参坑、`BusinessSecurityData` 包裹规则等关键约束而失败。
