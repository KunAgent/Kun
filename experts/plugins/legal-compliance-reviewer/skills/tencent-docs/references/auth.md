# 腾讯文档鉴权检查

腾讯文档授权流程，**必须按以下步骤执行**：

## 第一步：检查状态（立即返回）

```bash
bash ./setup.sh tdoc_check_and_start_auth
```

| 输出 | 处理方式 |
|------|---------|
| `READY` | ✅ 直接执行用户任务，**无需后续步骤** |
| `AUTH_REQUIRED:<url>` | 向用户展示授权链接（见下方模板），**等待用户回复"已完成授权"后再执行第二步** |
| `ERROR:*` | 告知用户具体错误信息，并引导走**第三步人工兜底**手动设置 Token |

> ⛔ **严格禁止**：收到 `AUTH_REQUIRED` 后，必须先向用户展示授权链接，**等待用户发送新消息确认已完成授权**，才能进行第二步。

## 第二步：用户确认已完成授权后，主动查询 Token

> ✅ **触发条件**：用户在新消息中明确回复"已授权"、"完成了"、"已完成授权"、"授权好了"等确认信息后，**才执行本步骤**。

```bash
bash ./setup.sh tdoc_fetch_token
```

| 输出 | 处理方式 |
|------|---------|
| `TOKEN_READY` | ✅ 授权成功，继续执行用户任务 |
| `ERROR:not_authorized` | 告知用户：「您尚未完成授权，请在浏览器中完成后回复我。」（**不要重新生成链接**，等用户再次确认后重试本步骤） |
| `ERROR:expired` | 告知用户：「您的腾讯文档 Token 已过期，请访问 [获取新 Token](https://docs.qq.com/scenario/open-claw.html) 重新获取，然后告诉我新的 Token，我来帮您重置。」（引导用户走**第三步人工兜底**手动设置 Token） |
| `ERROR:token_invalid` | 告知用户：「Token 已失效，请重新授权。」（需重新执行第一步） |
| `ERROR:vip_required` | 告知用户：「当前操作需要腾讯文档 VIP 权限，请立即升级 VIP：[点击购买 VIP](https://docs.qq.com/vip?immediate_buy=1?part_aid=persnlspace_mcp)」 |
| `ERROR:*` | 告知用户具体错误信息（错误码+描述），并引导走**第三步人工兜底**手动设置 Token |

## 第三步：人工兜底

🔑 **检查 Token 配置**：可访问 [https://docs.qq.com/scenario/open-claw.html](https://docs.qq.com/scenario/open-claw.html) 获取 Token，再执行以下命令来设置mcporter:
```bash
# 使用传入的 Token 写入 mcporter 配置（tencent-docs）
mcporter config add tencent-docs "https://docs.qq.com/openapi/mcp" \
    --header "Authorization=$Token" \
    --transport http \
    --scope home
```

## 授权链接展示模板

当第一步输出 `AUTH_REQUIRED:<url>` 时，向用户展示：

> 🔑 **需要先完成腾讯文档授权**
>
> 请在**浏览器**中打开以下链接完成授权：**[点击授权腾讯文档]({url})**
>
> ⚠️ 请使用 **QQ 或微信** 扫码 / 登录授权
>
> ⏰ **授权链接有效期为 5 分钟**，请尽快完成授权，超时后需重新发起请求
>
> ✅ **完成授权后，请回复我「已完成授权」，我会继续帮您完成操作**

> ⛔ **AI 注意**：展示上方授权链接后，**必须停止等待**，不得自动调用 `tdoc_fetch_token` 或任何其他工具。只有当用户在下一条新消息中明确回复确认后，才能继续执行第二步。

## 错误说明

| 错误 | 含义 |
|------|------|
| `ERROR:mcporter_not_found` | 缺少依赖，请先安装 Node.js |
| `ERROR:not_authorized` | 用户尚未在浏览器完成授权，等待用户确认后重试 |
| `ERROR:expired` | 授权码已过期，重新执行第一步 |
| `ERROR:token_invalid` | Token 鉴权失败（400006），重新授权 |
| `ERROR:vip_required` | VIP 权限不足（400007），引导用户升级 VIP：https://docs.qq.com/vip?immediate_buy=1?part_aid=persnlspace_mcp |
| `ERROR:save_token_failed` | Token 写入配置失败 |
| `ERROR:no_code` | 未找到授权码，需重新执行第一步 |
| `ERROR:network` | 网络请求失败，检查网络后重试 |
