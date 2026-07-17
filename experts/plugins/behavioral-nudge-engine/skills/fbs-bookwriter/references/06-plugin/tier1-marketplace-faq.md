# Tier1 本地市场技能常见问题（WorkBuddy）

> **版本**：2.1.1  

## `workbuddy/channel-manifest.json` 里的 `preferredSkills` 与源码树不一致？

**正常现象。** 清单列出的是「建议从 `~/.workbuddy/skills-marketplace/skills/` 安装」的技能 id；**源码仓库**可能只 **部分** 拷贝到 `.codebuddy/skills/` 用于开发/打包演示。部分技能（如 `humanizer`、`pptx-generator`）**仅随市场安装**，不要求出现在仓库目录中。

## `minimax-xlsx` 在仓库里有，为何不在 `preferredSkills`？

**刻意设计。** WorkBuddy 本地市场 **不将 minimax-xlsx 作为 Tier1 依赖**；Excel 统一走 **Tier2 `xlsx` 插件**（见 `provider-registry.yml` 的 `xlsx-data`）。仓库中的 `minimax-xlsx` 为可选增强包，探测逻辑以 `host-capability` 为准。

## 用户看到「只装了 3/17 个技能」是否正常？

**正常。** `intake-router` / `host-capability` 会给出 `tier1.marketplaceSummary`（已探测/总数）。未全部安装时按 **provider 降级链路** 执行，并在文案中提示「未装全为正常」。
