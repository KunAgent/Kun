# 交付指南：从 MD 到多格式

**版本**：2.0

## 交付等级说明（D1 / D2 / D3）

| 等级 | 名称 | 条件 | 说明 |
|------|------|------|------|
| **D1** | 完整 HTML 交付 | 有 Node.js ≥ 18 环境 | 运行 `node assets/build.mjs` 生成带完整 CSS/字体的 HTML，通过 smoke 测试 |
| **D2** | 降级 HTML 交付（无 Node） | 无 Node 环境 / 构建失败 | 使用 `assets/` 目录中的静态降级模板（`template-fallback.html`），手动替换 `{{content}}` 占位符；CSS 内联，无外部依赖；通过 smoke 测试 `--fallback-mode` |
| **D3** | 草稿 MD 交付 | 仅用于内部传递 | 直接交付 Markdown 终稿。**禁止以 D3 对外声明「已完成 HTML 交付」**；须在文件头标注「草稿版，非终稿 HTML」 |

> **⚠️ 禁止 D3 冒充 D1/D2**：`html-deliverable-gate.md` 明确禁止将无 CSS 的裸 Markdown 渲染结果或未通过 smoke 测试的 HTML 文件对外声明为已交付终稿。遇到无 Node 环境时，应走 **D2 降级路径**，而非以 D3 敷衍了事。

## 步骤摘要

### D1 路径（推荐，需 Node.js ≥ 18）

1. 以**本书根**维护终稿 Markdown（及 `.fbs/` 元数据）。
2. 以**技能根**执行（需 Node.js ≥ 18；脚本随平台侧包附带，升级后即可用）：
   `node assets/build.mjs`（可加 `--check`）→ 生成 HTML。
3. D1 终稿：跑 `node scripts/html-delivery-smoke.mjs --html <out.html> --strict --fail-on-warn`。
4. PDF / DOCX：本地构建可分别使用 `puppeteer` / `html-to-docx` 可选依赖；若宿主提供 `pdf` / `docx` 插件，也可走宿主插件交付链。

### D2 路径（降级，无 Node 环境）

1. 确认环境无 Node.js 或 `node assets/build.mjs` 失败（记录失败原因）。
2. 使用 `assets/template-fallback.html`（内置 CSS 静态模板），手动将 Markdown 正文转为 HTML 段落（可用在线 MD→HTML 转换工具）。
3. 将生成内容替换 `{{content}}` 占位符，保存为 `<书名>-fallback.html`。
4. 烟雾测试（降级模式）：人工检查 HTML 可在浏览器打开、图片正常显示、无明显布局错误。
5. 交付文件头标注：「D2 降级交付（无 Node 环境）」，让接收方知晓非 D1 完整构建。

## 安装

见 [`01-user-install-guide.md`](../03-product/01-user-install-guide.md)。
