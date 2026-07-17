# 外部依赖清单

CPQ 专家的 skill 依赖以下外部运行时和 CLI 工具。

## 运行时

| 名称 | 最低版本 | 安装方式 | 备注 |
|---|---|---|---|
| Node.js | 18.0.0 | `nvm install 18` 或官方安装包 | tcloud-price CLI 及 skill 脚本运行时 |
| Python | 3.9 | 系统自带或 `pyenv install 3.9` | migraq 迁移测算脚本 |

## CLI 工具

| 名称 | 来源 | 安装方式 | 用途 |
|---|---|---|---|
| `tcloud-price` | 腾讯云内部 npm registry | `npm install -g @tencent-cloud/tcloud-price` | 查询腾讯云产品公开价（CVM/CBS/网络等） |

## 网络依赖

| 服务 | 域名/端点 | 用途 |
|---|---|---|
| CMG Migraq API | 内网 gRPC | 迁移测算（友商资源评估 → 腾讯云方案推荐） |
| 腾讯云 API | `cvm.tencentcloudapi.com` 等 | 产品询价 |
| 工蜂 API | `git.woa.com` | /feedback 反馈提交 |

## 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `TCLOUD_SECRET_ID` | 否 | 腾讯云 API 密钥 ID |
| `TCLOUD_SECRET_KEY` | 否 | 腾讯云 API 密钥 Key |
| `CMG_ENDPOINT` | 否 | Migraq API 地址（默认使用内网地址） |
| `CMG_REGION` | 否 | Migraq API 地域（默认 ap-shanghai） |
| `CMG_NO_AUTH_HOST` | 否 | Migraq 免鉴权 endpoint host（默认 msp.cloud.tencent.com） |
| `CMG_NO_AUTH_PATH` | 否 | Migraq 免鉴权 endpoint path（默认 /open/chat） |
| `CMG_NO_AUTH_SCHEME` | 否 | Migraq 免鉴权 endpoint scheme（默认 https） |
| `TCLOUD_PRODUCT_MCP_URL` | 否 | 腾讯云产品 MCP 服务地址（默认 http://portal-mcp-server.woa.com/mcp） |
| `CPQ_TMP_DIR` | 否 | CPQ 会话临时目录覆盖（默认 `<cwd>/.cpq-tmp/`） |

## 鉴权流程

CPQ 专家通过 `command-auth` wrapper 进行鉴权。首次使用或 token 过期时，需执行以下命令完成鉴权：

```bash
command-auth whoami
```

若返回未鉴权错误，按 CLI 输出的引导完成鉴权流程。鉴权成功后，后续 `cpq`、`tcloud-price` 等命令即可正常使用。

详细鉴权说明见各 Skill 文档：
- `cpq` skill：`../cpq/SKILL.md § cpq CLI 工具箱`
- `tencent-cloud-pricing` skill：`../tencent-cloud-pricing/SKILL.md § 调用约定`
