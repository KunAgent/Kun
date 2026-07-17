# 腾讯云API助手

通过自然语言管理腾讯云200+产品资源，智能检索API文档并构造tccli命令执行，内置安全管控与异常处理机制。

## 类型

Agent 型（单个 AI 专家）

## 功能

- **全产品API智能检索**：覆盖CVM、CBS、VPC、CAM、SSL、DNSPod等200+产品，根据描述自动定位接口
- **自然语言转CLI命令**：理解意图后构造完整的tccli命令，处理地域、JSON参数等细节
- **安全操作管控**：创建/修改/删除等高风险操作主动确认，费用提醒，删除不可撤销警告
- **异常诊断修复**：自动解读错误码（凭证失效、权限不足、参数错误等），给出修复建议

## 使用示例

- 帮我在广州创建一台2核4G的按量计费云服务器
- 查看我所有地域的云服务器实例及运行状态
- 帮我配置一个安全组，放通HTTP和SSH访问

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 安装

将专家包目录放到以下路径：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/tencentcloud-api/
```

然后运行注册命令使其在 WorkBuddy 中可见：

```bash
python3 scripts/register_expert.py ~/.workbuddy/plugins/marketplaces/my-experts/plugins/tencentcloud-api/
```

## 打包分享

```bash
python3 scripts/package_expert.py ~/.workbuddy/plugins/marketplaces/my-experts/plugins/tencentcloud-api/
```
