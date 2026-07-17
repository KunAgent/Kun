# DraggableSheetContext API 参考

> 基础库 3.2.0+

## 概述

DraggableSheet 实例，可通过 `wx.createSelectorQuery` 的 `NodesRef.node` 方法获取。用于程序化控制 `draggable-sheet` 组件的滚动位置。

> 📌 组件属性详情请参阅：[skyline-components](../../skyline-components/SKILL.md) - draggable-sheet 组件

## 获取方式

```js
// WXML: <draggable-sheet class="sheet">...</draggable-sheet>
wx.createSelectorQuery()
  .select('.sheet')
  .node()
  .exec(res => {
    const sheetContext = res[0].node
    // sheetContext 即 DraggableSheetContext 实例
  })
```

## 方法

### DraggableSheetContext.scrollTo(Object object)

> 小程序插件：支持

滚动到指定位置。

**重要**：`size` 取值 `[0, 1]`，`size = 1` 时表示撑满 `draggable-sheet` 组件。**`size` 和 `pixels` 同时传入时，仅 size 生效**。

### 参数

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| size | number | - | 否 | 相对目标位置，取值 [0, 1]，1 表示撑满组件 |
| pixels | number | - | 否 | 绝对目标位置（px） |
| animated | boolean | true | 否 | 是否启用滚动动画 |
| duration | number | 300 | 否 | 滚动动画时长（ms） |
| easingFunction | string | ease | 否 | 缓动函数 |

### size vs pixels

| 定位方式 | 说明 | 适用场景 |
|----------|------|----------|
| `size` | 相对位置（0~1），与组件高度无关 | 响应式布局，如展开到 70% |
| `pixels` | 绝对位置（px） | 精确像素控制 |

> ⚠️ 两者同时传入时，`size` 优先，`pixels` 被忽略。

### 示例代码

```js
Page({
  onReady() {
    this.createSelectorQuery()
      .select('.sheet')
      .node()
      .exec(res => {
        const sheetContext = res[0].node

        // 方式一：相对位置（推荐）
        sheetContext.scrollTo({
          size: 0.7,
          animated: true,
          duration: 300,
          easingFunction: 'ease'
        })

        // 方式二：绝对位置
        sheetContext.scrollTo({
          pixels: 200,
          animated: true
        })
      })
  }
})
```

## 常见用法

### 配合按钮展开/收起

```js
Page({
  data: { expanded: false },

  onReady() {
    this.createSelectorQuery().select('.sheet').node()
      .exec(res => { this.sheetCtx = res[0].node })
  },

  toggleSheet() {
    const size = this.data.expanded ? 0.3 : 0.8
    this.sheetCtx.scrollTo({ size, animated: true, duration: 300 })
    this.setData({ expanded: !this.data.expanded })
  }
})
```
