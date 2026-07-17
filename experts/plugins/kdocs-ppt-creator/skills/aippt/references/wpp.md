# 演示文稿（pptx / wpp）工具完整参考文档

本文件包含金山文档 Skill 中**演示文稿**相关工具的完整 API 说明、详细调用示例、参数说明和返回值说明。

**适用范围**：本文档中的 `wpp.*` 工具面向**在线演示（WPP）**内核能力，包括空白页插入、主题字体/配色设置、导出图片或 PDF 等。

---

## 通用说明

### 演示文稿工具概述

**在线演示（WPP）** 提供幻灯片操作（添加/删除/复制）、形状插入、主题字体/配色设置、导出图片或 PDF 等能力，通过本文 **`wpp.*`** 工具描述；

### 使用场景

| 场景 | 说明 |
|------|------|
| 工作汇报 | 季度/年度演示材料 |
| 培训课件 | 结构化幻灯片内容 |
| 对外宣讲 | 导出 PDF / 图片 |

### 原子操作能力（wpp.execute）

`wpp.execute` 提供演示文稿的 JSAPI 原子操作能力，通过 `command` 参数区分不同操作：

| 操作类别 | 可用命令 |
|---------|---------|
| 幻灯片操作 | `addLayoutSlide`、`deleteSlide`、`copyPasteSlide`、`getSlidesCount` |
| 插入形状 | `addRectangle`、`addOval`、`addTriangle`、`addRoundedRectangle` |

**使用要求**：
- 只能使用已定义的命令，禁止自创脚本
- 执行前需在功能清单中确认命令是否支持
- 详细模板和参数见 `references/wpp/execute.md`

---

## 一、演示文稿与页面

> 页面级插入与整篇结构操作

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`wpp.insert_slide`](wpp/slide.md) | 在已有演示中插入空白页 | `file_id`, `slide_idx` |
| [`wpp.import_slides`](wpp/slide.md) | 将外部 PPTX 的指定页面导入到已有演示文稿 | `link_id`, `object_url`, `slide_idx`, `source_idxs` |

## 二、主题（字体与配色）

> 演示文稿或单页的字体与配色方案设置

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`wpp.set_font_presentation`](wpp/theme.md) | 全文更换字体 | `file_id` |
| [`wpp.set_font_slide`](wpp/theme.md) | 单页更换字体 | `file_id`, `slide_idx` |
| [`wpp.set_color_presentation`](wpp/theme.md) | 全文更换配色 | `file_id` |
| [`wpp.set_color_slide`](wpp/theme.md) | 单页更换配色 | `file_id`, `slide_idx`, `theme_color_mode`, `color_scheme_id` |

### 字体与配色约束

| 项 | 规则 |
|----|------|
| 字体主题 | 支持 **16** 种方案名：`现代雅黑体`、`简约等线体`、`经典宋体`、`清秀姚体`、`经典黑体`、`现代黑体`、`简约灵秀黑体`、`科技云技术体`、`经典楷体`、`典雅气质体`、`简约中等线体`、`古朴小隶体`、`传统书宋二体`、`圆润体`、`可爱傲娇体`、`飘逸青云体`。`font_theme` 未传或非法 → **经典黑体** |
| 配色主题 | 支持 **16** 种方案名，每种配色对应 `theme_color_mode` 值如下表 |

#### 配色主题详表

| `color_theme` | `theme_color_mode` | 说明 |
|---------------|-------------------|------|
| 默认配色 | 0 | 恢复默认配色 |
| 落日红 | 1 | 浅色暖色系 |
| 蜜橘橙 | 1 | 浅色暖色系 |
| 琥珀黄 | 1 | 浅色暖色系 |
| 嫩芽绿 | 1 | 浅色冷色系 |
| 湖水青 | 1 | 浅色冷色系 |
| 晴空蓝 | 1 | 浅色冷色系 |
| 丁香紫 | 1 | 浅色冷色系 |
| 朱砂赤 | 3 | 深色暖色系 |
| 南瓜橙 | 3 | 深色暖色系 |
| 深麦黄 | 3 | 深色暖色系 |
| 深松绿 | 3 | 深色冷色系 |
| 深墨青 | 3 | 深色冷色系 |
| 深海蓝 | 3 | 深色冷色系 |
| 葡萄紫 | 3 | 深色冷色系 |
| 胭脂红 | 3 | 深色暖色系 |

`color_theme` 未传或非法 → **默认配色**（`theme_color_mode: 0`）


## 三、下载与导出

> 导出 PDF / 图片

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`wpp.export_image`](wpp/export.md) | 导出为图片 | `link_id`, `format` |
| [`wpp.export_pdf`](wpp/export.md) | 异步导出 PDF | `file_id`, `format` |

## 四、原子操作

> 通过 JSAPI 对演示文稿进行读写与编辑

| 工具 | 功能 | 必填参数 |
|------|------|----------|
| [`wpp.execute`](wpp/execute.md) | 透传执行演示文稿 JSAPI | `file_id`, `command` |

## 附录

### 错误响应

| 情况 | 说明或示例 |
|------|------------|
| 未登录 / 无权限 | 返回业务错误码或 `result` 非 `ok`，`msg` 含可读原因 |
| 内核执行失败 | 类似 `detail.res[].code` 非 `0`，或 `result` 为 `ExecuteFailed` 等（以实际为准） |
| HTTP 非 200 | 请求失败，检查鉴权（Cookie、Origin 等） |

### 与通用 MCP 包装

若网关将下列工具统一包装为外层 `code` / `msg` / `data`，**业务载荷**仍以本文「返回值说明」中的 JSON 为准，嵌套在 `data` 内；详见 `drive.md` 中与各 `wpp.*` 工具的对接说明。
