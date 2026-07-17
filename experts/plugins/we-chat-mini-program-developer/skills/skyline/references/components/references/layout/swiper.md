# swiper 组件增强特性

## 概述

Skyline 下的 `swiper` 组件在保持与 WebView 兼容的基础上，新增了多种布局模式（layout-type）、过渡动画（transformer-type）和指示器动画（indicator-type）等增强特性。

## 基本用法

```html
<swiper 
  indicator-dots
  autoplay
  circular
  style="height: 200px;"
>
  <swiper-item wx:for="{{banners}}" wx:key="id">
    <image src="{{item.image}}" mode="aspectFill" />
  </swiper-item>
</swiper>
```

## 通用属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| indicator-dots | boolean | false | 显示指示点 |
| indicator-color | color | rgba(0,0,0,0.3) | 指示点颜色 |
| indicator-active-color | color | #000 | 当前指示点颜色 |
| autoplay | boolean | false | 自动播放 |
| current | number | 0 | 当前滑块索引 |
| interval | number | 5000 | 自动播放间隔(ms) |
| duration | number | 500 | 滑动动画时长(ms) |
| circular | boolean | false | 循环滑动 |
| vertical | boolean | false | 纵向滑动 |
| display-multiple-items | number | 1 | 同时显示滑块数 |
| previous-margin | string | "0px" | 前边距 |
| next-margin | string | "0px" | 后边距 |
| easing-function | string | "default" | 缓动函数 |

## Skyline 特有属性

### layout-type 布局类型

| 值 | 效果 | 说明 |
|----|------|------|
| normal | 默认 | 标准轮播 |
| stackLeft | 左向堆叠 | 卡片向左堆叠效果 |
| stackRight | 右向堆叠 | 卡片向右堆叠效果 |
| tinder | 滑动卡片 | 类似 Tinder App 的卡片效果 |
| transformer | 过渡动画 | 配合 transformer-type 使用 |

### transformer-type 过渡动画

当 `layout-type="transformer"` 时生效：

| 值 | 效果 |
|----|------|
| scaleAndFade | 缩放淡入淡出 |
| accordion | 手风琴效果 |
| threeD | 3D 翻转 |
| zoomIn | 放大进入 |
| zoomOut | 缩小退出 |
| deepthPage | 深度页面 |

### indicator-type 指示器动画

| 值 | 效果 |
|----|------|
| normal | 默认圆点 |
| worm | 蠕虫动画 |
| wormThin | 细蠕虫 |
| wormUnderground | 下沉蠕虫 |
| wormThinUnderground | 细下沉蠕虫 |
| expand | 展开动画 |
| jump | 跳跃动画 |
| jumpWithOffset | 偏移跳跃 |
| scroll | 滚动指示器 |
| scrollFixedCenter | 固定中心滚动 |
| slide | 滑动动画 |
| slideUnderground | 下沉滑动 |
| scale | 缩放动画 |
| swap | 交换动画 |
| swapYRotation | Y轴旋转交换 |
| color | 颜色渐变 |

### 指示器样式属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| indicator-margin | number | 10 | 指示点四周边距 |
| indicator-spacing | number | 4 | 指示点间距 |
| indicator-radius | number | 4 | 指示点圆角 |
| indicator-width | number | 8 | 指示点宽度 |
| indicator-height | number | 8 | 指示点高度 |
| indicator-alignment | Array/string | auto | 指示点位置 |
| indicator-offset | Array | [0,0] | 指示点偏移 |

### indicator-alignment

- `auto`: 横向滑动时居底中，纵向滑动时居中右
- 数组: `[x, y]`，取值范围 [-1, 1]，如 `[0, 1]` 表示底边中点

### 其他 Skyline 属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| scroll-with-animation | boolean | true | 改变 current 时使用动画 |
| cache-extent | number | 0 | 预渲染区域（1=上下各一屏） |

## Worklet 回调

```html
<swiper
  worklet:onscrollstart="onScrollStart"
  worklet:onscrollupdate="onScrollUpdate"
  worklet:onscrollend="onScrollEnd"
>
```

```javascript
Page({
  onScrollStart(e) {
    'worklet'
    console.log('开始滑动', e.detail.dx, e.detail.dy)
  },
  
  onScrollUpdate(e) {
    'worklet'
    // 可用于同步动画
    const { dx, dy } = e.detail
  },
  
  onScrollEnd(e) {
    'worklet'
    console.log('滑动结束', e.detail.dx, e.detail.dy)
  }
})
```

## 示例代码

### 堆叠效果

```html
<swiper
  layout-type="stackLeft"
  style="height: 300px;"
>
  <swiper-item wx:for="{{cards}}" wx:key="id">
    <view class="card" style="background: {{item.color}}">
      {{item.title}}
    </view>
  </swiper-item>
</swiper>
```

### Tinder 卡片效果

```html
<swiper
  layout-type="tinder"
  style="height: 400px;"
  bindchange="onCardChange"
>
  <swiper-item wx:for="{{users}}" wx:key="id">
    <view class="user-card">
      <image src="{{item.avatar}}" mode="aspectFill" />
      <text>{{item.name}}, {{item.age}}</text>
    </view>
  </swiper-item>
</swiper>
```

### 3D 过渡效果

```html
<swiper
  layout-type="transformer"
  transformer-type="threeD"
  style="height: 200px;"
>
  <swiper-item wx:for="{{banners}}" wx:key="id">
    <image src="{{item.image}}" mode="aspectFill" />
  </swiper-item>
</swiper>
```

### 蠕虫指示器

```html
<swiper
  indicator-dots
  indicator-type="worm"
  indicator-color="rgba(255,255,255,0.5)"
  indicator-active-color="#fff"
  style="height: 200px;"
>
  <swiper-item wx:for="{{banners}}" wx:key="id">
    <image src="{{item.image}}" mode="aspectFill" />
  </swiper-item>
</swiper>
```

### 自定义指示器位置

```html
<swiper
  indicator-dots
  indicator-type="expand"
  indicator-alignment="{{[0, 0.9]}}"
  indicator-offset="{{[0, -20]}}"
  indicator-width="6"
  indicator-height="6"
  indicator-spacing="6"
>
  <!-- ... -->
</swiper>
```

### 缓存预加载

```html
<!-- 预渲染相邻一屏区域 -->
<swiper cache-extent="1">
  <swiper-item wx:for="{{heavyItems}}" wx:key="id">
    <!-- 复杂内容 -->
  </swiper-item>
</swiper>
```

## 注意事项

1. `layout-type` 为 `stackLeft`、`stackRight` 和 `tinder` 时仅支持 `indicator-type=normal`
2. `indicator-type` 为 `scrollFixedCenter`、`swap`、`swapYRotation` 时不支持循环模式 `circular`
3. Skyline 的 `previous-margin`、`display-multiple-items` 和 `vertical` 与 WebView 表现略有不同
4. 当 `next-margin > 0` 时，Skyline 会将上述属性对齐 WebView 实现

## change 事件 source 字段

| 值 | 说明 |
|----|------|
| autoplay | 自动播放导致变化 |
| touch | 用户滑动导致变化 |
| "" | 其他原因 |

```javascript
Page({
  onSwiperChange(e) {
    const { current, source } = e.detail
    // 避免在 autoplay 时重复设置
    if (source === 'touch') {
      this.setData({ current })
    }
  }
})
```

## 完整示例：图片轮播

```html
<view class="banner-container">
  <swiper
    class="banner"
    indicator-dots
    indicator-type="worm"
    indicator-color="rgba(255,255,255,0.5)"
    indicator-active-color="#fff"
    autoplay
    circular
    interval="{{4000}}"
    duration="{{500}}"
  >
    <swiper-item wx:for="{{banners}}" wx:key="id">
      <image 
        class="banner-image"
        src="{{item.image}}" 
        mode="aspectFill"
        bindtap="onBannerTap"
        data-url="{{item.url}}"
      />
    </swiper-item>
  </swiper>
</view>
```

```css
.banner-container {
  width: 100%;
  padding: 12px;
  box-sizing: border-box;
}

.banner {
  height: 150px;
  border-radius: 8px;
  overflow: hidden;
}

.banner-image {
  width: 100%;
  height: 100%;
}
```

## 示例代码片段

增强特性演示：{% minicode('2XhTe3m67uTb') %}
基础示例：{% minicode('mI88kSm57nJ9') %}
