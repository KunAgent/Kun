# Skyline 迁移起步

## 环境准备

### 支持版本

| 平台 | 最低版本 | 基础库版本 |
|------|----------|------------|
| 微信 Android | 8.0.40+ | 3.0.2+ |
| 微信 iOS | 8.0.40+ | 3.0.2+ |
| 微信 HarmonyOS | 1.0.10+ | 3.11.3+ |
| 开发者工具 | Stable 1.06.2307260+ | - |

### 开发者工具配置

1. 详情 > 本地设置 > 勾选「开启 Skyline 渲染调试」
2. 使用 worklet 时勾选「编译 worklet 代码」
3. 调试基础库切到 3.0.0 或以上

## 配置步骤

### 第一步：app.json 全局配置

```json
{
  "lazyCodeLoading": "requiredComponents",
  "renderer": "skyline",
  "componentFramework": "glass-easel",
  "rendererOptions": {
    "skyline": {
      "defaultDisplayBlock": true,
      "defaultContentBox": true,
      "tagNameStyleIsolation": "legacy",
      "enableScrollViewAutoSize": true,
      "keyframeStyleIsolation": "legacy"
    }
  }
}
```

**配置项说明**：

| 配置项 | 必需 | 说明 |
|--------|------|------|
| `lazyCodeLoading` | ✅ | 开启按需注入 |
| `renderer` | ✅ | 指定渲染引擎 |
| `componentFramework` | ✅ | 使用 glass-easel 组件框架 |
| `rendererOptions.skyline.defaultDisplayBlock` | 推荐 | 默认 block 布局，对齐 WebView |
| `rendererOptions.skyline.defaultContentBox` | 推荐 | 默认 content-box，对齐 WebView |
| `rendererOptions.skyline.tagNameStyleIsolation` | 推荐 | tag 选择器全局匹配 |
| `rendererOptions.skyline.enableScrollViewAutoSize` | 推荐 | scroll-view 自动撑高 |
| `rendererOptions.skyline.keyframeStyleIsolation` | 推荐 | @keyframes 全局共享 |

### 第二步：页面配置

每个 Skyline 页面的 `page.json`：

```json
{
  "navigationStyle": "custom",
  "disableScroll": true
}
```

**说明**：
- `navigationStyle: custom`：Skyline 不支持原生导航栏，必须自定义
- `disableScroll: true`：禁用全局滚动，使用 scroll-view 局部滚动

### 第三步：按页面粒度开启（可选）

如果只想在部分页面使用 Skyline：

```json
// 全局 app.json 不设置 renderer
{
  "lazyCodeLoading": "requiredComponents",
  "componentFramework": "glass-easel"
}

// 单个页面 page.json 开启
{
  "renderer": "skyline",
  "navigationStyle": "custom",
  "disableScroll": true
}
```

### 第四步：按分包粒度开启（可选）

```json
// app.json
{
  "subPackages": [
    {
      "root": "packageA",
      "pages": ["pages/index"],
      "renderer": "skyline",
      "componentFramework": "glass-easel"
    }
  ]
}
```

## 代码适配

### 1. 实现自定义导航栏

```html
<!-- components/navbar/navbar.wxml -->
<view class="navbar" style="padding-top: {{statusBarHeight}}px;">
  <view class="navbar-content">
    <view class="back-btn" bindtap="goBack" wx:if="{{showBack}}">
      <text class="back-icon">‹</text>
    </view>
    <text class="title">{{title}}</text>
  </view>
</view>
```

```javascript
// components/navbar/navbar.js
Component({
  properties: {
    title: String,
    showBack: { type: Boolean, value: true }
  },
  data: {
    statusBarHeight: 0
  },
  lifetimes: {
    attached() {
      const { statusBarHeight } = wx.getSystemInfoSync()
      this.setData({ statusBarHeight })
    }
  },
  methods: {
    goBack() {
      wx.navigateBack()
    }
  }
})
```

### 2. 改用 scroll-view 局部滚动

```html
<!-- 页面结构 -->
<view class="page">
  <!-- 固定导航栏 -->
  <navbar title="页面标题" />
  
  <!-- 滚动区域 -->
  <scroll-view type="list" scroll-y class="content">
    <!-- 页面内容 -->
  </scroll-view>
</view>
```

```css
/* 页面样式 */
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  height: 0; /* 重要：让 flex: 1 生效 */
}
```

### 3. 纯文本用 text 组件包裹

```html
<!-- ❌ 之前 -->
<view>这是文本</view>

<!-- ✅ 之后 -->
<view>
  <text>这是文本</text>
</view>
```

### 4. 检查 WXSS 兼容性

常见需要调整的样式：

| WebView 写法 | Skyline 写法 |
|--------------|--------------|
| `display: inline` | `display: flex` 或用 `span` 组件 |
| `display: grid` | `grid-view` 组件或 `flex` 布局 |
| `position: sticky` | `sticky-header` 组件 |
| `overflow: scroll` | `scroll-view` 组件 |

## 验证迁移结果

### 1. 模拟器检查

模拟器左上角显示 `renderer: skyline` 表示成功：

![Skyline 模式指示器]

### 2. 代码判断

```javascript
Page({
  onLoad() {
    console.log('当前渲染引擎:', this.renderer)
    // 输出 'skyline' 或 'webview'
  }
})
```

### 3. API 检查

```javascript
const info = wx.getSkylineInfoSync()
console.log('支持 Skyline:', info.isSupported)
console.log('Skyline 版本:', info.version)
```

## 真机预览

### 方式一：配置 We 分析 AB 实验

1. 进入 We 分析 > AB 实验 > 实验看板
2. 新建实验，选择「小程序基础库实验」
3. 在 Skyline 实验分组添加测试微信号

### 方式二：快捷切换（开发版/体验版）

1. 打开小程序菜单 > 开发调试 > Switch Render
2. 选择 Skyline 强制切换

### 方式三：关闭 AB 实验（全量启用）

```json
"rendererOptions": {
  "skyline": {
    "disableABTest": true,
    "sdkVersionBegin": "3.0.1",
    "sdkVersionEnd": "15.255.255"
  }
}
```

## 常见问题排查

### 白屏问题

1. 检查是否缺少必需配置项
2. 重启开发者工具
3. 清除编译缓存后重新编译

### 布局错乱

1. 开启 `defaultDisplayBlock` 和 `defaultContentBox`
2. 检查 flex 布局方向是否正确
3. 检查是否有不支持的 CSS 属性

### 原生组件不显示

map/canvas/video/camera 在开发者工具暂不支持，使用真机预览。

## 下一步

1. 查看 [兼容性问题](./compatibility.md) 了解常见问题
2. 查看 [最佳实践](./best-practice.md) 优化代码
3. 准备 [发布上线](./release.md)
