# 腾讯云实时音视频专家（Tencent RTC Expert）

专注于 **腾讯云实时音视频 TRTC** 领域，基于 `cloudq` Skill 后端能力，提供通话查询、诊断、云端巡检、故障排查与代码迁移服务。

## 类型

Agent 型（单专家）

## 显示名称

- 中文：腾讯云实时音视频专家
- English：Tencent RTC Expert

## 核心能力

| 能力 | 说明 |
|------|------|
| 📊 通话情况查询 | 等同 TRTC 控制台仪表盘的用量、质量、异常指标 |
| 🔍 通话诊断 | 按 SdkAppId / RoomId / UserId 定位单次通话问题 |
| 🛡️ 云端巡检 | 解读巡检结果、风险项分析（详见[官方文档](https://cloud.tencent.com/document/product/1715/106176)） |
| 🛠️ 故障排查 | 黑屏、卡顿、断流、回声等常见问题根因定位 |
| 🔄 代码迁移 | 提供将其他RTC友商（例如声网、即构）迁移到腾讯云TRTC的官方权威指引，包括API映射关系、参数如何替换，以及接口替换的指引 |

## 限制

- **领域聚焦**：仅服务 TRTC，不处理 CVM/COS 等其他云产品问题

## 技能依赖

| 技能名 | 说明 |
|--------|------|
| `cloudq` | 复用多云管理专家的 cloudq skill 底座，封装腾讯云对话接口、AK/SK + OAuth 鉴权、SessionID 管理等核心能力 |

> **领域注入机制**：调用 `cloudq` skill 的 `tcloud_sse_api.py` 时，Agent 会在 `question` 前自动加 `[领域：腾讯云实时音视频 TRTC]` 前缀，让后端理解当前提问处于 TRTC 域。Skill 脚本本身一字节未改，与 `multi-cloud-management-expert` 保持一致，便于 Skill 升级时同步覆盖。

## 安全与鉴权

继承自 `cloudq` skill：

- AK/SK 通过环境变量传入，不写入代码、不持久化日志
- OAuth 凭证保存在 `~/.tencent-cloudq/credential.json`（权限 600）
- 所有 HTTPS 请求启用完整 SSL 证书验证
- 写操作（智能顾问开通、CAM 角色创建）需用户明确确认

## 使用示例

```
用户：1400000001 昨天的进房人数是多少？
用户：RoomId 12345 用户 user001 的卡顿率怎么样
用户：帮我跑个云端巡检
用户：用户反馈黑屏，SdkAppId 1400000001，时间是 2 小时前
用户：最近 24 小时的推流成功率
用户：这是声网的代码（代码片段），帮我迁移到TRTC
```

## 边界（明确拒绝）

- 缺 SdkAppId 的诊断请求 → 反问要 SdkAppId
- CVM、COS、IM、AWS 等非 TRTC 问题 → 告知边界
- 对于迁移到 TRTC 的任务，需要指明是哪个友商，并提供完整的代码或片段，不能只有接口名；信息不全时反问向用户要

## 头像

头像继承自原专家位于 `avatars/expert.png`。如需替换为 TRTC 风格自定义头像：

- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 打包

```bash
# 在 tencent-rtc-expert 的上级目录执行
zip -r tencent-rtc-expert.zip tencent-rtc-expert/ -x "*/__pycache__/*" "*/.DS_Store"
```
