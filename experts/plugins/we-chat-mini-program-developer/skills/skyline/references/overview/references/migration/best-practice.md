# Skyline 最佳实践

## 一、按需注入

Skyline 依赖按需注入特性，建议在适配 Skyline 前先开启并测试：

```json
// app.json
{
  "lazyCodeLoading": "requiredComponents"
}
```

**注意**：按需注入可能影响部分代码行为，请提前测试。

## 二、渐进式迁移

### 迁移策略

| 场景 | 推荐策略 |
|------|----------|
| 已有大型项目 | 逐页面迁移关键路径 |
| 新增页面 | 默认开启 Skyline |
| 全新项目 | 全局开启 Skyline |

### 页面粒度迁移

```json
// 某个页面的 page.json
{
  "renderer": "skyline",
  "navigationStyle": "custom",
  "disableScroll": true
}
```

### 分包粒度迁移

```json
// app.json
{
  "subPackages": [
    {
      "root": "packageA",
      "renderer": "skyline",
      "componentFramework": "glass-easel"
    }
  ]
}
```

## 三、使用局部滚动

### 为什么不用全局滚动？

WebView 的全局滚动存在问题：
1. 固定元素需要 `position: fixed`，模拟局部滚动
2. 滚动相关自定义功能受限
3. 滚动条位置溢出

### 推荐布局模式

```html
<!-- 导航栏 + 滚动区域 -->
<view class="page">
  <!-- 固定导航栏 -->
  <navbar title="页面标题" />
  
  <!-- 可滚动内容 -->
  <scroll-view type="list" scroll-y class="content">
    <view wx:for="{{list}}" wx:key="id">{{item}}</view>
  </scroll-view>
</view>
```

```css
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  height: 0; /* 重要 */
}
```

### 兼容 WebView

上述布局在 WebView 下也能正确工作，确保降级兼容。

## 四、全局样式重置

### 推荐配置

```json
// app.json
{
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

### 全局 WXSS Reset

```css
/* app.wxss 或页面 wxss */
page,
view,
text,
image,
button,
video,
map,
scroll-view,
swiper,
input,
textarea,
navigator {
  position: relative;
  background-origin: border-box;
  isolation: isolate;
}

page {
  height: 100%;
}
```

## 五、优化长列表性能

### 按需渲染

scroll-view 自动按需渲染直接子节点：

```html
<!-- ✅ 列表项作为直接子节点 -->
<scroll-view type="list" scroll-y>
  <view wx:for="{{list}}" wx:key="id">{{item.name}}</view>
</scroll-view>

<!-- ❌ 列表项被包裹，无法按需渲染 -->
<scroll-view type="list" scroll-y>
  <view class="list-wrapper">
    <view wx:for="{{list}}" wx:key="id">{{item.name}}</view>
  </view>
</scroll-view>
```

### 样式共享

添加 `list-item` 声明启用样式共享：

```html
<scroll-view type="list" scroll-y>
  <view wx:for="{{list}}" wx:key="id" list-item>
    {{item.name}}
  </view>
</scroll-view>
```

样式只计算一次，共享给所有相似节点。

## 六、预加载 Skyline 环境

微信客户端默认不预加载 Skyline 环境（WebView 为主），需手动预加载：

```javascript
// 在可能跳转到 Skyline 页面的页面中
Page({
  onShow() {
    // 延迟调用，避免阻塞当前页面
    setTimeout(() => {
      wx.preloadSkylineView()
    }, 500)
  }
})
```

**建议**：在 `onShow` 中调用，确保页面返回时也能重新预加载。

## 七、使用增强特性

### 体验降级兼容

Skyline 增强特性在 WebView 下自动降级：

| 特性 | Skyline | WebView 降级 |
|------|---------|--------------|
| 自定义路由 | 自定义动画 | 默认动画 |
| 共享元素 | 过渡动画 | 无动画 |
| 按需渲染 | 优化性能 | 无优化 |

### 示例：自定义路由降级

```javascript
// 相同代码，不同表现
wx.navigateTo({
  url: '/pages/detail/detail',
  routeType: 'wx://cubeEffect'  // Skyline 有动画，WebView 无动画
})
```

## 八、调试技巧

### 识别当前渲染引擎

1. **模拟器左上角**：显示 `renderer: skyline`
2. **vConsole 路由日志**：`... renderer: skyline`
3. **代码判断**：`this.renderer === 'skyline'`

### 快捷切换测试

开发版/体验版：
1. 打开菜单 > 开发调试 > Switch Render
2. 选择 Auto / WebView / Skyline

### WXML 调试

1. 使用开发者工具 WXML 面板
2. 定位有问题的节点
3. 查看样式警告和计算值

## 九、性能监控

### 首屏性能

使用小程序性能监控工具对比 Skyline 和 WebView 首屏时间。

### 内存占用

多页面场景下对比内存占用：
- 单页：Skyline 减少 ~35%
- 多页：Skyline 减少 ~50%

### FPS 监控

复杂动画场景使用 FPS 监控工具验证流畅度。

## 十、代码组织建议

### 目录结构

```
├── components/
│   ├── navbar/           # 自定义导航栏
│   ├── scroll-list/      # 封装的列表组件
│   └── ...
├── pages/
│   ├── index/
│   │   ├── index.json    # renderer: skyline
│   │   └── ...
│   └── ...
├── styles/
│   └── reset.wxss        # 全局样式重置
└── app.json
```

### 封装常用组件

将 Skyline 特有的模式封装成组件：

```javascript
// components/scroll-list/scroll-list.js
Component({
  properties: {
    list: Array
  }
})
```

```html
<!-- components/scroll-list/scroll-list.wxml -->
<scroll-view type="list" scroll-y class="scroll-list">
  <view wx:for="{{list}}" wx:key="id" list-item>
    <slot name="item" item="{{item}}" />
  </view>
</scroll-view>
```
