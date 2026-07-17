---
name: douyin-resolver
description: |
  抖音视频解析技能。当用户发送抖音链接（douyin.com / v.douyin.com）、
  抖音分享口令（"复制打开抖音"）、或提到解析抖音、下载抖音视频、
  提取视频文案、视频转文字、语音转文本、抖音内容总结时，使用此技能。
  支持无水印视频下载 + 音频提取 + SiliconFlow 语音识别 + Markdown 文案输出。
  Use when: user pastes a douyin.com URL, shares a Douyin share text,
  or asks to extract/download/transcribe/summarize a Douyin video.
compatibility: "ffmpeg (必须), playwright (推荐), yt-dlp (可选)"
---

# 抖音统一解析器

输入一个抖音链接 → 自动三层降级解析 → 输出视频 + 音频 + 语音转文本。

## Quick Start

```bash
cd "<skill目录>"
node scripts/douyin_resolver.js resolve "<抖音链接>" -o ./output
```

成功后输出 JSON，包含视频/音频/封面/文案路径和语音识别文本。

## 触发条件

1. 用户消息包含 `douyin.com` 链接
2. 用户发来 `7.94 复制打开抖音...` 分享文本
3. 用户提到"解析抖音"、"提取视频"、"视频转文字"

---

## 操作步骤

### 第一步：检查环境

**1a. 检查 `.env` 文件**

读取 `<skill目录>/.env`。如果文件不存在或 `SILICONFLOW_API_KEY` 为空 / 值为 `your_api_key_here`：

1. 提示用户：
   > 需要硅基流动 API Key 做语音识别。
   > 1. 打开 https://cloud.siliconflow.cn/ 注册
   > 2. 在控制台获取 API Key
   > 3. 把 Key 发给我，我帮你配置
2. 用户提供 Key 后，将 `.env.example` 复制为 `.env`（如果 `.env` 不存在），然后写入：
   ```
   SILICONFLOW_API_KEY=<用户提供的Key>
   ```
3. 确认写入成功后继续下一步。

**1b. 检查 ffmpeg**

```bash
ffmpeg -version
```
未安装则引导安装（Mac: `brew install ffmpeg`）。

### 第二步：运行脚本（自动三层降级）

```bash
cd "<skill目录>"
node scripts/douyin_resolver.js resolve "<抖音链接>" -o ./output
```

设 timeout 180 秒。脚本自动按顺序尝试三个层级，无需手动干预：

1. **Level 1**：抖音 Web API + HTML DOM 解析（最快，3-10s）
2. **Level 2**：Playwright 无头浏览器拦截视频流（15-30s）
3. **Level 3**：yt-dlp 兜底下载（10-60s）

如果成功，跳到第三步。三层全部失败则告知用户可能原因。

### 第三步：输出结果

脚本成功后在 stdout 输出 JSON：

```json
{
  "video_info": { "video_id": "...", "title": "...", "url": "..." },
  "video_path": "./output/<video_id>/<video_id>.mp4",
  "audio_path": "./output/<video_id>/<video_id>.mp3",
  "cover_path": "./output/<video_id>/<video_id>.jpg",
  "transcript_path": "./output/<video_id>/<video_id>.md",
  "text_content": "语音识别的完整文本...",
  "media_info": { "duration": 60.5, "size": 15728640 },
  "resolve_method": "api | browser | ytdlp",
  "output_folder": "./output/<video_id>"
}
```

输出文件：

```
output/<video_id>/
├── <video_id>.mp4   # 无水印视频
├── <video_id>.mp3   # 音频
├── <video_id>.jpg   # 封面
└── <video_id>.md    # 文案（含元信息 + 语音识别文本）
```

根据用户意图选择输出方式：

| 用户意图 | 处理方式 |
|---------|---------|
| 只发了链接 | 输出视频标题 + 内容摘要 + 逐字稿预览 |
| 要总结 | 基于文本做 AI 总结 |
| 要逐字稿 | 直接展示完整 text_content |
| 要讨论 | 总结 + AI 分析观点 |

---

## 依赖

| 依赖 | 必须？ | 用途 |
|------|--------|------|
| ffmpeg + ffprobe | 必须 | 音频提取、封面提取 |
| `SILICONFLOW_API_KEY` | 必须 | 硅基流动语音识别（SenseVoiceSmall） |
| playwright | 推荐 | Level 2 浏览器模式 |
| yt-dlp | 可选 | Level 3 兜底 |

---

详细降级策略和技术原理见 `references/technical.md`。
常见问题排查见 `references/troubleshooting.md`。
