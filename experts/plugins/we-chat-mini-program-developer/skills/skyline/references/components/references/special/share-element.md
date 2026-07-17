# share-element 共享元素动画

## 概述

`share-element` 是用于实现页面间共享元素动画的组件，类似于 Flutter 的 Hero 动画。元素看起来像是在页面间"穿越"，可以创造流畅的过渡体验。

## 使用场景

- 图片详情页转场
- 商品详情页转场
- 卡片展开效果
- 任意需要元素连续性动画的场景

## 基本原理

1. 在源页面放置 `share-element`，设置唯一的 `key`
2. 在目标页面放置相同 `key` 的 `share-element`
3. 页面跳转时，元素会从源位置动画过渡到目标位置

## 基本用法

### 源页面

```html
<!-- pages/list/index.wxml -->
<view class="card" bindtap="goDetail" data-id="{{item.id}}">
  <share-element key="image-{{item.id}}" transform>
    <image src="{{item.cover}}" mode="aspectFill" />
  </share-element>
  <text>{{item.title}}</text>
</view>
```

```javascript
// pages/list/index.js
Page({
  goDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/detail/index?id=${id}`
    })
  }
})
```

### 目标页面

```html
<!-- pages/detail/index.wxml -->
<share-element key="image-{{detail.id}}" transform>
  <image class="detail-image" src="{{detail.cover}}" mode="aspectFill" />
</share-element>
<view class="content">
  <text class="title">{{detail.title}}</text>
  <text class="desc">{{detail.desc}}</text>
</view>
```

## 通用属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| key | string | - | **必填**，页面内唯一标识 |
| transform | boolean | false | 是否启用动画 |
| duration | number | 300 | 动画时长（ms） |
| easing-function | string | ease-out | CSS 缓动函数 |

## Skyline 特有属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| transition-on-gesture | boolean | false | 手势返回时是否动画 |
| shuttle-on-push | string | to | push 阶段飞跃物 |
| shuttle-on-pop | string | to | pop 阶段飞跃物 |
| rect-tween-type | string | materialRectArc | 动画轨迹类型 |
| worklet:onframe | callback | - | 动画帧回调 |

### shuttle-on-push / shuttle-on-pop

| 值 | 说明 |
|----|------|
| from | 使用源页面节点作为飞跃物 |
| to | 使用目标页面节点作为飞跃物 |

### rect-tween-type 动画轨迹

| 值 | 效果 |
|----|------|
| materialRectArc | 矩形对角动画（默认） |
| materialRectCenterArc | 径向动画 |
| linear | 线性动画 |
| elasticIn | 弹性进入 |
| elasticOut | 弹性退出 |
| elasticInOut | 弹性进出 |
| bounceIn | 弹跳进入 |
| bounceOut | 弹跳退出 |
| bounceInOut | 弹跳进出 |
| cubic-bezier(x1,y1,x2,y2) | 自定义贝塞尔曲线 |

## 手势返回动画

开启 `transition-on-gesture` 后，用户侧滑返回时也会触发共享元素动画：

```html
<share-element 
  key="hero-image" 
  transform 
  transition-on-gesture
>
  <image src="{{imageUrl}}" />
</share-element>
```

## Worklet 动画帧回调

使用 `worklet:onframe` 可以在动画过程中同步其他动画：

```html
<share-element 
  key="card" 
  transform 
  worklet:onframe="onShareElementFrame"
>
  <view class="card">...</view>
</share-element>
<view class="backdrop" style="opacity: {{backdropOpacity}};"></view>
```

```javascript
Page({
  data: {
    backdropOpacity: 0
  },
  
  onShareElementFrame(e) {
    'worklet'
    // e.progress: 动画进度 0-1
    // 可用于同步其他元素的动画
  }
})
```

## 配合 page-container 使用

在同一页面内使用 `page-container` 实现模态转场：

```html
<view class="page">
  <view 
    wx:for="{{items}}" 
    wx:key="id"
    class="card"
    bindtap="showDetail"
    data-index="{{index}}"
  >
    <share-element key="item-{{item.id}}" transform="{{currentId === item.id}}">
      <image src="{{item.cover}}" />
    </share-element>
    <text>{{item.title}}</text>
  </view>
</view>

<page-container 
  show="{{showContainer}}" 
  overlay
  duration="{{300}}"
  bindbeforeenter="onBeforeEnter"
  bindafterleave="onAfterLeave"
>
  <view class="detail">
    <share-element key="item-{{detail.id}}" transform>
      <image class="detail-image" src="{{detail.cover}}" />
    </share-element>
    <view class="detail-content">
      <text class="title">{{detail.title}}</text>
      <text class="desc">{{detail.desc}}</text>
    </view>
  </view>
</page-container>
```

```javascript
Page({
  data: {
    items: [],
    detail: null,
    currentId: null,
    showContainer: false
  },
  
  showDetail(e) {
    const { index } = e.currentTarget.dataset
    const item = this.data.items[index]
    this.setData({
      detail: item,
      currentId: item.id,
      showContainer: true
    })
  },
  
  onBeforeEnter() {
    // 容器进入前
  },
  
  onAfterLeave() {
    this.setData({ currentId: null })
  }
})
```

## 完整示例：图片详情

### 列表页

```html
<!-- pages/gallery/index.wxml -->
<view class="gallery">
  <view 
    wx:for="{{images}}" 
    wx:key="id"
    class="gallery-item"
    bindtap="goDetail"
    data-item="{{item}}"
  >
    <share-element key="gallery-{{item.id}}" transform>
      <image 
        class="thumb"
        src="{{item.thumb}}" 
        mode="aspectFill"
      />
    </share-element>
  </view>
</view>
```

```javascript
// pages/gallery/index.js
Page({
  data: {
    images: [
      { id: 1, thumb: '...', full: '...', title: '图片1' },
      { id: 2, thumb: '...', full: '...', title: '图片2' },
      // ...
    ]
  },
  
  goDetail(e) {
    const { item } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/gallery/detail?id=${item.id}`
    })
  }
})
```

### 详情页

```html
<!-- pages/gallery/detail.wxml -->
<view class="detail-page">
  <share-element 
    key="gallery-{{image.id}}" 
    transform 
    transition-on-gesture
    rect-tween-type="materialRectCenterArc"
  >
    <image 
      class="full-image"
      src="{{image.full}}" 
      mode="widthFix"
      bindtap="toggleInfo"
    />
  </share-element>
  
  <view class="info-panel {{showInfo ? 'show' : ''}}">
    <text class="title">{{image.title}}</text>
    <text class="desc">{{image.desc}}</text>
  </view>
</view>
```

```css
/* pages/gallery/detail.wxss */
.detail-page {
  position: relative;
  min-height: 100vh;
  background: #000;
}

.full-image {
  width: 100%;
}

.info-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 20px;
  background: rgba(0, 0, 0, 0.7);
  transform: translateY(100%);
  transition: transform 0.3s ease;
}

.info-panel.show {
  transform: translateY(0);
}

.title {
  display: block;
  font-size: 18px;
  color: #fff;
  font-weight: bold;
}

.desc {
  display: block;
  margin-top: 8px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
}
```

```javascript
// pages/gallery/detail.js
Page({
  data: {
    image: null,
    showInfo: false
  },
  
  onLoad(options) {
    const { id } = options
    // 获取图片详情
    this.loadImage(id)
  },
  
  loadImage(id) {
    // 模拟加载
    const image = {
      id: parseInt(id),
      thumb: '...',
      full: '...',
      title: '风景照片',
      desc: '拍摄于 2024 年春天'
    }
    this.setData({ image })
  },
  
  toggleInfo() {
    this.setData({ showInfo: !this.data.showInfo })
  }
})
```

## 注意事项

1. **key 必须匹配**：源页面和目标页面的 share-element 必须有相同的 key
2. **transform 属性**：两边都需要设置 `transform` 才会触发动画
3. **内容变化**：如果源和目标的内容不同，动画会在两者间过渡
4. **性能考虑**：共享元素内容不宜过于复杂

## Skyline vs WebView

| 特性 | Skyline | WebView |
|------|---------|---------|
| 基础动画 | ✅ | ✅ |
| 手势返回动画 | ✅ | ❌ |
| worklet 帧回调 | ✅ | ❌ |
| 飞跃物选择 | ✅ | ❌ |
| 动画轨迹类型 | 丰富 | 有限 |

## 示例代码片段

Skyline：{% minicode('t584gymu7VMM') %}
WebView：{% minicode('NqVP7ImA73ou') %}
