# 腾讯云 RUM 全链路专家团（rum-fullstack-team） · v2.0

覆盖腾讯云 RUM 从 SDK 接入到数据分析的完整生命周期。由两位专家分工协作，主理人统筹路由，形成「接入 → 分析」的完整闭环。

## 类型

Team 型（专家团）

## v2.0 更新内容

| 项目 | v1 | v2 |
|------|----|----|
| 分析侧 Skill | `tencent-cloud-rum`（英文版） | **`tencent-cloud-rum-zh-2.1`（中文 v2.1，新增「应用信息查询四场景」、指标参数速查、Demo 入口）** |
| 接入侧 Skill | `rum-sdk-setup` | `rum-sdk-setup`（同步最新版，新增 `en/` 英文文档目录） |
| 插件目录命名 | `.codebuddy-plugin/`（不合规范） | **`.workbuddy-plugin/`（对齐 v2.1 规范）** |
| `plugin.json` 字段 | 缺 `tags` / `quickPrompts` / `plugin` / `email` | **补齐全部规范字段，`profession` 与 `displayName` 一致** |
| `displayDescription.zh` | 长文（超 200 字） | **压缩到 50 字内，突出核心能力** |
| `defaultInitPrompt` | 与 `quickPrompts` 不一致 | **与 `quickPrompts[0]` 严格一致** |
| Agent MD frontmatter | 缺 `displayName` / `profession` | **补齐 displayName/profession，分析师 `skills:` 指向 v2.1** |
| 接入官能力外显 | 仅笼统说"SDK 接入" | **显式拆分为 A 首次接入 / B 自定义上报埋点 / C 接入排障 三类任务流，主理人路由表与 description 同步覆盖** |
| 主理人协作铁律 | 已有 | **沿用并补充「决策果断」条款** |

## 功能

- **Day 0 SDK 接入**：10 大平台 SDK 集成（Web / 小程序（微信/QQ/支付宝/抖音）/ React Native / Node.js / Hippy / Cocos / LiteApp / QuickApp / Viola / Weex）、初始化代码生成、安全检查、回滚方案
- **Day 1 自定义上报埋点**：`aegis.reportEvent` / `reportTime` / `time-timeEnd` / `error` / `info` / `report` / `setConfig` / `destroy` 共 8 个 API，覆盖业务事件、自定义测速、手动报错、业务日志、运行时改配
- **Day 1 接入排障**：覆盖 7 类常见接入问题 —— 无数据上报、`rumt` 域名 403、JS/Promise/API 错误漏报、SPA PV 不准、首屏/资源测速异常、SDK 控制台警告、Webpack/Vite 找不到模块或 TS 类型缺失，附「快速验证清单」
- **Day 2 数据分析（v2.1）**：WebVitals 页面性能、JS/Promise 异常诊断、API 延迟与错误率、静态资源加载瓶颈、PV/UV、RUM-APM 联动；新增「应用信息查询规则」四场景兜底
- **全链路服务**：先接入再分析，打通监控数据闭环

## 技能

| 技能名 | 说明 |
|--------|------|
| `rum-sdk-setup` | RUM SDK 接入技能，含 10 平台配置文档（中英文）、项目检测脚本、自定义上报 API 参考、7 类接入排障手册 |
| `tencent-cloud-rum-zh-2.1` | RUM 数据查询与分析技能（v2.1 中文版），含 MCP 工具参考、4 大分析流程、APM 联动、应用查询四场景 |

## 团队成员

| 角色 | 名称 | 职责 |
|------|------|------|
| 主理人 | Lyra（莱拉） | 统筹团队，根据用户场景路由到接入官或分析师，建立团队、调度成员、汇总最终报告 |
| 接入官 | Aiden（艾登） | ① 10 大平台首次接入与回滚；② 自定义上报埋点（8 个 aegis API）；③ 接入侧排障（7 类常见问题 + 快速验证清单） |
| 分析师 | Nova（诺瓦） | 基于 RUM v2.1 MCP 查询数据，诊断性能/异常，产出带证据链的分析报告 |

## 使用示例

接入类（Aiden · 任务流 A）：
- `帮我在这个 Vue 3 项目里接入腾讯云 RUM`
- `React Native 项目怎么接入 RUM SDK？`

自定义上报（Aiden · 任务流 B）：
- `帮我加一个"点击购买按钮"的事件上报，带商品类型 ext1`
- `用 aegis.reportTime 上报首页接口聚合耗时`
- `try/catch 里手动调 aegis.error 上报业务异常`

接入排障（Aiden · 任务流 C）：
- `接入了但 Network 看不到 rumt 请求`
- `小程序正式环境上报 403，开发环境正常`
- `SPA 路由切换没有 PV 上报`
- `Webpack 报错 Cannot find module 'aegis-web-sdk'`

数据分析（Nova）：
- `分析我 RUM 应用过去 7 天 LCP 最差的 5 个页面`
- `我的应用接口错误率偏高，帮我定位原因`

全链路（Aiden → Nova）：
- `先帮我把小程序接入 RUM，再分析上报后的 JS 错误趋势`

## 前置条件

1. **腾讯云账号**：[腾讯云注册](https://cloud.tencent.com/)
2. **RUM 应用**：[RUM 控制台](https://console.cloud.tencent.com/rum) 创建应用，获取上报 ID（`pGUVFTCZyew...`）
3. **分析师工具**：需要配置 `RUM_TOKEN`，格式 `SecretId:SecretKey`（[CAM 获取](https://console.cloud.tencent.com/cam/capi)），用于调用 RUM v2.1 MCP（SSE）
4. **项目**：任意前端 / 跨端 / 服务端项目

## 头像

头像放在 `avatars/` 目录下：

- `team.png` — 团队整体头像
- `rum-team-lead.png` — 主理人 Lyra
- `rum-integration-specialist.png` — 接入官 Aiden
- `rum-performance-analyst.png` — 分析师 Nova

如需替换为自定义头像，要求：PNG/JPG，512×512 px，单张 ≤ 500KB。

## 目录结构

```
rum-fullstack-team v2/
├── .workbuddy-plugin/
│   └── plugin.json                  # 专家配置（v2.1 规范完整字段）
├── avatars/                         # 头像图片
│   ├── team.png
│   ├── rum-team-lead.png
│   ├── rum-integration-specialist.png
│   └── rum-performance-analyst.png
├── agents/                          # Agent 定义
│   ├── rum-team-lead.md             # 主理人（含团队协作铁律）
│   ├── rum-integration-specialist.md
│   └── rum-performance-analyst.md
├── skills/                          # 共享技能
│   ├── rum-sdk-setup/               # SDK 接入技能（含 en/ 英文文档）
│   └── tencent-cloud-rum-zh-2.1/    # 数据分析技能 v2.1
├── tests/                           # 专家团测试计划配套
│   ├── lint.py                      # L0 工程规范一致性自检
│   ├── cases/prompts.md             # L1-L8 用例 prompts
│   └── scorecard.template.md        # 评分卡模板
├── TEST_PLAN.md                     # 完整测试计划（60 例 + L0 自动化）
├── settings.json                    # 主理人设置
└── README.md                        # 本文件
```

## 测试

完整测试方案见 [`TEST_PLAN.md`](./TEST_PLAN.md)，60 个用例分 L0-L8 九层覆盖：路由 / 协作铁律 / Aiden 三类任务流 / Nova 四大分析流程 / 全链路 / 边界拒答 / 工程规范。

```bash
# L0 工程规范自动化校验（每次发版前必跑）
cd "rum-fullstack-team v2"
python3 tests/lint.py
```

L1-L8 用例 prompts：见 [`tests/cases/prompts.md`](./tests/cases/prompts.md)；
评分卡模板：见 [`tests/scorecard.template.md`](./tests/scorecard.template.md)。

## 打包

```bash
cd "/Users/lauraytwu/Desktop/workbuddy专家团"
zip -r rum-fullstack-team-v2.zip "rum-fullstack-team v2" -x "*.DS_Store"
```

## 一致性自检

- [x] `.workbuddy-plugin/plugin.json` 存在且字段齐全
- [x] `expertType=team`，`agentName=rum-team-lead`
- [x] `teamInfo.memberAgents[]` 与 `members[]` 中 `id` 完全对齐
- [x] 主理人 MD 文件名加专家团前缀（`rum-team-lead.md`），含「团队协作机制（铁律）」
- [x] 所有 Agent MD `frontmatter` 不含 `tools` 字段
- [x] `profession` 与 `displayName` 一致（Team 型规范）
- [x] `displayDescription.zh` 字数 40-50 字
- [x] `defaultInitPrompt` 与 `quickPrompts[0]` 一致
- [x] `tags` 与 `quickPrompts` 各 3 个，全部含中英文
- [x] `skills[]` 路径下均存在对应的 `SKILL.md`
- [x] `settings.json.agent` = `plugin.json.agentName`
- [x] 不包含 `hooks/` / `commands/` / `.lsp.json`

## 注意事项

1. 上报 ID（`id`）是公开前端标识，不是 SecretKey，可以写入前端代码
2. 分析师调用的 RUM v2.1 MCP（SSE）通过 HTTP Headers 传递 `SecretId/SecretKey`，不要硬编码进代码仓库
3. 接入官不处理数据查询，分析师不处理 SDK 接入，主理人负责路由
4. 非腾讯云监控平台（Sentry/Datadog）、纯后端性能、原生 App 性能不在服务范围
