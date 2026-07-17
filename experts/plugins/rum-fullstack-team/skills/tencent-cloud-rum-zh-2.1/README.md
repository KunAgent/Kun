# 腾讯云 RUM —— 前端性能分析 Skill（中文版 v2.1）

## 概述

本 Skill 与 [腾讯云前端性能监控（RUM）](https://cloud.tencent.com/document/product/248/87183) 深度集成，提供 AI 驱动的前端性能分析能力。它依托 RUM MCP（Model Context Protocol）服务查询指标、日志，并输出可落地的分析结论。本 Skill 所使用的 MCP Endpoint `https://app.rumt-zh.com/sse` 是腾讯云 RUM 官方 MCP 服务地址。

> v2.1 相较 v2.0 的主要改动：将「应用信息查询规则」重构为四种场景（只给 ID / 只给名字 / ID+名字 / 都没给）并补充 50 条上限、无权限等兜底规则；决策树同步精简，避免与查询规则重复。

## 目录结构

```
腾讯云 RUM (中文版) 2.1/
├── SKILL.md                              # 核心 Skill 指令文件
├── setup.sh                              # 一键配置脚本（MCP 配置）
├── README.md                             # 本说明文件
└── references/                           # 参考文档（AI 按需加载）
    ├── rum_tools_docs.md                 # RUM MCP 5 个工具的参数参考
    ├── common_queries.md                 # 4 大分析流程的详细步骤
    └── apm_analysis.md                   # APM 关联分析 + 日志枚举 + 地域
```

## 快速开始

### 前置条件

1. **腾讯云账号**：在 [腾讯云](https://cloud.tencent.com/) 注册账号
2. **RUM 应用**：在 [RUM 控制台](https://console.cloud.tencent.com/rum) 创建 Web 应用
3. **API 凭证**：在 [API 密钥管理](https://console.cloud.tencent.com/cam/capi) 获取 `SecretId` 和 `SecretKey`

### 上手步骤

1. **体验 Demo**：访问 [RUM 控制台 Demo](https://console.cloud.tencent.com/monitor/rum?PID=154437) 了解 RUM 实际效果
2. **接入 SDK**：按照 [应用接入指南](https://cloud.tencent.com/document/product/248/87185) 完成 SDK 接入
   > 💡 接入 SDK、修改上报配置、开启白屏/卡顿监控、新增自定义上报 → 推荐 **[`rum-sdk-setup` Skill](https://skillhub.cn/skills/rum-sdk-setup)**（覆盖 10 端）
3. **配置本 Skill**：运行 `bash setup.sh`，或手动完成 MCP 配置

### MCP 配置

```json
{
  "mcpServers": {
    "rum": {
      "transportType": "sse",
      "url": "https://app.rumt-zh.com/sse",
      "headers": {
        "SecretId": "<YOUR_SECRET_ID>",
        "SecretKey": "<YOUR_SECRET_KEY>"
      }
    }
  }
}
```

## 功能特性

### 可用工具

| 工具 | 用途 |
|------|------|
| QueryRumWebProjects | 查询 RUM-WEB 应用列表 |
| QueryRumWebMetric | 查询网络/异常/PV/UV/性能/资源指标 |
| QueryRumWebLog | 全量日志检索 |
| QueryResourceByPage | 按页面查询资源指标 |
| QueryApmLinkId | 获取关联的 APM 应用 ID |

### 内置分析流程

| 分析流程 | 说明 |
|---------|------|
| TOP 异常分析 | JS / Promise 错误、资源加载错误诊断 |
| TOP 页面性能分析 | LCP / FCP 与 WebVitals 分析，性能瓶颈诊断 |
| TOP 接口性能与稳定性分析 | API 延迟、状态码错误、retcode 错误分析 |
| TOP 资源加载慢分析 | 静态资源加载瓶颈诊断 |

### 进阶能力

- **APM 关联分析**：当日志中包含 trace 信息时，可与 APM 串联，完成后端链路的深度分析
- **多维度下钻**：可按地区、运营商、平台、版本、页面等多维度拆解
- **智能路由**：根据用户诉求自动匹配最合适的分析流程

## 常用链接

| 资源 | 地址 |
|------|------|
| RUM 控制台 | https://console.cloud.tencent.com/rum |
| RUM 控制台 Demo | https://console.cloud.tencent.com/monitor/rum?PID=154437 |
| 应用接入指南 | https://cloud.tencent.com/document/product/248/87185 |
| 快速入门 | https://cloud.tencent.com/document/product/248/87640 |
| RUM 产品概述 | https://cloud.tencent.com/document/product/248/87183 |
| RUM 计费说明 | https://cloud.tencent.com/document/product/248/87074 |
| API 密钥管理 | https://console.cloud.tencent.com/cam/capi |

## 注意事项

1. RUM MCP 使用 `SSE` 协议
2. 通过 HTTP Header 中的 `SecretId` 和 `SecretKey` 鉴权 —— 请妥善保管
3. 建议超时时间：15–30 秒
