# 容器转场动画（open-container）

## 概述

通过将一个元素无缝地转换为另一个元素，可以加强两个元素间的关系（如瀑布流卡片点击跳转详情页）。基础库提供了 `<open-container>` 组件来实现该路由效果。

**版本要求**：
- 开发者工具：Nightly 1.06.2403222
- 基础库：3.4.0
- `withOpenContainer` 参数：基础库 3.12.2

## 基本用法

将需要过渡的元素放置在 `<open-container>` 组件内，点击组件后使用 `navigateTo` 跳转下一页面时，对其子节点和下一个页面进行过渡。

### WXML

```html
<open-container
  closed-elevation="{{closedElevation}}"
  closed-border-radius="{{closedBorderRadius}}"
  open-elevation="{{openElevation}}"
  open-border-radius="{{openBorderRadius}}"
  transition-type="{{type}}"
  transition-duration="{{duration}}"
  bind:tap="goDetail"
>
  <card/>
</open-container>
```

### JS

```js
Page({
  goDetail() {
    wx.navigateTo({
      url: 'nextPageUrl'
    })
  }
})
```

## 组件属性

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| closed-color | string | `white` | 否 | 初始容器背景色 |
| closed-elevation | number | `0` | 否 | 初始容器影深大小 |
| closed-border-radius | number | `0` | 否 | 初始容器圆角大小 |
| middle-color | string | `''` | 否 | `fadeThrough` 模式下的过渡背景色 |
| open-color | string | `white` | 否 | 打开状态下容器背景色 |
| open-elevation | number | `0` | 否 | 打开状态下容器影深大小 |
| open-border-radius | number | `0` | 否 | 打开状态下容器圆角大小 |
| transition-duration | number | `300` | 否 | 动画时长（ms） |
| transition-type | string | `fade` | 否 | 动画类型 |

## OpenContainer 实例

`OpenContainer` 是 `open-container` 组件对应的 JS 实例对象，可通过 SelectorQuery 获取。

### 获取实例

```js
Page({
  onReady() {
    this.createSelectorQuery()
      .select('.my-container')
      .node()
      .exec(res => {
        const openContainerInstance = res[0].node
        // 可作为 withOpenContainer 参数使用
      })
  }
})
```

### 配合 navigateTo 使用

基础库 3.12.2 起，可通过 `withOpenContainer` 参数指定路由动画所用的 OpenContainer 实例：

```js
Page({
  goDetail() {
    this.createSelectorQuery()
      .select('.my-container')
      .node()
      .exec(res => {
        wx.navigateTo({
          url: 'detailPage',
          withOpenContainer: res[0].node,
        })
      })
  }
})
```

## 使用场景

| 场景 | 说明 |
|------|------|
| 瀑布流/卡片列表 | 点击卡片展开到详情页 |
| 图片预览 | 缩略图展开到大图页面 |
| 列表项详情 | 列表项展开到详情页面 |

## 示例代码片段

- 容器转场示例：`TMOyD8mB7YOB`
- OpenContainer API 示例：`G3tm7gmP8144`
