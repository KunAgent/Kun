# 页面返回手势

## 概述

默认小程序页面都是右滑返回。使用自定义路由和预设路由时，常需要不同的手势返回效果。例如自底向上弹出的页面，纵向滑动返回更符合视觉一致性。

**版本要求**：
- 开发者工具：Nightly 1.06.2403222
- 基础库：3.4.0

## 配置属性

在自定义路由配置（CustomRouteConfig）或 `wx.navigateTo` 的 `routeConfig` 中设置：

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| popGestureDirection | string | `horizontal` | 返回手势方向 |
| fullscreenDrag | boolean | `false` | 拖动返回区域是否拓展到全屏范围 |

### popGestureDirection 枚举值

| 值 | 说明 |
|----|------|
| `horizontal` | 仅横向拖动返回，fullscreenDrag 仅对横向拖动有效 |
| `vertical` | 仅纵向拖动返回 |
| `multi` | 横向和纵向均可拖动返回 |

## 使用方式

### 方式 1：在 routeBuilder 中配置

```js
const myRouteBuilder = (routeContext) => {
  // ...动画处理函数
  return {
    handlePrimaryAnimation,
    popGestureDirection: 'vertical',
    fullscreenDrag: true,
  }
}
wx.router.addRouteBuilder('myRoute', myRouteBuilder)
```

### 方式 2：在 navigateTo 的 routeConfig 中覆盖

```js
wx.navigateTo({
  url: 'xxx',
  routeType: 'wx://bottom-sheet',
  routeConfig: {
    popGestureDirection: 'multi',
    fullscreenDrag: true,
  }
})
```

`routeConfig` 会覆盖 `routeBuilder` 返回的配置项。

## 结合纵向滚动容器

当使用纵向拖动返回（`popGestureDirection: 'vertical'` 或 `'multi'`）时，若页面内有纵向滚动的 `<scroll-view>`，默认在 scroll-view 上滑动**无法触发**页面返回。

### 解决方案

声明 scroll-view 的 `associative-container` 为 `pop-gesture`，使滑动至顶端后可继续触发页面返回：

```html
<scroll-view
  type="custom"
  scroll-y
  associative-container="pop-gesture"
>
  <!-- 页面内容 -->
</scroll-view>
```

**工作机制**：当 scroll-view 滚动到顶部后继续下拉时，手势会传递给页面返回控制器，触发页面返回动画。

## 常见场景配置

| 场景 | popGestureDirection | fullscreenDrag |
|------|---------------------|----------------|
| 默认右滑返回 | `horizontal` | `false` |
| 底部弹窗下滑关闭 | `vertical` | `true` |
| 半屏多方向关闭 | `multi` | `true` |
| 全屏右滑返回 | `horizontal` | `true` |

## 示例代码片段

返回手势示例：`BGoSE0mS7KQS`
