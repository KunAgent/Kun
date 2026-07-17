# 幻灯片操作

## 添加指定版式幻灯片

- **命令名**：`addLayoutSlide`
- **用途**：在指定位置插入指定版式（文本/仅标题等）的幻灯片

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `slideIndex` | integer | 是 | 插入位置，从 1 开始（在第 N 张之后插入） |
| `layout` | integer | 是 | 版式类型，枚举值见下表 |

#### layout 版式枚举

| 值 | 常量名 | 说明 |
|----|--------|------|
| 1 | `ppLayoutTitle` | 标题幻灯片 |
| 2 | `ppLayoutText` | 标题和文本 |
| 3 | `ppLayoutTwoColumnText` | 标题和两栏文本 |
| 4 | `ppLayoutTable` | 标题和表格 |
| 5 | `ppLayoutTextAndChart` | 标题、文本和图表 |
| 6 | `ppLayoutChartAndText` | 标题、图表和文本 |
| 7 | `ppLayoutOrgchart` | 标题和组织结构图 |
| 8 | `ppLayoutChart` | 标题和图表 |
| 9 | `ppLayoutTextAndClipart` | 标题、文本和剪贴画 |
| 10 | `ppLayoutClipartAndText` | 标题、剪贴画和文本 |
| 11 | `ppLayoutTitleOnly` | 仅标题 |
| 12 | `ppLayoutBlank` | 空白 |

### 调用示例

```json
{
  "file_id": "file_xxx",
  "command": "addLayoutSlide",
  "param": {
    "slideIndex": 2,
    "layout": 2
  }
}
```

---

## 删除幻灯片

- **命令名**：`deleteSlide`
- **用途**：删除指定位置的幻灯片

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `slideIndex` | integer | 是 | 要删除的幻灯片序号，从 1 开始 |

### 调用示例

```json
{
  "file_id": "file_xxx",
  "command": "deleteSlide",
  "param": {
    "slideIndex": 2
  }
}
```

---

## 复制粘贴幻灯片

- **命令名**：`copyPasteSlide`
- **用途**：复制指定幻灯片并粘贴到指定位置（未指定则粘贴到末尾）

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `slideIndex` | integer | 是 | 要复制的幻灯片序号，从 1 开始 |
| `pasteIndex` | integer | 否 | 粘贴目标位置，从 1 开始。不传则粘贴到末尾 |

### 调用示例

```json
{
  "file_id": "file_xxx",
  "command": "copyPasteSlide",
  "param": {
    "slideIndex": 1,
    "pasteIndex": 3
  }
}
```

---

## 获取幻灯片数量

- **命令名**：`getSlidesCount`
- **用途**：获取演示文稿中幻灯片的总数

### 参数

无需参数。

### 返回值

`data` 为数字类型，表示幻灯片总数。

### 调用示例

```json
{
  "file_id": "file_xxx",
  "command": "getSlidesCount",
  "param": {}
}
```

返回示例：

```json
{"ok": true, "message": "success", "data": 5}
```
