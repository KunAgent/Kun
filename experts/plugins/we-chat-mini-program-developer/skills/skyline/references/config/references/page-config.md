# 页面级配置详解

## 概述

每个页面的 `.json` 文件可以对当前页面进行独立配置，覆盖 `app.json` 中的全局设置。本文档聚焦于 Skyline 相关的页面级配置项。

## navigationStyle（必需）

| 值 | 说明 |
|----|------|
| `default` | 默认样式，显示原生导航栏 |
| `custom` | 自定义导航栏，只保留右上角胶囊按钮 |

**Skyline 下必须设为 `"custom"`**。Skyline 不支持原生导航栏渲染，未配置将导致编译错误：

```text
getAppConfig error: the "navigationStyle" configuration for the page should be set to "custom"
```

```json
{
  "navigationStyle": "custom"
}
```

> ⚠️ 即使在 `app.json` 的 `window` 中已设置 `"navigationStyle": "custom"`，每个页面 json 仍建议显式声明，确保配置明确。

### 自定义导航栏实现

配置 `"navigationStyle": "custom"` 后，页面顶部没有默认导航栏，需要自行实现：

```html
<!-- 自定义导航栏组件 -->
<view class="nav-bar" style="padding-top: {{statusBarHeight}}px;">
  <view class="nav-bar__title">页面标题</view>
</view>
<scroll-view type="list" scroll-y style="height: 100vh;">
  <!-- 页面内容 -->
</scroll-view>
```

## disableScroll

| 值 | 说明 |
|----|------|
| `false` | 默认值，页面可整体滚动 |
| `true` | 页面整体不能上下滚动 |

**注意**：此配置只在页面 json 中有效，无法在 `app.json` 中设置。

Skyline 不支持页面级全局滚动，建议配置 `"disableScroll": true` 并使用 `scroll-view` 组件管理滚动：

```json
{
  "navigationStyle": "custom",
  "disableScroll": true
}
```

## backgroundColorContent

> Skyline 特有属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| backgroundColorContent | HexColor | #RRGGBBAA | 页面容器背景色 |

用于设置页面容器的背景色，支持带透明度的颜色值。常用于自定义路由中设置页面透明背景：

```json
{
  "navigationStyle": "custom",
  "backgroundColorContent": "#00000000"
}
```

> 📌 透明页面背景详情请参阅：[skyline-route](../../skyline-route/SKILL.md) - 自定义路由

## renderer（页面级覆盖）

> 基础库 2.30.4+

页面级的 `renderer` 配置可覆盖 `app.json` 中的全局设置，实现**混合渲染**：

```json
// 某个页面使用 Skyline（即使全局是 WebView）
{
  "renderer": "skyline",
  "navigationStyle": "custom",
  "componentFramework": "glass-easel"
}
```

```json
// 某个页面回退到 WebView（即使全局是 Skyline）
{
  "renderer": "webview"
}
```

### 混合渲染策略

| 策略 | app.json renderer | 页面 json renderer | 适用场景 |
|------|-------------------|-------------------|----------|
| 全局 Skyline | `"skyline"` | 不设置 | 新项目，全部页面用 Skyline |
| 全局 WebView + 部分 Skyline | 不设置/`"webview"` | `"skyline"` | 渐进式迁移 |
| 全局 Skyline + 部分 WebView | `"skyline"` | `"webview"` | 个别页面不兼容时回退 |

## rendererOptions（页面级覆盖）

> 基础库 3.1.0+

页面级可以覆盖 `app.json` 中的 `rendererOptions` 配置：

```json
{
  "navigationStyle": "custom",
  "rendererOptions": {
    "skyline": {
      "defaultDisplayBlock": false
    }
  }
}
```

## componentFramework（页面级覆盖）

> 基础库 2.30.4+

页面级可以覆盖组件框架配置。混合渲染中使用 Skyline 的页面必须同时配置：

```json
{
  "renderer": "skyline",
  "componentFramework": "glass-easel",
  "navigationStyle": "custom"
}
```

## 标准页面 json 模板

### 基础页面

```json
{
  "navigationStyle": "custom",
  "usingComponents": {
    "nav-bar": "/components/nav-bar/index"
  }
}
```

### 可滚动页面

```json
{
  "navigationStyle": "custom",
  "disableScroll": true,
  "usingComponents": {
    "nav-bar": "/components/nav-bar/index"
  }
}
```

### 透明背景页面（用于自定义路由）

```json
{
  "navigationStyle": "custom",
  "backgroundColorContent": "#00000000",
  "disableScroll": true
}
```
