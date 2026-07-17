# 预设路由

## 概述

基础库预设了一批常见的路由动画效果，降低开发成本。所有预设路由均可通过自定义路由自行实现。

**最低基础库版本**：3.1.0

## 预设路由类型

| routeType | 效果说明 | 最低基础库 |
|-----------|----------|-----------|
| `wx://bottom-sheet` | 底部弹出半屏 | 3.1.0 |
| `wx://upwards` | 自底向上全屏推入 | 3.1.0 |
| `wx://zoom` | 缩放进入 | 3.1.0 |
| `wx://cupertino-modal` | iOS 风格模态卡片 | 3.1.0 |
| `wx://cupertino-modal-inside` | iOS 模态内嵌导航 | 3.1.0 |
| `wx://modal-navigation` | 模态导航 | 3.1.0 |
| `wx://modal` | 模态弹窗 | 3.1.0 |

## 基本用法

仅需在路由跳转时指定对应的 `routeType`：

```js
wx.navigateTo({
  url: 'xxx',
  routeType: 'wx://modal'
})
```

## routeConfig 覆盖配置

基础库 3.4.0 起，`wx.navigateTo` 支持 `routeConfig` 参数，可覆盖预设路由的默认配置。

```js
wx.navigateTo({
  url: 'xxx',
  routeType: 'wx://bottom-sheet',
  routeConfig: {
    fullscreenDrag: true,
    popGestureDirection: 'multi'
  }
})
```

`routeConfig` 支持 `CustomRouteConfig` 中的所有配置项，传入的值会覆盖 routeBuilder 返回的配置。

## routeOptions 参数

基础库 3.4.0 起，`wx.navigateTo` 支持 `routeOptions` 参数，作为 routeBuilder 的第二个参数传入。开发者可根据当前页面动态改变路由动画内容。

```js
wx.navigateTo({
  url: 'xxx',
  routeType: 'wx://bottom-sheet',
  routeOptions: {
    round: false,
    height: 80,
  }
})
```

### wx://bottom-sheet 的 routeOptions

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| round | boolean | true | 是否使用圆角 |
| height | number | 60 | 弹窗页面高度，单位 vh |

## 结合返回手势

预设路由可结合 `routeConfig` 自定义返回手势行为：

```js
// 底部弹出 + 纵向拖动返回 + 全屏拖动区域
wx.navigateTo({
  url: 'xxx',
  routeType: 'wx://bottom-sheet',
  routeConfig: {
    popGestureDirection: 'vertical',
    fullscreenDrag: true,
  },
  routeOptions: {
    height: 70,
  }
})
```

## 低版本降级

低版本基础库会降级到多 WebView 下的默认路由动画（从右向左推入），不会报错。

## 示例代码片段

预设路由示例：`https://developers.weixin.qq.com/s/XC8BGymC7QMo`
