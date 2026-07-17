# 吸顶布局：sticky-section 与 sticky-header

## 概述

`sticky-section` 和 `sticky-header` 是 Skyline 新增的吸顶布局组件，用于实现分组列表的吸顶效果。它们必须在 `<scroll-view type="custom">` 模式下使用。

## 组件说明

### sticky-section

吸顶区段容器，包含一个 `sticky-header` 和列表内容。

### sticky-header

吸顶头部组件，当滚动到该区段时会固定在顶部。

## 基本结构

```html
<scroll-view type="custom" scroll-y>
  <sticky-section>
    <sticky-header>区段 1 标题</sticky-header>
    <view>区段 1 内容</view>
  </sticky-section>
  
  <sticky-section>
    <sticky-header>区段 2 标题</sticky-header>
    <view>区段 2 内容</view>
  </sticky-section>
</scroll-view>
```

## 典型应用：通讯录

```html
<scroll-view type="custom" scroll-y style="height: 100vh;">
  <sticky-section wx:for="{{contacts}}" wx:key="letter">
    <sticky-header class="letter-header">
      {{item.letter}}
    </sticky-header>
    <list-view>
      <view 
        wx:for="{{item.list}}" 
        wx:for-item="contact" 
        wx:key="id"
        class="contact-item"
      >
        <image class="avatar" src="{{contact.avatar}}" />
        <text>{{contact.name}}</text>
      </view>
    </list-view>
  </sticky-section>
</scroll-view>
```

```javascript
Page({
  data: {
    contacts: [
      {
        letter: 'A',
        list: [
          { id: 1, name: 'Alice', avatar: '...' },
          { id: 2, name: 'Amy', avatar: '...' }
        ]
      },
      {
        letter: 'B',
        list: [
          { id: 3, name: 'Bob', avatar: '...' },
          { id: 4, name: 'Bill', avatar: '...' }
        ]
      }
      // ...
    ]
  }
})
```

```css
.letter-header {
  height: 32px;
  line-height: 32px;
  padding: 0 16px;
  background: #f5f5f5;
  font-size: 14px;
  color: #999;
  font-weight: bold;
}

.contact-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.avatar {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  margin-right: 12px;
}
```

## 商品分类列表

```html
<scroll-view type="custom" scroll-y>
  <sticky-section wx:for="{{categories}}" wx:key="id">
    <sticky-header class="category-header">
      <image class="category-icon" src="{{item.icon}}" />
      <text>{{item.name}}</text>
    </sticky-header>
    <grid-view type="aligned" cross-axis-count="3" cross-axis-gap="8" main-axis-gap="8">
      <view 
        wx:for="{{item.products}}" 
        wx:for-item="product"
        wx:key="id"
        class="product-card"
      >
        <image src="{{product.cover}}" mode="aspectFill" />
        <text class="name">{{product.name}}</text>
        <text class="price">¥{{product.price}}</text>
      </view>
    </grid-view>
  </sticky-section>
</scroll-view>
```

## 属性说明

### sticky-section

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| push-pinned-header | boolean | true | 是否推动之前吸顶的头部 |

### sticky-header

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| padding | Array | [0,0,0,0] | 内边距 |

## 使用规则

### MUST（必须遵守）

1. 必须在 `type="custom"` 的 scroll-view 中使用
2. sticky-header 必须是 sticky-section 的第一个子元素
3. 每个 sticky-section 只能有一个 sticky-header

### NEVER（禁止行为）

1. 不要在 `type="list"` 的 scroll-view 中使用
2. 不要将 sticky-header 放在 sticky-section 之外

## 配合 list-view 使用

```html
<scroll-view type="custom" scroll-y>
  <sticky-section>
    <sticky-header>今日推荐</sticky-header>
    <list-view padding="{{[12, 16, 12, 16]}}">
      <view wx:for="{{todayList}}" wx:key="id" class="item">
        {{item.title}}
      </view>
    </list-view>
  </sticky-section>
  
  <sticky-section>
    <sticky-header>历史记录</sticky-header>
    <list-view padding="{{[12, 16, 12, 16]}}">
      <view wx:for="{{historyList}}" wx:key="id" class="item">
        {{item.title}}
      </view>
    </list-view>
  </sticky-section>
</scroll-view>
```

## 与 WebView position: sticky 的区别

| 特性 | WebView sticky | Skyline sticky-header |
|------|----------------|----------------------|
| 实现方式 | CSS 属性 | 组件 |
| 推动效果 | 需要 JS 处理 | 内置支持 |
| 性能 | 可能有闪烁 | 原生流畅 |
| 使用场景 | 任意元素 | 仅限 custom 模式 |

## 样式建议

### 吸顶头部样式

```css
sticky-header {
  /* 背景必须设置，否则会透出下层内容 */
  background: #fff;
  
  /* 可添加阴影增强层次感 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  
  /* 设置较高 z-index 确保在上层 */
  z-index: 10;
}
```

### 区段间距

```css
sticky-section {
  margin-bottom: 12px;
}

sticky-section:last-child {
  margin-bottom: 0;
}
```

## 完整示例：外卖菜单

```html
<view class="container">
  <!-- 左侧分类导航 -->
  <scroll-view class="category-nav" scroll-y>
    <view 
      wx:for="{{categories}}" 
      wx:key="id"
      class="nav-item {{currentCategory === index ? 'active' : ''}}"
      bindtap="scrollToCategory"
      data-index="{{index}}"
    >
      {{item.name}}
    </view>
  </scroll-view>
  
  <!-- 右侧商品列表 -->
  <scroll-view 
    class="product-list"
    type="custom" 
    scroll-y
    scroll-into-view="{{scrollToId}}"
    bindscroll="onScroll"
  >
    <sticky-section 
      wx:for="{{categories}}" 
      wx:key="id"
      id="category-{{index}}"
    >
      <sticky-header class="category-title">
        {{item.name}}
      </sticky-header>
      <list-view>
        <view 
          wx:for="{{item.products}}" 
          wx:for-item="product"
          wx:key="id"
          class="product-item"
        >
          <image class="product-image" src="{{product.image}}" />
          <view class="product-info">
            <text class="product-name">{{product.name}}</text>
            <text class="product-price">¥{{product.price}}</text>
          </view>
        </view>
      </list-view>
    </sticky-section>
  </scroll-view>
</view>
```

```css
.container {
  display: flex;
  height: 100vh;
}

.category-nav {
  width: 80px;
  background: #f5f5f5;
}

.nav-item {
  padding: 12px 8px;
  text-align: center;
  font-size: 12px;
}

.nav-item.active {
  background: #fff;
  color: #07c160;
}

.product-list {
  flex: 1;
}

.category-title {
  padding: 8px 12px;
  background: #f9f9f9;
  font-size: 14px;
  font-weight: bold;
}

.product-item {
  display: flex;
  padding: 12px;
  border-bottom: 1px solid #eee;
}

.product-image {
  width: 80px;
  height: 80px;
  border-radius: 4px;
  margin-right: 12px;
}

.product-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.product-name {
  font-size: 14px;
  color: #333;
}

.product-price {
  font-size: 16px;
  color: #f5222d;
  font-weight: bold;
}
```
