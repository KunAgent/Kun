---
name: md-to-html
description: 把腾讯自选股股票投研圆桌报告渲染成 Anthropic 浅色风的单文件 HTML。主理人写完 <主题>-圆桌报告.md 后，再写一份 body 片段，调用本 skill 的 render.py 合成最终 HTML（CSS 内联、头像 base64 嵌入，可直接双击打开或微信/邮件分享）。
---

# md-to-html

**作用**：把主理人写的 HTML body 片段套进 `shell.html`，输出最终 `<主题>-圆桌报告.html`（含完整 CSS + 嵌入头像）。默认在对话中输出 HTML 内容；仅当用户要求保存文件时，才写入 `deliverables/stock-partner/<YYYY-MM-DD>/` 目录。

**何时调用**：主理人（stock-partner-lead）写完 `<主题>-圆桌报告.md` 后，按 [components.md](./components.md) 写一份 body 片段，调用 `scripts/render.py`。成员个人报告 `<主题>-<头衔>.md` **不**调用本 skill。

---

## 工作流（agent 视角）

1. **读** [`components.md`](./components.md)：了解 7 个区块（nav / hero / 4 模块 / passage 兜底）的 class 与 HTML 模板
2. **读** [`avatar-mapping.md`](./avatar-mapping.md)：知道头像 src 怎么写（中文头衔 → `avatars/<kebab>.png`）
3. **写 body 片段** `<主题>-圆桌报告.body.html`，与 md 同目录：包含 nav + hero + 4 模块 + （如需）passage-card；**不要**写 `<head>` / `<style>` / `<footer>` / `<body>` 这些标签——它们都在 shell 里
4. **跑 render.py**：

```bash
python3 plugins/stock-partner-team/skills/md-to-html/scripts/render.py \
  deliverables/stock-partner/<YYYY-MM-DD>/<主题>-圆桌报告.body.html \
  deliverables/stock-partner/<YYYY-MM-DD>/<主题>-圆桌报告.html \
  --title="<主题> · 腾讯自选股股票投研圆桌报告" \
  --date=<YYYY-MM-DD>
```

`render.py` 会**自动**：
- 调 `scripts/embed_avatars.py` 把 `<img src="avatars/*.png">` 替换成 base64
- 渲染成功后**删除 body 片段文件**（保持目录干净）。如果你在调试想保留 body 片段，加 `--keep-body`

最终产物可独立分发。

---

## 文件清单

| 文件 | 谁读 | 作用 |
|---|---|---|
| `SKILL.md`（本文）| agent | 调用入口 |
| `components.md` | **agent 必读** | 组件 API 手册（class + HTML 模板）|
| `avatar-mapping.md` | **agent 必读** | 中文头衔 ↔ 头像文件名 |
| `shell.html` | 仅 render.py | 外壳（含全部 CSS）；agent **不读** |
| `scripts/render.py` | agent 调用 | 注入器：body → 完整 HTML |
| `scripts/embed_avatars.py` | render.py 自动调用 | 把头像 png 嵌成 base64 |

---

## 不变量（agent 自检）

- body 片段里**不含** `<!DOCTYPE>` / `<html>` / `<head>` / `<style>` / `<body>` / `<footer>` 标签
- body 片段以 `<nav>` 开头，以最后一个 `</section>` 结尾
- `<img>` 头像 src 全部是 `avatars/<kebab>.png` 形式（不是绝对路径，不是 base64——base64 由脚本做）
- 4 个模块 ID 固定：`#conclusion` / `#voices` / `#thinking` / `#watch`

不满足任一条 = body 不合规，render.py 仍能生成 HTML 但效果会出错。

---

## 排错

- **render.py 报"shell.html 缺少占位符"**：shell.html 被改坏了，应该有 `{{TITLE}}` / `{{BODY}}` / `{{DATE}}` 三个占位符
- **embed_avatars 警告"头像文件缺失"**：检查 `avatar-mapping.md`，src 拼错了或对应 png 不存在
- **CSS 错位 / 视觉跑偏**：检查 body 片段是否用了 `components.md` 之外的 class，或者写了自己的 `<style>`
