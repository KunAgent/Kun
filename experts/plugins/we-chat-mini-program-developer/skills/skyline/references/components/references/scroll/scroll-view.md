# scroll-view 组件详解

## 概述

`scroll-view` 是 Skyline 中最核心的滚动容器组件。相比 WebView，Skyline 的 scroll-view 增加了多种渲染模式，支持按需渲染、嵌套滚动、下拉二级等高级功能。

## 必要配置

```html
<!-- Skyline 必须指定 type 属性 -->
<scroll-view type="list" scroll-y style="height: 100vh;">
  <!-- 内容 -->
</scroll-view>
```

> ⚠️ **MUST**: Skyline 下使用 scroll-view 必须设置 `type` 属性，否则性能会退化。

## type 属性

| 值 | 说明 | 适用场景 |
|----|------|----------|
| list | 列表模式，根据直接子节点是否在屏按需渲染 | 普通长列表 |
| custom | 自定义模式，支持 list-view/grid-view/sticky-section | 复杂布局 |
| nested | 嵌套模式，处理父子 scroll-view 滚动联动 | Tab + 列表 |

### list 模式

```html
<scroll-view type="list" scroll-y>
  <!-- 直接子节点会按需渲染 -->
  <view wx:for="{{items}}" wx:key="id">{{item.name}}</view>
</scroll-view>
```

**注意事项**：
- 只会渲染在屏节点
- 若只有一个直接子节点，性能会退化
- 列表项必须是 scroll-view 的直接子节点

### custom 模式

```html
<scroll-view type="custom" scroll-y>
  <sticky-section>
    <sticky-header>分类标题</sticky-header>
    <list-view>
      <!-- 列表内容 -->
    </list-view>
  </sticky-section>
</scroll-view>
```

**支持的子组件**：
- `sticky-section` / `sticky-header`
- `list-view` / `grid-view`
- `list-builder` / `grid-builder`

### nested 模式

```html
<scroll-view type="nested" scroll-y>
  <nested-scroll-header>
    <view>头部区域（会被滚动走）</view>
  </nested-scroll-header>
  <nested-scroll-body>
    <scroll-view type="list" associative-container="nested-scroll-view">
      <!-- 内层可滚动内容 -->
    </scroll-view>
  </nested-scroll-body>
</scroll-view>
```

## 通用属性

### 滚动控制

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| scroll-x | boolean | false | 允许横向滚动 |
| scroll-y | boolean | false | 允许纵向滚动 |
| scroll-top | number | - | 设置竖向滚动位置 |
| scroll-left | number | - | 设置横向滚动位置 |
| scroll-into-view | string | - | 滚动到指定 id 元素 |
| scroll-into-view-offset | number | 0 | scroll-into-view 额外偏移 |
| scroll-with-animation | boolean | false | 滚动时使用动画 |
| upper-threshold | number | 50 | 触发 scrolltoupper 的距离 |
| lower-threshold | number | 50 | 触发 scrolltolower 的距离 |

### 滚动事件

| 事件 | 说明 | detail |
|------|------|--------|
| bindscrolltoupper | 滚动到顶部/左边 | - |
| bindscrolltolower | 滚动到底部/右边 | - |
| bindscroll | 滚动时触发 | scrollLeft, scrollTop, scrollHeight, scrollWidth, deltaX, deltaY |

## Skyline 特有属性

### 渲染优化

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| cache-extent | number | - | 视口外预渲染距离（px） |
| reverse | boolean | false | 反向滚动（初始在底部） |
| clip | boolean | true | 是否裁剪溢出内容 |
| min-drag-distance | number | 18 | 触发滚动的最小拖动距离 |
| padding | Array | [0,0,0,0] | 内边距 [top, right, bottom, left] |

### scroll-into-view 增强

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| scroll-into-view-alignment | string | start | 目标节点位置：start/center/end/nearest |
| scroll-into-view-within-extent | boolean | false | 仅滚动到 cache-extent 内的节点 |

### Worklet 回调

| 属性 | 说明 |
|------|------|
| worklet:onscrollstart | 滚动开始，仅支持 worklet 回调 |
| worklet:onscrollupdate | 滚动中，仅支持 worklet 回调 |
| worklet:onscrollend | 滚动结束，仅支持 worklet 回调 |
| worklet:adjust-deceleration-velocity | 调整惯性滚动初速度 |

```javascript
Page({
  onScrollUpdate(e) {
    'worklet'
    // 在 UI 线程执行
    const { scrollTop, scrollLeft, isDrag } = e.detail
  }
})
```

### 关联容器

| 属性 | 类型 | 说明 |
|------|------|------|
| associative-container | string | 关联的滚动容器 |

合法值：
- `draggable-sheet`: 关联半屏拖拽组件
- `nested-scroll-view`: 关联嵌套滚动父容器
- `pop-gesture`: 关联页面手势返回

## 下拉刷新

### 基础配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| refresher-enabled | boolean | false | 开启下拉刷新 |
| refresher-threshold | number | 45 | 刷新阈值 |
| refresher-default-style | string | "black" | 默认样式：black/white/none |
| refresher-background | string | - | 刷新区域背景色 |
| refresher-triggered | boolean | false | 当前刷新状态 |

### 刷新事件

| 事件 | 说明 |
|------|------|
| bindrefresherpulling | 下拉中 |
| bindrefresherrefresh | 触发刷新 |
| bindrefresherrestore | 刷新复位 |
| bindrefresherabort | 刷新中止 |
| bind:refresherwillrefresh | 即将触发刷新（Skyline） |
| bind:refresherstatuschange | 刷新状态变化（Skyline） |

### 自定义刷新区域

```html
<scroll-view
  type="list"
  scroll-y
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
  <!-- 列表内容 -->
</scroll-view>
```

```javascript
Page({
  data: {
    refreshing: false,
    status: 0 // RefreshStatus 枚举值
  },
  
  onStatusChange(e) {
    this.setData({ status: e.detail.status })
  },
  
  onRefresh() {
    this.setData({ refreshing: true })
    // 加载数据
    setTimeout(() => {
      this.setData({ refreshing: false })
    }, 2000)
  }
})
```

### RefreshStatus 枚举

```javascript
const RefreshStatus = {
  Idle: 0,           // 空闲
  CanRefresh: 1,     // 可刷新（超过阈值）
  Refreshing: 2,     // 刷新中
  Completed: 3,      // 刷新完成
  Failed: 4,         // 刷新失败
  CanTwoLevel: 5,    // 可进入二级
  TwoLevelOpening: 6,// 二级打开中
  TwoLeveling: 7,    // 二级已打开
  TwoLevelClosing: 8 // 二级关闭中
}
```

## 下拉二级

下拉二级是下拉刷新的扩展，继续下拉可进入"二楼"页面。

### 配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| refresher-two-level-enabled | boolean | false | 开启下拉二级 |
| refresher-two-level-triggered | boolean | false | 设置打开/关闭二级 |
| refresher-two-level-threshold | number | 150 | 二级阈值 |
| refresher-two-level-close-threshold | number | 80 | 关闭二级阈值 |
| refresher-two-level-scroll-enabled | boolean | false | 二级状态可滑动 |
| refresher-two-level-pinned | boolean | false | 即将打开二级时是否定住 |
| refresher-ballistic-refresh-enabled | boolean | false | 惯性滚动触发刷新 |

### 示例

```html
<scroll-view
  type="list"
  scroll-y
  refresher-enabled="{{true}}"
  refresher-two-level-enabled="{{true}}"
  refresher-two-level-scroll-enabled="{{true}}"
  refresher-two-level-threshold="{{150}}"
  bind:refresherstatuschange="onStatusChange"
>
  <view slot="refresher" class="refresher-container">
    <!-- 根据 status 显示不同内容 -->
    <view wx:if="{{status < 5}}">下拉刷新区域</view>
    <view wx:else class="two-level-content">
      二级页面内容
    </view>
  </view>
  <!-- 列表内容 -->
</scroll-view>
```

### 相关 API

- `ScrollViewContext.triggerRefresh()` - 触发下拉刷新
- `ScrollViewContext.closeRefresh()` - 关闭下拉刷新
- `ScrollViewContext.triggerTwoLevel()` - 触发下拉二级
- `ScrollViewContext.closeTwoLevel()` - 关闭下拉二级

## 横向滚动

```html
<!-- 横向滚动需同时开启 enable-flex -->
<scroll-view 
  scroll-x 
  enable-flex
  style="flex-direction: row; white-space: nowrap;"
>
  <view style="display: inline-block; width: 200px;">Item 1</view>
  <view style="display: inline-block; width: 200px;">Item 2</view>
</scroll-view>
```

> ⚠️ **MUST**: 横向滚动需开启 `enable-flex` 以兼容 WebView。

## 性能优化建议

### 1. 指定 cache-extent

```html
<!-- 预渲染视口外 500px 区域 -->
<scroll-view type="list" cache-extent="500">
```

适当的 cache-extent 可优化滚动体验，但会增加内存占用。

### 2. 使用 list-item 属性

```html
<scroll-view type="list" scroll-y>
  <view wx:for="{{list}}" wx:key="id" list-item>
    <!-- 列表项内容 -->
  </view>
</scroll-view>
```

`list-item` 属性可启用样式共享优化。

### 3. 避免单一子节点

list 模式下若只有一个直接子节点，按需渲染会退化：

```html
<!-- ❌ 性能退化 -->
<scroll-view type="list">
  <view>
    <view wx:for="{{list}}">{{item}}</view>
  </view>
</scroll-view>

<!-- ✅ 正确做法 -->
<scroll-view type="list">
  <view wx:for="{{list}}">{{item}}</view>
</scroll-view>
```

## Bug & Tip

1. 不支持嵌套 textarea/map/canvas/video（基础库 2.4.0 以下）
2. `scroll-into-view` 优先级高于 `scroll-top`
3. 滚动 scroll-view 会阻止页面回弹，无法触发 `onPullDownRefresh`
4. 自定义下拉刷新节点需声明 `slot="refresher"`
5. 滚动条长度是预估的，子节点高度差异大时可能不准确
