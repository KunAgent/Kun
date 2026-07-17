# 滚动 API 代码模式

## 模式 1：程序化下拉刷新

scroll-view 开启 `refresher-enabled` 后，通过 ScrollViewContext 程序化控制刷新状态。

### WXML

```html
<scroll-view
  id="sv"
  type="list"
  scroll-y
  enhanced
  refresher-enabled="{{true}}"
  refresher-default-style="none"
  refresher-triggered="{{refreshing}}"
  bindrefresherrefresh="onRefresh"
  bind:refresherstatuschange="onStatusChange"
>
  <view slot="refresher" class="custom-refresher">
    <view wx:if="{{status === 0}}">下拉刷新</view>
    <view wx:elif="{{status === 1}}">松手刷新</view>
    <view wx:elif="{{status === 2}}">刷新中...</view>
    <view wx:elif="{{status === 3}}">刷新完成</view>
  </view>
  <view wx:for="{{list}}" wx:key="id">{{item.name}}</view>
</scroll-view>
```

### JS

```js
Page({
  data: {
    refreshing: false,
    status: 0,
    list: []
  },

  onReady() {
    wx.createSelectorQuery().select('#sv').node()
      .exec(res => { this.svCtx = res[0].node })
  },

  // 用户手动下拉触发
  onRefresh() {
    this.loadData()
  },

  onStatusChange(e) {
    this.setData({ status: e.detail.status })
  },

  // 程序化触发刷新（如点击按钮）
  manualRefresh() {
    this.svCtx.triggerRefresh({ duration: 300, easingFunction: 'ease' })
    this.loadData()
  },

  loadData() {
    this.setData({ refreshing: true })
    // 模拟请求
    setTimeout(() => {
      this.setData({ refreshing: false, list: [...] })
      // 也可通过 Context 关闭
      // this.svCtx.closeRefresh()
    }, 2000)
  }
})
```

## 模式 2：下拉二级（"二楼"页面）

下拉二级是下拉刷新的扩展，继续下拉可进入"二楼"页面。

### WXML

```html
<scroll-view
  id="sv"
  type="list"
  scroll-y
  enhanced
  refresher-enabled="{{true}}"
  refresher-two-level-enabled="{{true}}"
  refresher-two-level-scroll-enabled="{{true}}"
  refresher-two-level-threshold="{{150}}"
  bind:refresherstatuschange="onStatusChange"
>
  <view slot="refresher" class="refresher-container">
    <view wx:if="{{status < 5}}">下拉刷新区域</view>
    <view wx:else class="two-level-content">
      二级页面内容（"二楼"）
    </view>
  </view>
  <view wx:for="{{list}}" wx:key="id">{{item.name}}</view>
</scroll-view>
```

### JS

```js
Page({
  data: { status: 0 },

  onReady() {
    wx.createSelectorQuery().select('#sv').node()
      .exec(res => { this.svCtx = res[0].node })
  },

  onStatusChange(e) {
    this.setData({ status: e.detail.status })
  },

  // 程序化打开二楼
  openTwoLevel() {
    this.svCtx.triggerTwoLevel({
      duration: 500,
      easingFunction: 'ease'
    })
  },

  // 程序化关闭二楼
  closeTwoLevel() {
    this.svCtx.closeTwoLevel({
      duration: 500,
      easingFunction: 'ease'
    })
  }
})
```

### RefreshStatus 枚举

| 值 | 常量 | 说明 |
|----|------|------|
| 0 | Idle | 空闲 |
| 1 | CanRefresh | 可刷新（超过阈值） |
| 2 | Refreshing | 刷新中 |
| 3 | Completed | 刷新完成 |
| 4 | Failed | 刷新失败 |
| 5 | CanTwoLevel | 可进入二级 |
| 6 | TwoLevelOpening | 二级打开中 |
| 7 | TwoLeveling | 二级已打开 |
| 8 | TwoLevelClosing | 二级关闭中 |

## 模式 3：DraggableSheet 程序化控制

通过 DraggableSheetContext 控制半屏面板的展开/收起。

```js
Page({
  data: { expanded: false },

  onReady() {
    this.createSelectorQuery().select('.sheet').node()
      .exec(res => { this.sheetCtx = res[0].node })
  },

  // 展开到 70%
  expandSheet() {
    this.sheetCtx.scrollTo({
      size: 0.7,
      animated: true,
      duration: 300,
      easingFunction: 'ease'
    })
  },

  // 收起到 30%
  collapseSheet() {
    this.sheetCtx.scrollTo({
      size: 0.3,
      animated: true,
      duration: 300
    })
  },

  // 使用绝对像素定位
  scrollToPixels() {
    this.sheetCtx.scrollTo({
      pixels: 200,
      animated: true,
      duration: 300
    })
  }
})
```

## 模式 4：Worklet 内滚动控制

在 UI 线程中直接控制 scroll-view 滚动，配合手势实现高性能交互。

```js
const { shared, scrollViewContext } = wx.worklet

Page({
  onLoad() {
    // 1. 创建 SharedValue 存储引用
    this.scrollRef = shared()

    // 2. 通过 ref() 获取引用
    this.createSelectorQuery()
      .select('.scrollable')
      .ref((res) => {
        this.scrollRef.value = res.ref
      })
      .exec()
  },

  // 3. 在 worklet 函数中控制滚动
  handleGesture(e) {
    'worklet'
    const { absoluteY } = e
    // 根据手势位置控制滚动
    scrollViewContext.scrollTo(this.scrollRef.value, {
      top: absoluteY * 2,
      duration: 0,
      animated: false
    })
  },

  // 带动画的滚动
  scrollToTop() {
    'worklet'
    scrollViewContext.scrollTo(this.scrollRef.value, {
      top: 0,
      duration: 500,
      animated: true,
      easingFunction: 'ease'
    })
  }
})
```

## 模式 5：ScrollIntoView Skyline 增强

Skyline 模式下 `scrollIntoView` 支持额外配置项。

```js
Page({
  onReady() {
    wx.createSelectorQuery().select('#sv').node()
      .exec(res => { this.svCtx = res[0].node })
  },

  // 基础用法（WebView + Skyline 均支持）
  scrollToItem() {
    this.svCtx.scrollIntoView('#item-50')
  },

  // Skyline 增强用法（基础库 3.1.0+）
  scrollToItemEnhanced() {
    this.svCtx.scrollIntoView('#item-50', {
      alignment: 'center',     // 目标居中显示
      offset: -20,             // 额外偏移 -20px
      withinExtent: true,      // 仅滚动到 cacheExtent 内的节点
      animated: true
    })
  }
})
```
