# worklet.scrollViewContext API 参考

> 基础库 3.3.0+ | 小程序插件：**不支持**

## 概述

`worklet.scrollViewContext` 提供在 worklet 函数内操作 `scroll-view` 组件的能力。通过 `NodesRef.ref` 获取 scroll-view 的引用，即可在 **UI 线程**中直接控制滚动，适用于配合手势事件实现高性能自定义滚动交互。

> 📌 Worklet 基础概念请参阅：[skyline-worklet](../../skyline-worklet/SKILL.md) - SharedValue、worklet 指令

## 与 ScrollViewContext.scrollTo 的对比

| 维度 | ScrollViewContext.scrollTo | worklet.scrollViewContext.scrollTo |
|------|---------------------------|-------------------------------------|
| 执行线程 | 逻辑线程 | UI 线程 |
| 获取方式 | `NodesRef.node()` | `NodesRef.ref()` + SharedValue |
| 需要 enhanced | 是 | 否 |
| worklet 指令 | 不需要 | **必须声明** |
| 适用场景 | 普通程序化滚动 | 配合手势/动画的高性能滚动 |
| 插件支持 | 支持 | **不支持** |
| 最低基础库 | 2.14.4 | 3.3.0 |

## 获取引用

```js
const { shared } = wx.worklet

Page({
  onLoad() {
    // 1. 创建 SharedValue 存储引用
    this.scrollRef = shared()
    // 2. 通过 ref() 获取 scroll-view 引用
    this.createSelectorQuery()
      .select('.scrollable')
      .ref((res) => {
        this.scrollRef.value = res.ref
      })
      .exec()
  }
})
```

> ⚠️ 必须使用 `ref()`（非 `node()`），且引用必须存入 SharedValue，以便在 worklet 函数内访问。

## 方法

### worklet.scrollViewContext.scrollTo(ref, Object object)

在 UI 线程中滚动 scroll-view 至指定位置。

**参数 1**: `ref` - 通过 `NodesRef.ref()` 获取并存入 SharedValue 的引用

**参数 2**: `Object object`

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| top | number | - | 否 | 顶部距离 |
| left | number | - | 否 | 左边界距离 |
| duration | number | - | 否 | 滚动动画时长（毫秒） |
| animated | boolean | - | 否 | 是否启用滚动动画 |
| easingFunction | string | - | 否 | 动画曲线 |

### 示例代码

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

## 要点

- 调用 `scrollTo` 的函数**必须声明 `'worklet'` 指令**
- 引用通过 `createSelectorQuery().select().ref()` 获取，存储在 SharedValue 中
- 可配合手势事件在 UI 线程中实现自定义滚动控制，避免跨线程通信延迟
- **不支持小程序插件**
