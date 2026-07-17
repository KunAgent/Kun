# Skyline 常见兼容问题

## 平台支持情况

| 平台 | 支持版本 | 状态 |
|------|----------|------|
| Android | 8.0.33+ | ✅ 支持 |
| iOS | 8.0.34+ | ✅ 支持 |
| 开发者工具 | Stable 1.06.2307260+ | ✅ 支持 |
| Windows | - | 规划中 |
| Mac | - | 规划中 |
| 企业微信 | - | 开发中 |

## 兼容方法

### 样式兼容

使用开发者工具的 WXML 调试工具定位样式问题：

1. 选中有问题的节点
2. 查看 Computed 面板中的样式警告
3. 根据警告调整样式

**推荐开启兼容配置**：

```json
"rendererOptions": {
  "skyline": {
    "defaultDisplayBlock": true,
    "defaultContentBox": true,
    "tagNameStyleIsolation": "legacy"
  }
}
```

### 根据 renderer 条件渲染

```html
<!-- WXML -->
<view class="position {{renderer === 'skyline' ? 'skyline' : ''}}">
  内容
</view>
```

```css
/* WXSS */
.position {
  position: fixed;
}
.position.skyline {
  position: absolute;
}
```

```javascript
// JS
Page({
  data: {
    renderer: 'webview'
  },
  onLoad() {
    this.setData({
      renderer: this.renderer
    })
  }
})
```

## 常见问题 FAQ

### Q: Skyline 必须应用到整个小程序吗？

**A**: 不需要。Skyline 支持按页面或分包粒度开启，可渐进式迁移。

---

### Q: 开启 Skyline 后布局错乱

**A**: 通常是默认布局和盒模型差异导致：

```json
// 开启这两个配置对齐 WebView 默认值
"rendererOptions": {
  "skyline": {
    "defaultDisplayBlock": true,
    "defaultContentBox": true
  }
}
```

---

### Q: 为什么顶部原生导航栏消失？

**A**: Skyline 不支持原生导航栏，需自行实现：

```json
// page.json
{
  "navigationStyle": "custom"
}
```

推荐使用 WeUI 导航栏组件或自定义实现。

---

### Q: position: absolute 相对坐标不准确

**A**: Skyline 下所有节点默认是 `position: relative`，导致 absolute 参照不同。

**解决方案**：
1. 显式设置父节点 `position: static`
2. 或调整 absolute 元素的相对坐标

---

### Q: 多段文本无法内联

**A**: Skyline 不支持 `display: inline`。

**解决方案**：

```html
<!-- 方案一：用 text 组件包裹 -->
<text>
  <text>文本1</text>
  <text>文本2</text>
</text>

<!-- 方案二：用 span 组件（支持图文混排） -->
<span>
  <text>文本1</text>
  <image src="icon.png" />
  <text>文本2</text>
</span>

<!-- 方案三：用 flex 布局 -->
<view style="display: flex;">
  <text>文本1</text>
  <text>文本2</text>
</view>
```

---

### Q: 单行文本省略失效

**A**: `text-overflow: ellipsis` 只在 text 组件上生效。

```html
<!-- ❌ 错误：在 view 上使用 -->
<view style="overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
  很长的文本
</view>

<!-- ✅ 正确：在 text 上使用 -->
<text style="overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
  很长的文本
</text>
```

---

### Q: 多行文本省略失效

**A**: 使用 text 组件的 `max-lines` 属性：

```html
<text max-lines="2" style="overflow: hidden;">
  很长的多行文本内容...
</text>
```

---

### Q: z-index 表现异常

**A**: Skyline 不支持 Web 标准的层叠上下文，`z-index` 只在同层级节点间有效。

**解决方案**：
1. 将需要调整层级的节点放在同一层级
2. 调整 DOM 结构顺序

---

### Q: WeUI 扩展库无法使用

**A**: 使用 npm 安装 WeUI 组件库：

```bash
npm install weui-miniprogram
```

然后在开发者工具中构建 npm。

---

### Q: 不支持 animate 动画接口

**A**: 使用 worklet 动画机制替代：

```javascript
// 原 animate 写法
this.animate('.box', [...], 1000)

// worklet 写法
const offset = wx.worklet.shared(0)
this.applyAnimatedStyle('.box', () => {
  'worklet'
  return { transform: `translateX(${offset.value}px)` }
})
offset.value = wx.worklet.timing(100, { duration: 1000 })
```

---

### Q: SVG 渲染不正确

**A**: Skyline SVG 不支持 `<style>` 选择器匹配。

**解决方案**：
1. 将样式转为内联形式
2. `rgba` 格式改用 `fill-opacity` 属性
3. 使用 [SVGO](https://jakearchibald.github.io/svgomg/) 优化 SVG

---

### Q: 自定义组件样式不正确

**A**: Skyline 下 tag 和 id 选择器不支持跨组件匹配。

**解决方案**：
1. 开启 tag 选择器全局匹配：
```json
"rendererOptions": {
  "skyline": {
    "tagNameStyleIsolation": "legacy"
  }
}
```
2. 使用 class 选择器并注意组件样式隔离机制

---

### Q: scroll-view 横向滚动不生效

**A**: 横向滚动需要额外配置：

```html
<scroll-view 
  type="list" 
  scroll-x 
  enable-flex 
  style="display: flex; flex-direction: row;"
>
  <view 
    wx:for="{{list}}" 
    wx:key="id" 
    style="flex-shrink: 0;"
  >
    {{item}}
  </view>
</scroll-view>
```

---

### Q: scroll-view 内容多时 boundingClientRect 无法执行

**A**: scroll-view 直接子节点按需渲染，不在屏的节点无法获取尺寸。

**解决方案**：逐个获取节点的 boundingClientRect，而非 selectAll。

---

### Q: map/canvas/video 在开发者工具渲染失败

**A**: 这些原生组件在 Skyline 模式下暂不支持开发者工具调试，请使用真机预览。

---

### Q: 热重载无响应

**A**: Skyline 模式暂不支持热重载。

**临时方案**：关闭热重载，使用重新编译预览。

## 兼容性速查表

| WebView 特性 | Skyline 支持 | 替代方案 |
|--------------|--------------|----------|
| 原生导航栏 | ❌ | 自定义导航栏 |
| 全局滚动 | ❌ | scroll-view |
| display: inline | ❌ | flex / span 组件 |
| display: grid | ❌ | grid-view 组件 |
| position: sticky | ❌ | sticky-header 组件 |
| overflow: scroll | ❌ | scroll-view |
| text-overflow (非 text) | ❌ | 用 text 组件 |
| Page.onPageScroll | ❌ | scroll-view 滚动事件 |
| animate 接口 | ❌ | worklet 动画 |
| web-view 组件 | ❌ | 该页面用 WebView 渲染 |
