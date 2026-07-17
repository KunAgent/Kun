# Skyline 功能特性

## 特性总览

Skyline 以性能为首要目标，在 CSS 特性上保留更现代的子集，同时新增大量类原生体验的特性。

## 一、性能优化特性

### 1.1 单线程组件框架 (glass-easel)

Skyline 默认启用 glass-easel 组件框架：
- 建树流程耗时降低 30%-40%
- setData 调用无通信和序列化开销

```json
// app.json
{
  "componentFramework": "glass-easel"
}
```

### 1.2 组件下沉

部分内置组件从 JS 下沉到原生实现：
- `view`、`text`、`image` 等基础组件下沉
- 创建组件开销降低 30%
- `scroll-view`、`swiper` 使用原生实现，性能更好

### 1.3 长列表按需渲染

scroll-view 自动按需渲染直接子节点：

```html
<!-- 每个直接子节点按需渲染 -->
<scroll-view type="list" scroll-y>
  <view wx:for="{{list}}" wx:key="id">{{item.name}}</view>
</scroll-view>
```

支持 lazy mount 机制优化首次渲染。

### 1.4 WXSS 预编译

- 构建时将 WXSS 预编译为二进制文件
- 运行时直接读取，无需解析
- 预编译比运行时解析快 5 倍以上

### 1.5 样式计算优化

- 精简 CSS 特性，简化计算流程
- 局部样式更新，避免 DOM 树多次遍历
- 基于 `wx:for` 的节点样式共享（声明 `list-item`）
- rpx 单位原生支持

```html
<!-- 启用样式共享 -->
<view wx:for="{{list}}" wx:key="id" list-item>
  {{item.name}}
</view>
```

### 1.6 内存占用优化

- 多个 Skyline 页面共享同一渲染引擎实例
- 全局样式、公共代码、缓存资源可跨页共享
- 单页内存减少 35%，多页减少 50%+

## 二、全新交互动画体系

### 2.1 Worklet 动画

基于渲染线程同步运行的动画机制：

```javascript
const offset = wx.worklet.shared(0)

// 在渲染线程执行
this.applyAnimatedStyle('.box', () => {
  'worklet'
  return {
    transform: `translateX(${offset.value}px)`
  }
})

// 触发动画
offset.value = wx.worklet.timing(100, { duration: 300 })
```

**优势**：动画逻辑在渲染线程同步执行，无延迟掉帧。

### 2.2 手势系统

原生级手势识别与协商：

```html
<pan-gesture-handler onGestureEvent="onPan">
  <view class="draggable">可拖拽元素</view>
</pan-gesture-handler>
```

支持的手势组件：
- `tap-gesture-handler` - 点击
- `double-tap-gesture-handler` - 双击
- `long-press-gesture-handler` - 长按
- `pan-gesture-handler` - 拖动
- `scale-gesture-handler` - 缩放
- `horizontal-drag-gesture-handler` - 横向拖动
- `vertical-drag-gesture-handler` - 纵向拖动

**手势协商**：解决滚动容器下的手势冲突问题。

### 2.3 自定义路由

实现自定义页面转场动画：

```javascript
// 使用预设路由
wx.navigateTo({
  url: '/pages/detail/detail',
  routeType: 'wx://cubeEffect'
})

// 或完全自定义
wx.router.addRouteBuilder('customFade', FadeRouteBuilder)
wx.navigateTo({
  url: '/pages/detail/detail',
  routeType: 'customFade'
})
```

### 2.4 共享元素动画

跨页面元素过渡：

```html
<!-- 页面 A -->
<share-element key="hero">
  <image src="{{item.cover}}" />
</share-element>

<!-- 页面 B -->
<share-element key="hero">
  <image src="{{detail.cover}}" />
</share-element>
```

元素在页面切换时自动产生过渡动画。

### 2.5 内置组件扩展

#### scroll-view 增强

- 内置下拉刷新（优化动画）
- 下拉二楼交互
- sticky 吸顶组件
- 内容未溢出时也可滚动
- 更多控制属性（min-drag-distance、scrollend、isDrag）

#### swiper 原生实现

- 性能优于 WebView 的 transform 实现
- 支持更多交互动画类型

## 三、高级特性

### 3.1 grid-view 瀑布流

原生实现的网格和瀑布流布局：

```html
<!-- 网格布局 -->
<grid-view type="aligned" cross-axis-count="3">
  <view wx:for="{{list}}" wx:key="id">{{item}}</view>
</grid-view>

<!-- 瀑布流布局 -->
<grid-view type="masonry" cross-axis-count="2">
  <view wx:for="{{list}}" wx:key="id">{{item}}</view>
</grid-view>
```

### 3.2 snapshot 截图组件

直接对 WXML 子树截图，替代 canvas 绘图：

```html
<snapshot id="poster">
  <view class="poster-content">
    <!-- 复杂布局 -->
  </view>
</snapshot>
```

```javascript
this.selectComponent('#poster').takeSnapshot({
  success(res) {
    // res.tempFilePath 是截图路径
  }
})
```

### 3.3 scroll-view 列表反转

聊天场景专用，从底部向上滚动：

```html
<scroll-view type="list" scroll-y reverse>
  <view wx:for="{{messages}}" wx:key="id">{{item.content}}</view>
</scroll-view>
```

### 3.4 draggable-sheet 半屏组件

快速实现半屏可拖拽交互：

```html
<draggable-sheet initial-child-size="0.5" snap>
  <view slot="content">
    <!-- 半屏内容 -->
  </view>
</draggable-sheet>
```

## 四、与 WebView 的差异

### 必须适配的差异

| WebView | Skyline |
|---------|---------|
| 支持原生导航栏 | 必须自定义导航栏 |
| 全局滚动 | 必须用 scroll-view |
| 任意 CSS | CSS 子集 |
| text-overflow 对任意元素 | 只对 text 组件有效 |
| display: inline | 不支持，用 flex 或 span 组件 |

### 自动降级的特性

| 特性 | Skyline | WebView 降级 |
|------|---------|-------------|
| worklet 动画 | ✅ | 已兼容 |
| 手势组件 | ✅ | 相当于空节点 |
| 自定义路由 | ✅ | 无动效但可用 |
| 共享元素 | ✅ | 无动效但可用 |
| 按需渲染 | ✅ | 无优化但可用 |

## 五、特性状态

更多计划特性请查看 [更新日志](../changelog/changelog.md)。
