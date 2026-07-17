# 腾讯云 DevOps 专家（CloudQ）

CloudQ 是腾讯云 DevOps 专家、ITOM "领域虾"——基于腾讯云智能顾问（TSA）打造，集 **全渠道 ChatOps · 全天候 AIOps · 全方位 CloudOps** 三大能力于一体。一只虾管理所有云。

## 类型

Agent 型（单专家）

## 显示名称

- 中文：腾讯云DevOps专家
- English：Tencent Cloud DevOps Expert

## 功能

- **🦞 全渠道 ChatOps**：自然语言管理多云资源，覆盖 IDE / 企微 / 微信 / 飞书 / 钉钉 / Slack
- **🤖 全天候 AIOps**：架构智能巡检（安全 / 性能 / 可靠性 / 成本四维）、Well-Architected 架构评估、AI 容量监测、AI 混沌演练、AI 云诊断、主动预警
- **☁️ 全方位 CloudOps**：腾讯云、阿里云、AWS、Azure、GCP 统一管理、架构可视化、FinOps 成本治理、闲置资源盘点、云产品最佳实践

## 技能

| 技能名 | 说明 |
|--------|------|
| `cloudq` | 封装腾讯云智能顾问 API 调用、多云架构治理、智能巡检、Well-Architected 评估、AI 云诊断、AK/SK 鉴权与免密链接生成等核心能力 |

## 安全与鉴权

- AK/SK 通过环境变量传入，不写入代码、不持久化日志
- IAM 写操作（角色创建、智能顾问开通）需用户显式确认
- 临时凭证仅在内存使用
- 所有 HTTPS 请求启用完整 SSL 证书验证
- 配置文件仅存 Role ARN，不存任何密钥

## 使用示例

- 列出我所有的架构图并显示健康度评分
- 对我的生产架构做一次智能巡检并生成可视化 HTML 报告
- 盘点我账号下的闲置云资源并给出 FinOps 优化建议
- 帮我开通智能顾问
- CVM 公网带宽如何升级？

## 头像

头像已自动生成在 `avatars/expert.png`。如需替换为自定义头像，要求：

- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 打包

```bash
zip -r multi-cloud-management-expert.zip multi-cloud-management-expert/
```
