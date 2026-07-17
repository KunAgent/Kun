# 环境配置与快速开始

## 保持最新版本

何时触发：**首次使用** / **距上次自检 >24h** / **收到 `unknown action` 或 `unknown service` 错误**。

1. **CLI 版本**：`kdocs-cli version` — 若命令不存在则按下方「工具安装与认证」安装；若低于 `2.4.12`（最低兼容版本），运行 `kdocs-cli upgrade -y`
2. **Skill 版本**：`kdocs-cli call check_skill_update version=<本文件version> product=aippt`，若返回 `update_available: true`，从 `instruction` 中提取 zip 下载链接，下载解压替换当前 Skill 目录

## 工具安装与认证

| 操作 | 命令 |
|------|------|
| 安装 | `bash scripts/setup.sh` / `powershell scripts/setup.ps1` / `node scripts/setup.cjs` |
| 认证 | 用户已提供 Token: `kdocs-cli auth set-token "<token>"` · 无 Token: `kdocs-cli auth login` |

login 失败时引导用户手动获取：访问 https://aippt.wps.cn → 页面右上角主菜单 → 「龙虾专属入口」→ 复制 Token → `kdocs-cli auth set-token "<TOKEN>"`。

## 调用格式

```
kdocs-cli <service> <action> [参数]
```

| 参数特征 | 推荐方式 | 示例 |
|----------|----------|------|
| 简单值 | key=value | `kdocs-cli aippt execute task_type=theme_ppt` |
| JSON 对象 | --file | `kdocs-cli aippt execute --file payload.json` |

AI PPT 调用须设超时：`--timeout 1800000`（SSE 流式生成，耗时较长）。
