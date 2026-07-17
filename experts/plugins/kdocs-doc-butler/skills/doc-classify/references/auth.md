# 认证详情与环境配置

> 何时打开：获取脚本失败需手动获取 Token / 需要了解 setup.sh 内部流程 / 需要迁移旧配置。日常使用无需阅读。

## 手动获取 Token（脚本失败时的兜底方案）

当 `get-token` 脚本因环境问题执行失败时，引导用户手动获取：

1. 用户在浏览器访问 https://www.kdocs.cn/latest（需已登录 WPS 账号）
2. 点击页面右上角个人头像旁的主菜单 → 选择「龙虾专属入口」→ 复制 Token
3. 用户将 Token 提供给 Agent
4. Agent 将 Token 写入 mcporter（`<VERSION>` 从 SKILL.md frontmatter 的 `version` 字段读取）：

```bash
mcporter config remove kdocs 2>/dev/null; mcporter config add kdocs "https://mcp-center.wps.cn/skill_hub/mcp" --header "Authorization=Bearer <TOKEN>" --header "X-Skill-Version=<VERSION>" --transport http --scope home
```

写入后调用任意读取工具验证（`code: 0` 即成功）。

## 环境配置

本 Skill 通过 MCP 协议提供服务，可在任何支持 MCP 的 Agent 中运行（如 OpenClaw、Cursor、Claude Code 等）。

**自动化注册**：运行 `bash scripts/setup.sh` 即可完成 MCP 服务注册。`setup.sh` 会自动完成：
1. 从 `SKILL.md` frontmatter 提取 `version` 版本号
2. 检查 `mcporter` 中现有的 `kdocs` 配置，并在版本更新时保留旧 Token
3. 若检测到历史 `.env` 或环境变量 `KINGSOFT_DOCS_TOKEN`，仅做一次性迁移到 `mcporter`（`.env` 只移除 token 键并保留其他配置）
4. 注册 `mcporter` 时携带 `Authorization`、`X-Skill-Version` 和 `X-Request-Source` header

首次使用时会自动拉起授权；若检测到 Token 过期，也会自动调用 `get-token.sh` 重新获取。默认不会自动全局安装 `mcporter`，若需要可显式追加 `--auto-install-mcporter`。

**手动配置（其他 MCP 客户端）**：仅维护 `mcporter` 中的 `kdocs` 配置，不要额外维护 `.env` 或 `KINGSOFT_DOCS_TOKEN`。建议在请求 header 中添加 `X-Skill-Version` 和 `X-Request-Source` 以便追踪版本和渠道来源。

## 获取脚本平台选择

| 平台 | 脚本 | 备注 |
|------|------|------|
| Linux / macOS | `bash scripts/get-token.sh` | 自动尝试打开浏览器登录页 |
| Windows + Node.js | `node scripts/get-token.js` | 优先使用 |
| Windows 无 Node.js | `powershell -ExecutionPolicy Bypass -File scripts\get-token.ps1` | 兜底方案 |

如需允许脚本自动安装 `mcporter`，追加参数：Node / Bash: `--auto-install-mcporter`，PowerShell: `-AutoInstallMcporter`。

## 旧配置迁移

若检测到历史 `.env` 或环境变量 `KINGSOFT_DOCS_TOKEN`，只允许做一次性迁移到 `mcporter`：
- `.env` 仅移除 `KINGSOFT_DOCS_TOKEN` 键（其他键保留）
- 若 `.env` 仅含该键则直接删除空 `.env` 文件
- 迁移后禁止继续写入 `.env` 或环境变量
