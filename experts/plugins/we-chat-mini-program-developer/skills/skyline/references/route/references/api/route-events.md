# 路由事件监听 API

## 概述

基础库 3.5.5 起提供全局路由事件监听接口，可在路由执行前后获取路由信息。

## wx.onBeforeAppRoute(function listener)

监听路由事件下发后、**执行路由逻辑前**的事件。

**最低基础库**：3.5.5

### listener 回调参数（Object res）

| 属性 | 类型 | 说明 |
|------|------|------|
| path | string | 页面路径 |
| query | Object | 路由参数 |
| renderer | string | 渲染引擎（`webview` / `skyline` / `xr-frame`） |
| openType | string | 路由打开类型 |
| webviewId | number | 当前页面 id |
| routeEventId | string | 路由事件 id |
| pipMode | string | 画中画模式（`min` 缩小为小窗 / `max` 还原为页面） |
| notFound | boolean | 是否未找到页面 |
| page | Object | 当前打开页面的相关配置 |

### 代码示例

```js
const func = function (res) {
  console.log('路由即将执行:', res.path)
  console.log('渲染引擎:', res.renderer) // 'skyline' 或 'webview'
  console.log('路由类型:', res.openType)
}
wx.onBeforeAppRoute(func)

// 取消监听
wx.offBeforeAppRoute(func)
```

## wx.onAppRoute(function listener)

监听路由事件下发后、**执行路由逻辑后**的事件。

**最低基础库**：3.5.5

### listener 回调参数（Object res）

与 `wx.onBeforeAppRoute` 相同，但额外包含：

| 属性 | 类型 | 说明 |
|------|------|------|
| timeStamp | number | 路由下发的时间戳（`onAppRoute` 独有） |

其余字段（path、query、renderer、openType、webviewId、routeEventId、pipMode、notFound、page）与 `onBeforeAppRoute` 一致。

### 代码示例

```js
const func = function (res) {
  console.log('路由已执行:', res.path)
  console.log('时间戳:', res.timeStamp)
}
wx.onAppRoute(func)

// 取消监听
wx.offAppRoute(func)
```

## 两者区别

| 接口 | 触发时机 | 独有字段 |
|------|----------|----------|
| `wx.onBeforeAppRoute` | 路由逻辑执行**前** | 无 |
| `wx.onAppRoute` | 路由逻辑执行**后** | `timeStamp` |

## renderer 字段值

| 值 | 说明 |
|----|------|
| `webview` | WebView 渲染引擎 |
| `skyline` | Skyline 渲染引擎 |
| `xr-frame` | xr-frame 解决方案 |

可用于判断目标页面的渲染引擎类型：

```js
wx.onBeforeAppRoute(function(res) {
  if (res.renderer === 'skyline') {
    // Skyline 页面，可预加载资源
    wx.preloadSkylineView()
  }
})
```

## 重要说明

- 在低于 3.5.5 版本的基础库中也可能存在此接口，但参数可能与当前文档不同
- 支持小程序插件（基础库 >= 3.5.5）
- 支持微信鸿蒙 OS 版

## 取消监听

| 监听 | 取消 |
|------|------|
| `wx.onBeforeAppRoute(fn)` | `wx.offBeforeAppRoute(fn)` |
| `wx.onAppRoute(fn)` | `wx.offAppRoute(fn)` |

**注意**：取消监听时必须传入与监听时相同的函数引用。
