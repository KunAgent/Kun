# ScrollViewContext API 参考

> 基础库 2.14.4+

## 概述

增强 ScrollView 实例，可通过 `wx.createSelectorQuery` 的 `NodesRef.node` 方法获取。**仅在 scroll-view 组件开启 `enhanced` 属性后生效**。

## 获取方式

```js
// WXML: <scroll-view id="sv" type="list" scroll-y enhanced>
wx.createSelectorQuery()
  .select('#sv')
  .node()
  .exec((res) => {
    const scrollView = res[0].node
    // scrollView 即 ScrollViewContext 实例
    scrollView.scrollEnabled = false
  })
```

## 属性

| 属性 | 类型 | 说明 | 平台限制 |
|------|------|------|----------|
| scrollEnabled | boolean | 滚动开关 | - |
| bounces | boolean | 设置滚动边界弹性 | 仅 iOS |
| showScrollbar | boolean | 设置是否显示滚动条 | - |
| pagingEnabled | boolean | 分页滑动开关 | - |
| fastDeceleration | boolean | 设置滚动减速速率 | 仅 iOS |
| decelerationDisabled | boolean | 取消滚动惯性 | 仅 iOS |

## 方法

### ScrollViewContext.scrollTo(Object object)

> 基础库 2.14.4+ | 小程序插件：支持 | Windows/Mac：支持

滚动至指定位置。

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| top | number | - | 否 | 顶部距离 |
| left | number | - | 否 | 左边界距离 |
| velocity | number | - | 否 | 初始速度（仅 iOS） |
| duration | number | - | 否 | 滚动动画时长（仅 iOS） |
| animated | boolean | - | 否 | 是否启用滚动动画 |

```js
scrollView.scrollTo({ top: 500, animated: true })
```

### ScrollViewContext.scrollIntoView(string selector, object ScrollIntoViewOptions)

> 基础库 2.14.4+ | 小程序插件：支持 | Windows/Mac：支持

滚动至指定元素位置。

**参数 1**: `selector` - 元素选择器

**参数 2**: `ScrollIntoViewOptions`（基础库 3.1.0+，**仅 Skyline 模式支持**）

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| offset | number | 0 | 否 | 跳转到目标节点时的额外偏移 |
| withinExtent | boolean | false | 否 | 只跳转到 cacheExtent 以内的目标节点，性能更佳 |
| alignment | string | "start" | 否 | 指定目标节点在视口内的位置（start/center/end/nearest） |
| animated | boolean | true | 否 | 是否启用滚动动画 |

```js
// 基础用法
scrollView.scrollIntoView('#target')

// Skyline 增强用法（基础库 3.1.0+）
scrollView.scrollIntoView('#target', {
  alignment: 'center',
  offset: -20,
  animated: true
})
```

> ⚠️ `ScrollIntoViewOptions` 仅在 Skyline 模式下支持，WebView 模式仅支持 selector 参数。

### ScrollViewContext.triggerRefresh(Object object)

> 基础库 3.0.0+ | 小程序插件：支持

触发下拉刷新。

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| duration | number | 300 | 否 | 动画时长 |
| easingFunction | string | ease | 否 | 动画曲线 |

### ScrollViewContext.closeRefresh()

> 基础库 3.0.0+ | 小程序插件：支持

关闭下拉刷新。无参数。

### ScrollViewContext.triggerTwoLevel(Object object)

> 基础库 3.0.0+ | 小程序插件：支持

触发下拉二级。

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| duration | number | 500 | 否 | 动画时长 |
| easingFunction | string | ease | 否 | 动画曲线 |

### ScrollViewContext.closeTwoLevel(Object object)

> 基础库 3.0.0+ | 小程序插件：支持

关闭下拉二级。

| 属性 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| duration | number | 500 | 否 | 动画时长 |
| easingFunction | string | ease | 否 | 动画曲线 |

## 与组件属性的关系

ScrollViewContext 提供**程序化控制**能力，与 scroll-view 组件的声明式属性互补：

| 需求 | 组件属性 | Context API |
|------|----------|-------------|
| 控制滚动位置 | `scroll-top` / `scroll-into-view` | `scrollTo()` / `scrollIntoView()` |
| 下拉刷新 | `refresher-enabled` + 事件绑定 | `triggerRefresh()` / `closeRefresh()` |
| 下拉二级 | `refresher-two-level-enabled` + 事件绑定 | `triggerTwoLevel()` / `closeTwoLevel()` |

> 📌 组件属性详情请参阅：[skyline-components](../../skyline-components/SKILL.md) - scroll-view 组件
