# 配置模板

## 模板 1：新项目 app.json

适用于从零创建的 Skyline 项目，包含所有推荐配置。

```json
{
  "pages": [
    "pages/index/index",
    "pages/detail/detail"
  ],
  "window": {
    "navigationStyle": "custom",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#f5f5f5"
  },
  "renderer": "skyline",
  "componentFramework": "glass-easel",
  "lazyCodeLoading": "requiredComponents",
  "rendererOptions": {
    "skyline": {
      "defaultDisplayBlock": true,
      "defaultContentBox": true,
      "tagNameStyleIsolation": "legacy",
      "enableScrollViewAutoSize": true,
      "disableABTest": true
    }
  }
}
```

## 模板 2：迁移项目 app.json

适用于从 WebView 迁移到 Skyline 的项目，包含所有兼容配置。

```json
{
  "pages": [
    "pages/index/index",
    "pages/list/list",
    "pages/detail/detail"
  ],
  "window": {
    "navigationStyle": "custom",
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#f5f5f5"
  },
  "renderer": "skyline",
  "componentFramework": "glass-easel",
  "lazyCodeLoading": "requiredComponents",
  "rendererOptions": {
    "skyline": {
      "defaultDisplayBlock": true,
      "defaultContentBox": true,
      "tagNameStyleIsolation": "legacy",
      "enableScrollViewAutoSize": true,
      "disableABTest": true
    }
  },
  "sitemapLocation": "sitemap.json"
}
```

### 迁移要点

- `defaultDisplayBlock: true` — 对齐 WebView 的 `display: block` 默认行为
- `defaultContentBox: true` — 对齐 WebView 的 `box-sizing: content-box` 默认行为
- `tagNameStyleIsolation: "legacy"` — 标签选择器全局匹配，对齐 WebView
- `disableABTest: true` — 关闭灰度实验，确保所有用户体验一致

## 模板 3：混合渲染 app.json

适用于渐进式迁移，全局 WebView + 部分页面 Skyline。

```json
{
  "pages": [
    "pages/index/index",
    "pages/skyline-page/skyline-page",
    "pages/webview-page/webview-page"
  ],
  "window": {
    "navigationBarTextStyle": "black",
    "backgroundColor": "#f5f5f5"
  },
  "lazyCodeLoading": "requiredComponents",
  "sitemapLocation": "sitemap.json"
}
```

对应的 Skyline 页面 json：

```json
// pages/skyline-page/skyline-page.json
{
  "renderer": "skyline",
  "componentFramework": "glass-easel",
  "navigationStyle": "custom",
  "disableScroll": true,
  "rendererOptions": {
    "skyline": {
      "defaultDisplayBlock": true,
      "defaultContentBox": true
    }
  }
}
```

对应的 WebView 页面 json（无需特殊配置）：

```json
// pages/webview-page/webview-page.json
{
  "navigationBarTitleText": "WebView 页面"
}
```

## 模板 4：标准页面 json

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

### 透明背景页面（自定义路由）

```json
{
  "navigationStyle": "custom",
  "backgroundColorContent": "#00000000",
  "disableScroll": true
}
```

## 配置检查清单

### 新项目检查清单

| # | 检查项 | 文件 | 状态 |
|---|--------|------|------|
| 1 | `"renderer": "skyline"` | app.json | □ |
| 2 | `"componentFramework": "glass-easel"` | app.json | □ |
| 3 | `"lazyCodeLoading": "requiredComponents"` | app.json | □ |
| 4 | `rendererOptions.skyline` 已配置 | app.json | □ |
| 5 | `"disableABTest": true` | app.json rendererOptions | □ |
| 6 | 所有页面 json 包含 `"navigationStyle": "custom"` | 页面 json | □ |
| 7 | 可滚动页面配置 `"disableScroll": true` | 页面 json | □ |
| 8 | `"skylineRenderEnable": true` | project.config.json | □ |

### 迁移项目额外检查

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | `defaultDisplayBlock: true` | 避免 display 从 block 变为 flex、flex-direction 从 row 变为 column、align-items 从 normal 变为 stretch |
| 2 | `defaultContentBox: true` | 避免盒模型从 content-box 变为 border-box |
| 3 | `tagNameStyleIsolation: "legacy"` | 避免标签选择器作用域变化 |
| 4 | 所有页面已添加自定义导航栏 | 替代原生导航栏 |
| 5 | 页面滚动已改用 scroll-view | 替代页面级滚动 |
