---
name: douyin-script-analyzer
description: 抖音拍摄脚本分析器 - 输入抖音链接，自动提取视频文案并分析拍摄手法，生成完整的拍摄脚本分析文档（景别、运镜、剪辑节奏、脚本结构拆解等），并自动按镜头裁剪视频片段。当用户需要分析抖音视频的拍摄脚本、学习拍摄技巧、或复刻视频时激活此技能。
dependency:
  python:
    - requests>=2.31.0
  system:
    - ffmpeg
    - ffprobe
---

# 抖音拍摄脚本分析器

## 任务目标

本技能用于：输入抖音分享链接 → 自动提取视频文案 + 分析拍摄手法 → 生成完整的拍摄脚本分析文档

核心能力：
- 自动解析抖音分享链接，获取无水印视频
- 语音识别提取视频口播文案
- AI 分析拍摄手法（景别、运镜、剪辑节奏、镜头时长等）
- 生成结构化的拍摄脚本拆解文档（中文输出）
- 自动按镜头裁剪视频，每个片段命名为 `序号_景别_主题.mp4`
- 提取封面作为参考

触发条件：用户需要分析抖音视频的拍摄脚本、学习拍摄技巧、复刻视频、或做视频内容研究时。

## 前置要求

### 环境变量配置

使用前需配置以下环境变量（**两者都需要配置**）：

#### 1. 硅基流动 API 密钥（语音识别）

- 变量名：`DOUYIN_API_KEY` 或 `API_KEY`
- 获取方式：访问 https://cloud.siliconflow.cn/ 注册并获取 API Key
- 用途：从视频音频中提取口播文案
- 配置示例：
  ```bash
  export DOUYIN_API_KEY="your-api-key"
  ```

#### 2. 火山方舟 API 密钥（视频理解）

- 变量名：`ARK_API_KEY`
- 获取方式：访问 https://www.volcengine.com/product/ark 注册并获取 API Key
- 用途：AI 分析视频的拍摄手法
- 配置示例：
  ```bash
  export ARK_API_KEY="your-api-key"
  ```

### 系统依赖

需要安装以下工具：

- `ffmpeg`：音视频处理（用于提取音频和封面）
- `ffprobe`：媒体信息获取

安装方式：
```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg

# macOS
brew install ffmpeg

# Windows
# 从 https://ffmpeg.org/download.html 下载
```

## 使用方法

### 基本用法

```bash
python scripts/douyin_script_analyzer.py "https://v.douyin.com/xxx" -o ./output
```

### 调整采样帧率

```bash
# 高帧率（适合快速动作视频，更多细节）
python scripts/douyin_script_analyzer.py "https://v.douyin.com/xxx" --fps 2

# 低帧率（适合慢节奏视频，节省处理时间）
python scripts/douyin_script_analyzer.py "https://v.douyin.com/xxx" --fps 0.5
```

### 更换分析模型

```bash
python scripts/douyin_script_analyzer.py "https://v.douyin.com/xxx" \
  --model doubao-seed-2-0-lite-250728
```

### 不生成报告文件

```bash
python scripts/douyin_script_analyzer.py "https://v.douyin.com/xxx" --no-report
```

## 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `share_link` | 必填 | 抖音分享链接 |
| `-o/--output` | ./output | 输出目录 |
| `--fps` | 1 | 视频采样帧率（0.3-3，值越大分析越精细） |
| `--model` | doubao-seed-2-0-pro-260215 | 火山方舟模型 ID |
| `--no-progress` | False | 不显示详细进度信息 |

## 输出内容

运行后会在输出目录生成以下文件：

```
output/
└── <video_id>/
    ├── <video_id>.mp4          # 无水印视频文件
    ├── <video_id>.jpg          # 视频封面
    ├── 拍摄脚本分析.md          # 完整的脚本分析报告
    └── shots/                  # 镜头裁剪片段
        ├── 01_中景_女主背对镜头走在走廊上.mp4
        ├── 02_中景_转身展示内衣颜色.mp4
        ├── 03_近景_凑近镜头疑惑表情.mp4
        └── ...
```

### 报告文档结构

```markdown
# 视频拍摄脚本分析

## 视频基本信息
- 标题、时长、文件大小、视频链接

## 视频封面
- 封面图片

## 视频文案（语音识别）
> 完整提取的视频口播文案

## 拍摄手法分析
- 景别分析（远景/全景/中景/近景/特写）
- 运镜方式（推/拉/摇/移/跟/甩等）
- 剪辑节奏
- 色调风格
- 镜头时长分布
- 场景转换
- 拍摄手法亮点
- 脚本结构拆解（按镜头分段的详细分析）

## 数据说明
- 各数据字段的含义和用途
- 数据来源说明

## 完整数据
- 原始 JSON 数据
```

## 拍摄手法分析说明

AI 会从以下维度分析视频的拍摄手法：

| 分析维度 | 说明 |
|---------|------|
| 景别 | 远景、全景、中景、近景、特写、大特写的使用 |
| 运镜 | 推镜头、拉镜头、摇镜头、移镜头、跟镜头、甩镜头、升降镜头 |
| 剪辑节奏 | 镜头切换频率、节奏把控 |
| 色调风格 | 整体色调倾向和风格 |
| 镜头时长 | 各景别的平均时长统计 |
| 场景转换 | 转场方式和效果 |
| 脚本结构 | 按镜头/段落拆解的内容大纲 |

## 注意事项

1. **两个 API Key 都要配置**：缺少任一个环境变量都会导致运行失败
2. **视频大小限制**：火山方舟 Files API 最大支持 512MB 的视频，超出限制的视频无法分析
3. **运行时间**：整个流程包括下载、语音识别、视频上传、预处理、AI 分析，预计需要 2-5 分钟
4. **网络要求**：需要同时能访问抖音、硅基流动、火山方舟三个服务
5. **输出语言**：拍摄脚本分析报告以**中文**输出
6. **视频链接访问**：视频链接有防盗链保护，**不要直接点击**，请复制到浏览器地址栏访问

## 使用示例

### 示例1：完整分析

```bash
export DOUYIN_API_KEY="your-siliconflow-key"
export ARK_API_KEY="your-volcengine-key"

python scripts/douyin_script_analyzer.py "https://v.douyin.com/xxx" -o ./output
```

### 示例2：分析快速动作视频

```bash
python scripts/douyin_script_analyzer.py "https://v.douyin.com/xxx" --fps 2
```

### 示例3：静默运行（无进度显示）

```bash
python scripts/douyin_script_analyzer.py "https://v.douyin.com/xxx" --no-progress
```

## Python API 使用

```python
from scripts.douyin_script_analyzer import analyze_filming_script, generate_script_report

# 执行分析（默认会自动裁剪镜头）
result = analyze_filming_script(
    share_link="https://v.douyin.com/xxx",
    output_dir="./output",
    fps=1
)

# 生成报告
report = generate_script_report(result, "./output/report.md")

# 提取结果
video_title = result["video_info"]["title"]
text_content = result["text_content"]
filming_analysis = result["filming_analysis"]
shot_files = result["shot_files"]  # 裁剪后的镜头片段文件路径列表
```

## 资源索引

- **核心脚本**：[scripts/douyin_script_analyzer.py](scripts/douyin_script_analyzer.py)
  - 用途：执行完整的拍摄脚本分析流程
  - 包含：抖音提取 + 语音识别 + 视频理解 + 报告生成

- **技术参考**：
  - [references/douyin_extraction.md](references/douyin_extraction.md) - 抖音提取技术细节
  - [references/video_understanding.md](references/video_understanding.md) - 视频理解技术细节
