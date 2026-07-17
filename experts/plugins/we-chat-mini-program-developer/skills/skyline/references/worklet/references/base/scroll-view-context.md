# ScrollViewContext

> 基础库 3.3.0+

## 概述

`worklet.scrollViewContext` 提供在 worklet 函数内操作 `scroll-view` 组件的能力。通过 `NodesRef.ref` 获取 scroll-view 的引用，即可在 UI 线程中直接控制滚动。

## scrollViewContext.scrollTo(object)

滚动至指定位置。

**签名**：`worklet.scrollViewContext.scrollTo(ref, Object object)`

### 参数

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| top | number | - | 否 | 顶部距离 |
| left | number | - | 否 | 左边界距离 |
| duration | number | - | 否 | 滚动动画时长（毫秒） |
| animated | boolean | - | 否 | 是否启用滚动动画 |
| easingFunction | string | - | 否 | 动画曲线 |

### 用法示例

```js
const { shared, scrollViewContext } = wx.worklet

Page({
  onLoad() {
    this.scrollRef = shared()
    this.createSelectorQuery()
      .select('.scrollable')
      .ref((res) => {
        this.scrollRef.value = res.ref
      })
      .exec()
  },

  onTap() {
    'worklet'
    scrollViewContext.scrollTo(this.scrollRef.value, {
      top: 200,
      duration: 2000,
      animated: true,
      easingFunction: 'ease'
    })
  }
})
```

### 要点

- 需要先通过 `createSelectorQuery().select().ref()` 获取 scroll-view 的引用
- 引用存储在 SharedValue 中，以便在 worklet 函数内访问
- 可配合手势事件在 UI 线程中实现自定义滚动控制
