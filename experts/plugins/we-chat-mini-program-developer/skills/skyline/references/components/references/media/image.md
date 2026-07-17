# image 组件

## 概述

Skyline 下的 `image` 组件默认懒加载，并新增了 `fade-in` 渐显效果属性。部分 WebView 的裁剪模式在 Skyline 下不支持。

## 基本用法

```html
<image 
  src="https://example.com/image.jpg"
  mode="aspectFill"
  bindload="onImageLoad"
  binderror="onImageError"
/>
```

## 通用属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| src | string | - | 图片地址（支持云文件ID） |
| mode | string | scaleToFill | 裁剪/缩放模式 |
| show-menu-by-longpress | boolean | false | 长按显示菜单 |
| binderror | event | - | 加载失败回调 |
| bindload | event | - | 加载完成回调 |

## mode 属性

### 通用缩放模式

| 值 | 说明 | Skyline | WebView |
|----|------|---------|---------|
| scaleToFill | 拉伸填满（不保持比例） | ✅ | ✅ |
| aspectFit | 保持比例，完全显示（可能有留白） | ✅ | ✅ |
| aspectFill | 保持比例，填满（可能被裁剪） | ✅ | ✅ |
| widthFix | 宽度不变，高度自动 | ✅ | ✅ |
| heightFix | 高度不变，宽度自动 | ✅ | ✅ |

### WebView-only 裁剪模式

以下模式**仅在 WebView 下支持**，Skyline 不支持：

| 值 | 说明 |
|----|------|
| top | 只显示顶部 |
| bottom | 只显示底部 |
| center | 只显示中间 |
| left | 只显示左边 |
| right | 只显示右边 |
| top left | 只显示左上 |
| top right | 只显示右上 |
| bottom left | 只显示左下 |
| bottom right | 只显示右下 |

## Skyline 特有属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| fade-in | boolean | false | 图片加载完成后渐显 |

### 渐显效果

```html
<image 
  src="{{imageUrl}}"
  mode="aspectFill"
  fade-in
/>
```

**使用场景**：
- 图片列表加载
- 大图展示
- 提升视觉体验

## WebView 特有属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| webp | boolean | false | 解析 webP 格式（仅网络图片） |
| lazy-load | boolean | false | 懒加载（进入三屏内才加载） |
| forceHttps | boolean | false | 自动将 http 替换为 https |

> 注意：Skyline 下默认懒加载，无需设置 lazy-load

## 事件回调

### 加载完成

```javascript
Page({
  onImageLoad(e) {
    const { width, height } = e.detail
    console.log(`图片尺寸: ${width} x ${height}`)
  }
})
```

### 加载失败

```javascript
Page({
  onImageError(e) {
    console.log('图片加载失败:', e.detail.errMsg)
    // 可设置默认图片
    this.setData({ imageUrl: '/images/default.png' })
  }
})
```

## 长按菜单

```html
<image 
  src="{{imageUrl}}"
  show-menu-by-longpress
/>
```

支持的菜单选项：
- 发送给朋友
- 收藏
- 保存图片
- 搜一搜
- 打开名片/前往群聊/打开小程序（若图片包含对应二维码）

### 支持识别的码

| 类型 | 最低版本 |
|------|----------|
| 小程序码 | - |
| 微信个人码 | 2.18.0 |
| 企业微信个人码 | 2.18.0 |
| 普通群码 | 2.18.0 |
| 互通群码 | 2.18.0 |
| 公众号二维码 | 2.18.0 |

## 示例代码

### 头像显示

```html
<image 
  class="avatar"
  src="{{user.avatar}}"
  mode="aspectFill"
  binderror="onAvatarError"
/>
```

```css
.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #f5f5f5;
}
```

### 图片列表

```html
<view class="image-list">
  <image 
    wx:for="{{images}}" 
    wx:key="id"
    class="image-item"
    src="{{item.url}}"
    mode="aspectFill"
    fade-in
    bindtap="previewImage"
    data-index="{{index}}"
  />
</view>
```

```javascript
Page({
  previewImage(e) {
    const { index } = e.currentTarget.dataset
    wx.previewImage({
      current: this.data.images[index].url,
      urls: this.data.images.map(img => img.url)
    })
  }
})
```

### 自适应高度

```html
<!-- widthFix: 宽度固定，高度自适应 -->
<image 
  class="banner"
  src="{{bannerUrl}}"
  mode="widthFix"
  style="width: 100%;"
/>

<!-- heightFix: 高度固定，宽度自适应 -->
<image 
  class="icon"
  src="{{iconUrl}}"
  mode="heightFix"
  style="height: 24px;"
/>
```

### 带占位符的图片

```html
<view class="image-wrapper">
  <image 
    wx:if="{{imageLoaded}}"
    src="{{imageUrl}}"
    mode="aspectFill"
    fade-in
    bindload="onImageLoad"
  />
  <view wx:else class="placeholder">
    <text class="loading-text">加载中...</text>
  </view>
</view>
```

```javascript
Page({
  data: {
    imageLoaded: false,
    imageUrl: 'https://example.com/image.jpg'
  },
  
  onImageLoad() {
    this.setData({ imageLoaded: true })
  }
})
```

### 错误处理

```html
<image 
  src="{{imageUrl || defaultImage}}"
  mode="aspectFill"
  binderror="onImageError"
/>
```

```javascript
Page({
  data: {
    imageUrl: '',
    defaultImage: '/images/default.png'
  },
  
  onImageError() {
    this.setData({ imageUrl: '' })
  }
})
```

## SVG 支持

### 注意事项

1. SVG 格式使用 `mode="scaleToFill"` 时：
   - WebView：会居中显示（除非 SVG 添加 `preserveAspectRatio="none"`）
   - Skyline：会撑满容器

2. SVG 格式不支持：
   - 百分比单位
   - `<style>` 元素

## 性能优化

### 1. 使用合适的 mode

```html
<!-- 列表缩略图：使用 aspectFill 避免变形 -->
<image src="{{item.cover}}" mode="aspectFill" />

<!-- Banner：使用 widthFix 保持比例 -->
<image src="{{banner}}" mode="widthFix" style="width: 100%;" />
```

### 2. 利用默认懒加载

Skyline 下图片默认懒加载，无需额外配置。

### 3. 使用渐显效果

```html
<!-- 大图建议使用 fade-in 改善体验 -->
<image src="{{largeImage}}" mode="aspectFill" fade-in />
```

### 4. 图片尺寸优化

使用 CDN 时指定合适的尺寸：

```javascript
// 根据设备像素比获取合适尺寸
const ratio = wx.getSystemInfoSync().pixelRatio
const imageUrl = `${baseUrl}?width=${300 * ratio}`
```

## 注意事项

1. **默认尺寸**：image 组件默认宽度 320px、高度 240px
2. **小数精度**：缩放后的宽高可能有小数，不同内核渲染可能会抹去小数
3. **Skyline 懒加载**：Skyline 默认懒加载，WebView 需要手动设置 lazy-load
4. **裁剪模式兼容**：需要 WebView 裁剪模式时，应判断渲染引擎做兼容处理

## 示例代码片段

{% minicode('NwPpTRmS7AJf') %}
