# Humanize PPT Team

Humanize PPT Team 是一个面向演示文稿交付的专家团：先把原始材料梳理成 AST（Audience-State-Transfer）大纲，再调度 HTML PPT 生成、视频/动效、演讲模式、部署/导出与最终质检。

## 团队成员

| Agent | 职责 | 绑定能力 |
|---|---|---|
| `humanize-ppt-team-lead` | 创建团队、调度成员、传递上下文、汇总交付 | TeamCreate / Agent spawn / SendMessage |
| `outline-director` | 将原始材料转成 AST 大纲和生产契约 | `humanize-ppt` |
| `guizang-renderer` | 生成中文稳定版单文件 HTML PPT | `guizang-ppt-skill` |
| `frontend-slides-renderer` | 生成风格探索版、可部署 HTML Slides | `frontend-slides` |
| `video-motion-agent` | 将视频位转成 Remotion 计划或动效 brief | `remotion-video-toolkit` |
| `html-ppt-presenter` | 增加演讲模式、speaker notes、逐字稿和计时器 | `html-ppt` |
| `qa` | 检查页面、素材、视频、演讲模式、部署/PDF 和 manifest | 无独立 Skill |

## 推荐工作流

1. 用户提供主题、资料、旧 PPT、链接或笔记。
2. 主理人先创建团队，再调度 `outline-director` 输出 6 个生产契约：
   - `deck_brief.md`
   - `ast_outline.md`
   - `slide_plan.json`
   - `speaker_intent.md`
   - `asset_manifest.md`
   - `video_slots.json`
3. 根据交付目标调度 HTML PPT 生成成员：
   - 稳定中文杂志风：`guizang-renderer`
   - 风格探索与部署/PDF：`frontend-slides-renderer`
4. 如需要视频、动效或社媒切片，调度 `video-motion-agent`。
5. 如需要演讲者模式或逐字稿，调度 `html-ppt-presenter`。
6. 最后调度 `qa` 输出 `qa_report.md`、`fix_list.md`、`final_manifest.json`。

## 运行依赖

| 能力 | 依赖 | 验证命令 | 说明 |
|---|---|---|---|
| HTML PPT 生成 | 浏览器 | 打开生成的 `index.html` | 纯静态 HTML/CSS/JS 为主 |
| PPTX 提取 | Python 3 + `python-pptx` | `python -c "import pptx"` | 如需转换 `.pptx` 时使用 |
| 图片处理 | Python 3 + `Pillow` | `python -c "import PIL"` | 如需图片尺寸/格式处理时使用 |
| PDF 导出 | Node.js + Playwright | `npx playwright --version` | `frontend-slides/scripts/export-pdf.sh` 会在临时目录安装 Playwright |
| URL 部署 | Node.js + Vercel CLI | `npx --yes vercel whoami` | 需要用户先手动登录 Vercel |
| 视频渲染 | Node.js 18+ + Remotion | `npx remotion --version` | 可先输出 Remotion plan，未渲染时需说明原因 |
| PNG 截图 | Chrome / Chromium / Edge | `CHROME=/path/to/browser bash scripts/render.sh deck.html` | `html-ppt/scripts/render.sh` 支持自动探测或 `CHROME` 覆盖 |

## 最小验证样例

```bash
# 1. 生成 AST 大纲样例
python skills/humanize-ppt/scripts/humanize_ppt_v1.py \
  --source skills/humanize-ppt/examples/01-ai-tool-update/source.md \
  --out .humanize-ppt-runs/ai-tool-update \
  --title "AI 工具更新，不只是功能清单"

# 2. 检查 guizang 模板占位符
python - <<'PY'
from pathlib import Path
p = Path('skills/guizang-ppt-skill/assets/template.html')
text = p.read_text(encoding='utf-8')
assert '[必填]' in text, 'template placeholder check: expected template placeholder in source template'
print('template readable')
PY

# 3. 检查 frontend-slides PDF 导出依赖
npx --yes playwright --version
```

## 失败降级

- 如果某个 Skill 不可读，成员必须回传“Skill 未加载/不可读”的原因，并输出 adapter brief，不得假装完成。
- 如果无法生成真实视频，`video-motion-agent` 必须输出 `remotion_plan.md`、渲染命令、poster/fallback still，而不能把计划冒充成成品视频。
- 如果 Vercel 未登录，部署脚本只提示用户手动登录并退出，不自动发起交互式登录。
- 如果浏览器路径不可探测，设置 `CHROME=/path/to/browser` 后重试。

## 交付物清单

推荐最终交付目录：

```text
final/
  guizang/index.html
  frontend-slides/index.html
  presenter/
  video/
  qa_report.md
  fix_list.md
  final_manifest.json
```
