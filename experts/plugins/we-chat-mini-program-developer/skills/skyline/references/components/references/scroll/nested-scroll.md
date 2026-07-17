# 嵌套滚动模式

## 概述

在 Skyline 渲染模式下，当存在两个 scroll-view 相互嵌套的场景时（如 Tab 列表页），两者的滚动不能很丝滑地衔接。使用嵌套模式（`type="nested"`）可以让父子 scroll-view 的滚动无缝联动。

## 基本结构

```html
<!-- 外层 scroll-view -->
<scroll-view type="nested" scroll-y>
  <nested-scroll-header>
    <view>头部区域（会被滚动走）</view>
  </nested-scroll-header>
  <nested-scroll-body>
    <!-- 内层可滚动区域 -->
  </nested-scroll-body>
</scroll-view>
```

## 组件说明

### nested-scroll-header

头部区域组件，会随着外层 scroll-view 滚动而滚走。

- 只能渲染在 `nested-scroll-body` 上面
- 只能有一个子节点
- 可以有多个 `nested-scroll-header`

### nested-scroll-body

主体区域组件，包含内层可滚动内容。

- 外层 scroll-view 只能有一个 `nested-scroll-body`
- 只能有一个子节点

## 典型应用：Tab + 列表

```html
<scroll-view type="nested" scroll-y style="height: 100vh;">
  <!-- 头部：Banner + Tab -->
  <nested-scroll-header>
    <view class="banner">
      <image src="banner.jpg" />
    </view>
  </nested-scroll-header>
  <nested-scroll-header>
    <view class="tabs">
      <view 
        wx:for="{{tabs}}" 
        wx:key="id"
        class="tab {{currentTab === index ? 'active' : ''}}"
        bindtap="switchTab"
        data-index="{{index}}"
      >
        {{item.name}}
      </view>
    </view>
  </nested-scroll-header>
  
  <!-- 主体：Tab 内容 -->
  <nested-scroll-body>
    <swiper 
      current="{{currentTab}}" 
      bindchange="onSwiperChange"
      style="height: 100%;"
    >
      <swiper-item wx:for="{{tabs}}" wx:key="id">
        <!-- 内层列表必须关联外层嵌套滚动 -->
        <scroll-view 
          type="list" 
          scroll-y
          associative-container="nested-scroll-view"
          style="height: 100%;"
        >
          <view wx:for="{{item.list}}" wx:key="id" wx:for-item="listItem">
            {{listItem.name}}
          </view>
        </scroll-view>
      </swiper-item>
    </swiper>
  </nested-scroll-body>
</scroll-view>
```

```javascript
Page({
  data: {
    currentTab: 0,
    tabs: [
      { id: 1, name: '推荐', list: [] },
      { id: 2, name: '热门', list: [] },
      { id: 3, name: '最新', list: [] }
    ]
  },
  
  switchTab(e) {
    this.setData({ currentTab: e.currentTarget.dataset.index })
  },
  
  onSwiperChange(e) {
    this.setData({ currentTab: e.detail.current })
  }
})
```

## 滚动策略

嵌套滚动的联动策略：

| 滚动方向 | 策略 |
|----------|------|
| 向下滚动 | 先滚动外层 scroll-view，再滚动内层 scroll-view |
| 向上滚动 | 先滚动内层 scroll-view，再滚动外层 scroll-view |

这种策略确保了：
- 下滑时先看到完整头部消失
- 上滑时先让列表滚到顶部，再显示头部

## 配合下拉刷新

```html
<scroll-view 
  type="nested" 
  scroll-y
  refresher-enabled="{{true}}"
  refresher-triggered="{{refreshing}}"
  bindrefresherrefresh="onRefresh"
>
  <view slot="refresher">自定义 refresher</view>
  
  <nested-scroll-header>
    <view>头部</view>
  </nested-scroll-header>
  
  <nested-scroll-body>
    <scroll-view 
      type="list" 
      scroll-y
      associative-container="nested-scroll-view"
    >
      <!-- 列表内容 -->
    </scroll-view>
  </nested-scroll-body>
</scroll-view>
```

注意：下拉刷新的 `slot="refresher"` 与 `nested-scroll-header`、`nested-scroll-body` 是平级的。

## 使用规则

### MUST（必须遵守）

1. 外层 scroll-view 必须设置 `type="nested"`
2. 内层 scroll-view 必须设置 `associative-container="nested-scroll-view"`
3. `nested-scroll-header` 和 `nested-scroll-body` 只能有一个子节点
4. 外层只能有一个 `nested-scroll-body`

### NEVER（禁止行为）

1. 不要在 `nested-scroll-body` 下面放 `nested-scroll-header`
2. 不要有多个 `nested-scroll-body`
3. 不要忘记给内层 scroll-view 设置 `associative-container`

## 完整示例

```html
<!-- index.wxml -->
<scroll-view 
  class="container"
  type="nested" 
  scroll-y
  refresher-enabled="{{true}}"
  refresher-triggered="{{refreshing}}"
  bindrefresherrefresh="onRefresh"
>
  <view slot="refresher" class="refresher">
    <view class="loading">{{refreshing ? '刷新中...' : '下拉刷新'}}</view>
  </view>
  
  <nested-scroll-header>
    <view class="header">
      <image class="banner" src="/images/banner.jpg" mode="aspectFill" />
    </view>
  </nested-scroll-header>
  
  <nested-scroll-header>
    <view class="tab-bar">
      <view 
        wx:for="{{tabs}}" 
        wx:key="id"
        class="tab-item {{currentTab === index ? 'active' : ''}}"
        bindtap="onTabTap"
        data-index="{{index}}"
      >
        {{item.title}}
      </view>
    </view>
  </nested-scroll-header>
  
  <nested-scroll-body>
    <swiper 
      class="tab-content"
      current="{{currentTab}}"
      bindchange="onSwiperChange"
    >
      <swiper-item wx:for="{{tabs}}" wx:key="id">
        <scroll-view 
          class="list-scroll"
          type="list" 
          scroll-y
          associative-container="nested-scroll-view"
          bindscrolltolower="onLoadMore"
          data-tab="{{index}}"
        >
          <view 
            wx:for="{{item.list}}" 
            wx:key="id" 
            wx:for-item="card"
            class="card"
          >
            <image class="card-cover" src="{{card.cover}}" />
            <text class="card-title">{{card.title}}</text>
          </view>
          <view wx:if="{{item.loading}}" class="loading-more">
            加载中...
          </view>
        </scroll-view>
      </swiper-item>
    </swiper>
  </nested-scroll-body>
</scroll-view>
```

```css
/* index.wxss */
.container {
  height: 100vh;
}

.banner {
  width: 100%;
  height: 200px;
}

.tab-bar {
  display: flex;
  background: #fff;
  position: sticky;
  top: 0;
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 12px 0;
  font-size: 14px;
}

.tab-item.active {
  color: #07c160;
  border-bottom: 2px solid #07c160;
}

.tab-content {
  height: calc(100vh - 44px); /* 减去 tab-bar 高度 */
}

.list-scroll {
  height: 100%;
}

.card {
  padding: 12px;
  border-bottom: 1px solid #eee;
}
```

```javascript
// index.js
Page({
  data: {
    refreshing: false,
    currentTab: 0,
    tabs: [
      { id: 1, title: '推荐', list: [], loading: false },
      { id: 2, title: '关注', list: [], loading: false },
      { id: 3, title: '热榜', list: [], loading: false }
    ]
  },
  
  onLoad() {
    this.loadData(0)
  },
  
  onRefresh() {
    this.setData({ refreshing: true })
    this.loadData(this.data.currentTab).then(() => {
      this.setData({ refreshing: false })
    })
  },
  
  onTabTap(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ currentTab: index })
    if (!this.data.tabs[index].list.length) {
      this.loadData(index)
    }
  },
  
  onSwiperChange(e) {
    const index = e.detail.current
    this.setData({ currentTab: index })
    if (!this.data.tabs[index].list.length) {
      this.loadData(index)
    }
  },
  
  onLoadMore(e) {
    const tabIndex = e.currentTarget.dataset.tab
    this.loadMore(tabIndex)
  },
  
  async loadData(tabIndex) {
    // 模拟加载数据
    const list = await this.fetchList(tabIndex, 0)
    this.setData({
      [`tabs[${tabIndex}].list`]: list
    })
  },
  
  async loadMore(tabIndex) {
    const tab = this.data.tabs[tabIndex]
    if (tab.loading) return
    
    this.setData({ [`tabs[${tabIndex}].loading`]: true })
    
    const newList = await this.fetchList(tabIndex, tab.list.length)
    this.setData({
      [`tabs[${tabIndex}].list`]: [...tab.list, ...newList],
      [`tabs[${tabIndex}].loading`]: false
    })
  },
  
  fetchList(tabIndex, offset) {
    return new Promise(resolve => {
      setTimeout(() => {
        const list = Array.from({ length: 10 }, (_, i) => ({
          id: `${tabIndex}-${offset + i}`,
          title: `Tab ${tabIndex + 1} - Item ${offset + i + 1}`,
          cover: 'https://example.com/image.jpg'
        }))
        resolve(list)
      }, 1000)
    })
  }
})
```

## 示例代码片段

{% minicode('1IaEOym777Mx') %}
