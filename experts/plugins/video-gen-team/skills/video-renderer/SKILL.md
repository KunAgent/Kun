---
name: video-renderer
description: |
  视频渲染技能，封装 edge-tts 配音生成与 HyperFrames 视频渲染两大工具。
  供灵映（ling-producer）调用，将灵枢输出的 JSON 制作包渲染为 MP4 视频成品。
  触发词：渲染视频、生成配音、TTS、edge-tts、HyperFrames、生成MP4、输出视频
---

# video-renderer — 视频渲染技能

## 功能说明

封装视频生成团队的渲染工具链，提供完整的"配音 → 字幕 → 渲染 → MP4"能力：

1. **edge-tts**：免费 TTS，无需 API Key，支持自动生成对齐字幕（推荐优先使用）
2. **HyperFrames**：来自 Heygen 的开源视频渲染框架，通过 HTML 定义合成逻辑，Puppeteer+FFmpeg 渲染为 MP4

## 环境要求

| 组件 | 版本要求 | 安装方式 |
|------|---------|---------|
| Node.js | >= 22 | `nvm install 22` |
| FFmpeg | 最新稳定版 | `brew install ffmpeg`（macOS）|
| Python | >= 3.9 | 系统自带或 pyenv |
| edge-tts | 最新版 | `pip install edge-tts` |
| Azure TTS SDK | 可选 | `pip install azure-cognitiveservices-speech` |

## 调用方式

### Step 1：生成配音 + 字幕（一次性完成）

```bash
edge-tts \
  --voice zh-CN-XiaoxiaoNeural \
  --rate +5% \
  --write-media /tmp/ling-factory/audio/[video_id].mp3 \
  --write-subtitles /tmp/ling-factory/srt/[video_id].srt \
  --text "完整旁白文案..."
```

**重要**：必须一次性同时生成 mp3 和 srt，禁止分开生成再手动对齐（会导致音画不同步）。

### Step 2：初始化 HyperFrames 项目

```bash
cd /tmp/ling-factory/hyperframes
npx hyperframes init [video_id]-project --template minimal
```

### Step 3：渲染 MP4

```bash
cd /tmp/ling-factory/hyperframes/[video_id]-project
npx hyperframes render [video_id] --output /tmp/ling-factory/output/[video_id].mp4
```

### Step 4：质量验证

```bash
# 检查文件大小（必须 > 1MB）
ls -lh /tmp/ling-factory/output/[video_id].mp4

# 验证时长（允许 ±5 秒偏差）
ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 \
  /tmp/ling-factory/output/[video_id].mp4

# 验证分辨率（必须 1920x1080 或 1080x1920）
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height \
  -of csv=s=x:p=0 \
  /tmp/ling-factory/output/[video_id].mp4
```

## 参考资料

- HyperFrames HTML 结构规范：@references/hyperframes-html-spec.md
- 风格背景模板：@references/style-backgrounds.md

## 注意事项

- 先运行 `node --version` 确认 >= 22，否则 HyperFrames 无法渲染
- HyperFrames HTML 必须包含 `data-composition-id`、`data-width`、`data-height` 以及 `window.__hf` 全局对象
- 渲染失败通常是 HTML 语法问题，检查 Puppeteer 日志定位
- 60秒视频渲染约需 1-3 分钟（视机器性能）
