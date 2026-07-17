# rum-sdk-setup — 腾讯云 RUM SDK 接入 Skill

## 概述

本 Skill 帮助用户将腾讯云前端性能监控（RUM）SDK 集成到各类项目中。自动检测项目类型和框架，选择正确的 SDK 包，生成初始化代码，配置错误监控、性能监控和自定义上报。

覆盖 **10 个平台**：Web、小程序、React Native、Node.js、Hippy、Cocos、LiteApp、QuickApp、Viola、Weex。

## 与 tencent-cloud-rum 的关系

| Skill | 阶段 | 职责 |
|-------|------|------|
| **rum-sdk-setup**（本 Skill） | Day 0 开发接入 | 安装 SDK、生成初始化代码、配置上报 |
| **tencent-cloud-rum** | Day 2 运维分析 | 查询和分析已上报的 RUM 数据 |

两者形成"接入 → 分析"的完整闭环。

## 目录结构

```
rum-sdk-setup/
├── SKILL.md                               # Skill 核心指令文件
├── README.md                              # 本说明文件
├── scripts/
│   └── detect_project.py                  # 项目类型检测脚本（Python）
├── evals/
│   └── evals.json                         # 20 个评估测试场景
├── assets/                                # 静态资源（预留）
└── references/                            # 参考文档（AI 按需加载）
    ├── web-sdk-config.md                  # Web SDK 完整配置参数
    ├── mp-sdk-config.md                   # 小程序 SDK 配置
    ├── rn-sdk-config.md                   # React Native SDK 配置
    ├── node-sdk-config.md                 # Node.js SDK 配置
    ├── hippy-sdk-config.md                # Hippy SDK 配置
    ├── cocos-sdk-config.md                # Cocos SDK 配置
    ├── liteapp-sdk-config.md              # LiteApp SDK 配置
    ├── quickapp-sdk-config.md             # QuickApp SDK 配置
    ├── viola-sdk-config.md                # Viola SDK 配置
    ├── weex-sdk-config.md                 # Weex SDK 配置
    ├── troubleshooting.md                 # 接入排障指南（7 个常见问题 + 验证清单）
    └── custom_reporting_api.md            # 自定义上报 API（reportEvent/reportTime/error/info/report）
```

## 功能概述

### 核心能力

1. **程序化项目检测** — 运行 `detect_project.py` 自动识别项目类型、框架、语言、包管理器
2. **10 平台覆盖** — Web / 小程序 / React Native / Node.js / Hippy / Cocos / LiteApp / QuickApp / Viola / Weex
3. **渐进式接入** — 先最小可运行版本，再按需开启高级能力
4. **安全检查** — 拒绝将 SecretId/SecretKey 写入前端代码
5. **自定义上报** — 帮助配置事件上报、测速上报、错误上报
6. **高级监控** — 白屏检测、卡顿监控、内存监控、RUM-APM 联动
7. **接入验证与回滚** — 每次接入提供完整的验证步骤和回滚说明

### 安全保障（CRITICAL 规则）

- 检测并拒绝 AKSK 等敏感信息写入前端
- 修改前检查是否已接入（避免重复初始化）
- 创建独立文件而非修改入口（便于回滚）
- 修改文件前必须读取确认内容
- 上报域名必须匹配地域
- 不跨 SDK 混用参考文档

### 支持的场景

| 场景 | 说明 |
|------|------|
| 从零接入 RUM SDK | 检测项目 → 选择 SDK → 安装依赖 → 生成初始化代码 → 验证 |
| 配置自定义上报 | 事件埋点、业务测速、错误上报 |
| 配置 API 错误码判定 | 自定义 retCodeHandler |
| 多环境区分上报 | 通过 env 参数区分 production/test/local |
| 开启高级监控能力 | 白屏、卡顿、内存、链路追踪 |
| 接入排障 | 数据不上报、403 错误、部分数据缺失、熔断排查 |

## 快速开始

在 AI 助手中直接说：

```
帮我在这个项目里接入腾讯云 RUM
```

或者更具体：

```
帮我接入腾讯云前端监控 SDK，上报 ID 是 pGUVFTCZyewxxxxx，需要开启接口测速和资源测速
```

## 前置条件

1. **腾讯云账号** — 注册 [腾讯云](https://cloud.tencent.com/)
2. **RUM 应用** — 在 [RUM 控制台](https://console.cloud.tencent.com/rum) 创建应用，获取上报 ID
3. **项目** — 任意前端/跨端/服务端项目

## 注意事项

1. 上报 ID（`id`）是公开的前端标识，不是 SecretKey，写入前端代码是安全的
2. RUM SDK（aegis-*-sdk 系列）是腾讯云官方维护的 npm 包
3. Web SDK 体积约 30-40KB（gzip 后更小），有内置的节流和去重机制
4. 微信小程序请使用 `aegis-mp-sdk`，不是 `aegis-web-sdk`
5. React Native 请使用 `aegis-rn-sdk`，不是 `aegis-web-sdk`

