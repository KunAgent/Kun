---
name: novel-writer
description: 章节正文生成器 - 根据章节大纲、Voice Profile 和角色档案构建 LLM 提示词，用于生成章节正文。当需要根据大纲创作具体章节时使用。
---

# Novel Writer - 章节正文生成器

## Overview

读取章节大纲（Markdown）、风格配置（style.yml）和角色档案（characters/*.yml），构建结构化的 LLM 提示词，用于生成符合风格要求的章节正文。

**使用场景**：
- 需要根据章节大纲生成正文提示词
- 需要保持风格一致性（Voice Profile）
- 需要整合角色档案信息
- 需要调节生成温度控制随机性

## 核心功能

| 功能 | 说明 |
|------|------|
| **大纲解析** | 读取 Markdown 格式章节大纲 |
| **Voice Profile 注入** | 从 style.yml 加载风格标签、语速、语气、反 AI 规则 |
| **角色档案整合** | 自动加载角色名称、身份、特征信息 |
| **提示词构建** | 生成系统提示 + 用户提示的结构化提示词 |
| **温度控制** | 支持调节 LLM 生成随机性（0.0-1.0） |
| **字数目标** | 设定目标字数指导生成 |

## CLI 使用

```bash
# 基本用法
python3 scripts/write_chapter.py --book-dir projects/my-novel --chapter 1 --outline chapters/outlines/chapter-1.md

# 指定字数和温度
python3 scripts/write_chapter.py \
  --book-dir projects/my-novel \
  --chapter 5 \
  --outline chapters/outlines/chapter-5.md \
  --word-count 4000 \
  --temperature 0.8

# 输出到文件
python3 scripts/write_chapter.py \
  --book-dir projects/my-novel \
  --chapter 10 \
  --outline chapters/outlines/chapter-10.md \
  --output chapters/prompts/chapter-10-prompt.md

# 简写
python3 scripts/write_chapter.py -d ./project -c 1 -l outline.md -w 3000 -t 0.7 -o prompt.md
```

## 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--book-dir` | ✅ | 小说项目根目录路径 |
| `--chapter` | ✅ | 章节编号 |
| `--outline` | ✅ | 章节大纲文件路径（相对于 book-dir） |
| `--word-count` | ❌ | 目标字数（默认 2000） |
| `--temperature` | ❌ | LLM 温度 0.0-1.0（默认 0.7） |
| `--output` | ❌ | 输出文件路径（默认 output/prompts.md） |

## 项目目录结构

```
projects/my-novel/
├── outline.md          # 故事大纲
├── style.yml           # 风格配置（Voice Profile）
├── characters/         # 角色档案
│   ├── 主角.yml
│   └── 配角.yml
├── chapters/
│   ├── outlines/       # 章节大纲（chapter-outliner 生成）
│   │   └── chapter-01.md
│   └── prompts/        # 提示词输出（novel-writer 生成）
│       └── chapter-01-prompt.md
└── output/
    └── prompts.md      # 默认输出位置
```

## 输出提示词格式

```markdown
# 第 1 章 提示词

**生成时间**: 2026-04-04 23:30:00
**目标字数**: 3000 字
**温度**: 0.7

## 系统提示

你是一名专业的小说作家，擅长根据大纲生成精彩的章节内容。
请严格遵循以下要求：
- 遵循章节大纲的节拍结构
- 保持风格一致性
- 对话自然流畅
- 描写生动具体

## 用户提示

### 章节信息
- 章节：第 1 章
- 目标字数：3000 字
- 建议温度：0.7

### 章节大纲
[来自 outline 文件的内容]

### 风格要求
- 风格标签：温柔，叙事性，略带忧伤
- 语速：缓慢
- 语气：亲切的讲述者语气
- 情感倾向：0.3

### 反 AI 规则
- 避免过度使用形容词
- 减少"的"字频率
- 不使用"仿佛"、"好像"等比喻词

### 角色参考
#### 林风
- 身份：私家侦探
- 特征：冷静，敏锐，略带沧桑

#### 苏雨
- 身份：咖啡馆老板娘
- 特征：温柔，神秘

### 写作要求
1. 严格遵循章节大纲的节拍结构
2. 保持风格一致性
3. 对话自然流畅，符合角色性格
4. 描写生动具体，避免空洞抽象
5. 节奏张弛有度，避免平铺直叙
```

## 风格配置 (style.yml)

```yaml
voice_profile:
  labels:
  - 温柔
  - 叙事性
  - 略带忧伤
  pace: 缓慢
  tone: 亲切的讲述者语气
  sentiment: 0.3
  anti_ai_rules:
  - 避免过度使用形容词
  - 减少"的"字频率
  - 不使用"仿佛"、"好像"等比喻词
```

## 角色档案格式 (characters/*.yml)

```yaml
name: 林风
role: 私家侦探
age: 35
traits:
- 冷静
- 敏锐
- 略带沧桑
background: |
  前刑警，因一次任务失误辞职，
  现为私家侦探。
goals:
- 查明真相
- 保护弱者
```

## 温度建议

| 温度范围 | 效果 | 适用场景 |
|----------|------|----------|
| 0.0-0.3 | 高度确定 | 技术文档、事实性内容 |
| 0.4-0.6 | 平衡 | 一般叙事、对话 |
| 0.7-0.9 | 创造性 | 小说创作、创意写作 |
| 1.0 | 高度随机 | 实验性写作 |

## 依赖

- Python 3.8+
- rich (终端渲染)
- PyYAML (配置文件解析)

安装依赖：
```bash
pip install -r scripts/requirements.txt
```

## 与其他技能集成

### 与 chapter-outliner 集成

```bash
# 1. 生成章节大纲
python3 ../chapter-outliner/scripts/generate_outline.py \
  --book-dir projects/my-novel \
  --chapter 1 \
  --output chapters/outlines/chapter-1.md

# 2. 根据大纲生成提示词
python3 scripts/write_chapter.py \
  --book-dir projects/my-novel \
  --chapter 1 \
  --outline chapters/outlines/chapter-1.md \
  --output chapters/prompts/chapter-1-prompt.md
```

### 与 style-analyzer 集成

```bash
# 1. 分析参考文本风格
python3 ../style-analyzer/scripts/analyze_style.py \
  --input reference.txt \
  --output style.yml

# 2. 生成章节提示词（自动使用 style.yml）
python3 scripts/write_chapter.py \
  --book-dir projects/my-novel \
  --chapter 1 \
  --outline outlines/chapter-1.md
```

### 与 smart-prompt-builder 集成

```bash
# 使用 smart-prompt-builder 生成场景提示词
python3 ../smart-prompt-builder/scripts/build_prompt.py \
  --scene-type description \
  --style-file style.yml \
  --context '{"scene": "雨夜"}'

# 将结果整合到 novel-writer 的提示词中
```

## 注意事项

- 此脚本生成**LLM 提示词**，实际内容需调用 LLM API 生成
- 章节大纲文件为必填参数
- style.yml 和 characters/ 为可选（缺失时使用默认设置）
- 温度值越高，生成内容越随机（推荐 0.7-0.9 用于小说）
- 支持 UTF-8 和 GBK 编码的配置文件（自动检测）
- 无网络调用，无需凭证，本地运行
