---
name: element-lawsuit-generato
description: "要素式文书一键生成——个人提效利器：以前律师对着模板逐项手动填写要素式文书，一份半小时起步；现在上传传统起诉状，自动识别案由、匹配模板、提取要素、填充输出，9类文书58个案由一键搞定。单人执业无需助理团队，文书格式转换从手工活变成秒级自动化。支持11大领域104份模板，区域定位精确填充，勾选框智能处理。"
author: SkillHub Community
agent_created: false
version: "2.0"
---

# 要素式文书一键生成器 v2.0

## 概述

上传普通诉讼文书（txt/md/docx/pdf/图片），自动识别案由、匹配模板、提取要素、生成规范的要素式文书 `.docx`。

**v2.0 变更**：吸收数据驱动 DOCX 生成引擎（像素级精准复刻法〔2025〕82号官方模板），替换原有的远程模板下载+XML填充方案。

## 核心能力

- **58 个案由自动识别**：11 大领域，关键词规则匹配，离线可用
- **5 种输入格式**：txt / md / docx / pdf / 图片（OCR）
- **双格式输入支持**：自动检测要素式/传统叙述式文书
- **双轨提取**：规则提取（快速·离线）+ AI 提取（精准·理解语义）
- **像素级 DOCX 生成**：基于 `table_layouts.json` 数据驱动，页边距/列宽/边框/字体精确到 Emu

## 覆盖领域

| 领域 | 案由数 | 文书类型 |
|------|--------|----------|
| 民事起诉状 | 33 | 法〔2025〕82号 全案由 |
| 刑事自诉 | 4 | 侮辱/诽谤/重婚/拒执 |
| 行政纠纷 | 12 | 处罚/许可/强制/协议/信息公开等 |
| 国家赔偿 | 4 | 刑事改判无罪/违法拘留/怠于履职/错误执行 |
| 知识产权 | 7 | 商标/专利/著作权/商业秘密/不正当竞争/垄断 |
| 保险纠纷 | 4 | 人身/财产/责任/保证 |
| 海商海事 | 3 | 船舶碰撞/人身损害/货运代理 |
| 公益诉讼 | 3 | 环境污染/生态破坏/生态环境 |
| 婚姻家事 | 1 | 离婚 |
| 劳动争议 | 2 | 一般劳动/船员劳务 |
| 交通事故 | 1 | 机动车交通事故 |

## 触发条件

- 用户上传起诉状/答辩状/申请书等诉讼文书，要求转换为要素式格式
- 用户说"转换成要素式"、"要素式文书"、"填要素式起诉状"
- 用户需要生成规范格式的要素式 DOCX

## 使用方式

### CLI 方式

```bash
python scripts/main.py 起诉状.docx
```

指定案由：

```bash
python scripts/main.py 起诉状.txt --case-type 民间借贷纠纷 --doc-type 民事起诉状
```

列出所有支持案由：

```bash
python scripts/main.py --list-case-types
```

### 对话方式（WorkBuddy 内）

将起诉状 DOCX/PDF 发给 WorkBuddy，说"转换为要素式起诉状"。

**工作流**：
1. 如果是标准格式 → `main.py` 自动流水线完成
2. 如果是复杂/非标格式 → AI 阅读起诉状提取要素 → 构建 要素式_data JSON → 调用 `generate_docx.py` 生成

对话式转换输出的 JSON 格式参见 `references/templates.json`（要素式 字段定义）。

## 架构

```
用户上传文件（txt/md/docx/pdf/图片）
        │
        ▼
   [file_parser.py]      ← 多格式解析器（原 element）
        │
        ▼
   [case_classifier.py]  ← 58案由关键词规则匹配（原 element）
        │
        ├─ 简单案件（要素式/结构化好的文书）
        │      │
        │      ▼
        │  [content_extractor.py]  规则提取 → 结构化数据
        │
        ├─ 复杂案件（传统叙述式/信息散乱）
        │      │
        │      ▼
        │  AI 分析（WorkBuddy 对话）→ 提取要素 → 构建 要素式_data JSON
        │
        ▼
   [generate_docx.py v8] ← 数据驱动 DOCX 引擎（原 要素式）
        │
        ▼
   要素式 .docx
```

## 核心文件说明

| 文件 | 来源 | 说明 |
|------|------|------|
| `scripts/file_parser.py` | element | 多格式解析（txt/md/docx/pdf/图片OCR） |
| `scripts/case_classifier.py` | element | 58案由关键词规则分类 |
| `scripts/content_extractor.py` | element | 要素式/传统式双格式提取 |
| `scripts/main.py` | 合并 | 统一入口，编排流程+格式转换 |
| `scripts/generate_docx.py` | 要素式 | 数据驱动DOCX生成（像素级精准） |
| `configs/case_keywords.json` | element | 58案由关键词映射 |
| `configs/field_mapping.json` | element | 通用字段提取规则 |
| `configs/template_index.json` | element | 模板索引 |
| `references/table_layouts.json` | 要素式 | 33民事案由表布局定义(104KB) |
| `references/templates.json` | 要素式 | 67案由字段定义(174KB) |
| `references/fields-structure.md` | 要素式 | 字段结构说明 |

## 要素式 DOCX 生成引擎说明

`generate_docx.py` 基于法〔2025〕82号官方模板的逐项对比分析，精确复刻格式。

### 格式铁律

- **6张独立表格**，表间零间隔（`</tbl>`→`<tbl>`直接相连）
- 每表 2 列：标签列（~2270 twips）+ 数据列（~7074 twips），总宽 9344 twips
- 页边距精确到 Emu：上 908685 / 下 633730 / 左 899795 / 右 719455
- 正文宋体 10.5pt、节标题宋体 15pt（不加粗）、大标题宋体 22pt 加粗
- 边框 single #231F20 sz=2，6面完整

### 要素式 数据格式（AI提取后构建）

```json
{
  "caseTypeName": "民间借贷纠纷",
  "plaintiffs": [
    {
      "type": "natural",
      "name": "张三",
      "gender": "男",
      "birth": "1985年3月12日",
      "nation": "汉族",
      "work": "某某公司",
      "job": "职员",
      "phone": "138xxxxxxxx",
      "addr": "某某省某某市某某区",
      "idNum": "4205xxxxxxxxxxxxxx"
    }
  ],
  "defendants": [
    {
      "type": "natural",
      "name": "李四",
      ...
    }
  ],
  "thirds": [],
  "agent": {
    "has": false,
    "name": "",
    "firm": "",
    "job": "",
    "phone": "",
    "auth": "general"
  },
  "claims": {
    "claim_01": "1. 判令被告偿还借款本金100000元",
    "claim_02": "2. 判令被告支付逾期利息..."
  },
  "facts": {
    "facts_00": "2023年1月1日，被告向原告借款...",
    "facts_01": "借款到期后，被告未归还..."
  },
  "jurisdiction": {
    "basis": "",
    "mediation": "no",
    "preservation": "no"
  }
}
```

### 不同案由的表结构

核心结构（4~6表，覆盖80%+案由）：
- T0: 说明 + 当事人信息 + 原告(自然人) + 原告(法人)
- T1: 代理人 + 被告 + 第三人
- T2: 诉讼请求 + 管辖/保全
- T3: 事实与理由 part 1
- T4-T5: 事实续 + 调解意愿

复杂案由（7~13表，IP/海事/垄断等）：额外增加涉外/港澳台、关联案件/程序、鉴定申请等专有表。

## 系统要求

- Python 3.9+
- 依赖见 `requirements.txt`（python-docx）
- PDF 解析需 PyMuPDF 或 pdfplumber
- 图片 OCR 需 pytesseract + Tesseract-OCR 或 easyocr

## License

MIT
