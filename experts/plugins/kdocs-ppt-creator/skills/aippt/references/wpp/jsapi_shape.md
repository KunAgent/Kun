# 插入形状

所有形状插入命令共享相同的基础参数（`slideIndex`、`left`、`top`、`width`、`height`），区别在于形状类型不同。

## 通用参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `slideIndex` | integer | 是 | 目标幻灯片序号，从 1 开始 |
| `left` | number | 是 | 形状左上角 X 坐标（单位：磅） |
| `top` | number | 是 | 形状左上角 Y 坐标（单位：磅） |
| `width` | number | 是 | 形状宽度（单位：磅） |
| `height` | number | 是 | 形状高度（单位：磅） |

---

## 插入矩形

- **命令名**：`addRectangle`
- **用途**：在指定幻灯片的指定位置插入一个矩形

### 调用示例

```json
{
  "file_id": "file_xxx",
  "command": "addRectangle",
  "param": {
    "slideIndex": 1,
    "left": 100,
    "top": 100,
    "width": 200,
    "height": 200
  }
}
```

---

## 插入圆形

- **命令名**：`addOval`
- **用途**：在指定幻灯片的指定位置插入一个椭圆

### 调用示例

```json
{
  "file_id": "file_xxx",
  "command": "addOval",
  "param": {
    "slideIndex": 1,
    "left": 200,
    "top": 200,
    "width": 150,
    "height": 150
  }
}
```

---

## 插入三角形

- **命令名**：`addTriangle`
- **用途**：在指定幻灯片的指定位置插入一个等腰三角形

### 调用示例

```json
{
  "file_id": "file_xxx",
  "command": "addTriangle",
  "param": {
    "slideIndex": 1,
    "left": 50,
    "top": 50,
    "width": 200,
    "height": 180
  }
}
```

---

## 插入圆角矩形

- **命令名**：`addRoundedRectangle`
- **用途**：在指定幻灯片的指定位置插入一个圆角矩形

### 调用示例

```json
{
  "file_id": "file_xxx",
  "command": "addRoundedRectangle",
  "param": {
    "slideIndex": 1,
    "left": 100,
    "top": 300,
    "width": 250,
    "height": 100
  }
}
```

---

## 通用形状类型枚举

`AddShape` 通用签名：`Shapes.AddShape(shapeType, left, top, width, height)`

更换 `shapeType` 即可插入不同类型的形状：

| 常量名 | 说明 |
|--------|------|
| `msoShapeRectangle` | 矩形 |
| `msoShapeOval` | 椭圆/圆形 |
| `msoShapeIsoscelesTriangle` | 等腰三角形 |
| `msoShapeRoundedRectangle` | 圆角矩形 |
| `msoShapeDiamond` | 菱形 |
| `msoShapeParallelogram` | 平行四边形 |
| `msoShapeTrapezoid` | 梯形 |
| `msoShapeHexagon` | 六边形 |
| `msoShapeOctagon` | 八边形 |
| `msoShapeCross` | 十字形 |
| `msoShapeStar5` | 五角星 |
| `msoShapeRightArrow` | 右箭头 |
| `msoShapeLeftArrow` | 左箭头 |
| `msoShapeUpArrow` | 上箭头 |
| `msoShapeDownArrow` | 下箭头 |
