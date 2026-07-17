# WPS演示文稿基础能力

提供对演示文稿操作的原子能力，通过执行JSAPI来操作幻灯片。

## 通用说明

### 请求方式

所有命令统一通过 `wpp.execute` 工具调用，传入 `file_id`、`command`、`param` 三个参数：

```json
{
  "file_id": "演示文稿 file_id",
  "command": "命令名",
  "param": { ... }
}
```

### 统一返回格式

所有命令返回统一的 JSON 结构：

```javascript
{
    ok: boolean,
    message: string,
    data: any
}
```

---

## 功能清单

下表列出了当前支持的所有功能。点击详情文档链接查看完整的脚本模板和参数说明。

### 幻灯片操作

| 功能分类 | 命令名 | 功能描述 | 详情文档 | 状态 |
|---------|--------|---------|---------|------|
| 添加版式幻灯片 | `addLayoutSlide` | 在指定位置插入指定版式的幻灯片 | [jsapi_slide.md](jsapi_slide.md) | ✅ |
| 删除幻灯片 | `deleteSlide` | 删除指定位置的幻灯片 | [jsapi_slide.md](jsapi_slide.md) | ✅ |
| 复制粘贴幻灯片 | `copyPasteSlide` | 复制指定幻灯片并粘贴到指定位置 | [jsapi_slide.md](jsapi_slide.md) | ✅ |
| 获取幻灯片数量 | `getSlidesCount` | 获取演示文稿中幻灯片的总数 | [jsapi_slide.md](jsapi_slide.md) | ✅ |

### 插入形状

| 功能分类 | 命令名 | 功能描述 | 详情文档 | 状态 |
|---------|--------|---------|---------|------|
| 插入矩形 | `addRectangle` | 在指定幻灯片插入矩形 | [jsapi_shape.md](jsapi_shape.md) | ✅ |
| 插入圆形 | `addOval` | 在指定幻灯片插入椭圆 | [jsapi_shape.md](jsapi_shape.md) | ✅ |
| 插入三角形 | `addTriangle` | 在指定幻灯片插入等腰三角形 | [jsapi_shape.md](jsapi_shape.md) | ✅ |
| 插入圆角矩形 | `addRoundedRectangle` | 在指定幻灯片插入圆角矩形 | [jsapi_shape.md](jsapi_shape.md) | ✅ |

---

## 使用工作流

当用户请求操作演示文稿时，按以下步骤处理：

### 步骤1: 分析用户需求

**识别操作类型**：判断用户需要执行的操作

- **幻灯片操作**：添加、删除、复制、获取数量
- **形状操作**：插入矩形、圆形、三角形、圆角矩形

### 步骤2: 检查功能支持

**重要**：在功能清单中验证所需功能是否已定义。

**检查方法**：
1. 将用户需求拆解为具体的操作
2. 在[功能清单](#功能清单)表格中逐一查找每个操作
3. 如果操作在清单中 → 继续步骤3
4. 如果操作不在清单中 → **立即返回不支持**

**不支持时的返回示例**：
```
抱歉，当前不支持该功能。
```

### 步骤3: 查找对应命令

在功能清单表格中找到对应的命令名（command）。

### 步骤4: 读取详情文档

根据功能清单中的"详情文档"链接，读取对应的 md 文件获取：
- 完整的参数说明
- 使用示例

### 步骤5: 构建调用参数

根据详情文档中的参数说明，构建 `param` 对象：

```json
{
  "file_id": "file_xxx",
  "command": "对应命令名",
  "param": {
    // 按详情文档中的参数说明填充
  }
}
```

### 步骤6: 返回结果

提供完整的调用参数给用户。

---

## 快速参考

### 重要说明
- **功能检查**: 使用前必须先在功能清单中确认功能是否支持
- **幻灯片索引**: 从 1 开始计数（`slideIndex` 为 1 表示第 1 张幻灯片）
- **坐标单位**: 形状的 `left`、`top`、`width`、`height` 单位为磅（Point）
- **返回格式**: `{ok: boolean, message: string, data: any}`

### 命令速查表

| 命令名 | 用途 | 关键参数 |
|--------|------|---------|
| `addLayoutSlide` | 添加版式幻灯片 | `slideIndex`, `layout` |
| `deleteSlide` | 删除幻灯片 | `slideIndex` |
| `copyPasteSlide` | 复制粘贴幻灯片 | `slideIndex`, `pasteIndex` |
| `getSlidesCount` | 获取幻灯片数量 | 无参数 |
| `addRectangle` | 插入矩形 | `slideIndex`, `left`, `top`, `width`, `height` |
| `addOval` | 插入圆形 | `slideIndex`, `left`, `top`, `width`, `height` |
| `addTriangle` | 插入三角形 | `slideIndex`, `left`, `top`, `width`, `height` |
| `addRoundedRectangle` | 插入圆角矩形 | `slideIndex`, `left`, `top`, `width`, `height` |
