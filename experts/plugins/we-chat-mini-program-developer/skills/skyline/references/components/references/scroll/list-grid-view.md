# list-view 与 grid-view

## 概述

`list-view` 和 `grid-view` 是 Skyline 新增的布局容器组件，用于实现列表和网格布局。它们必须作为 `<scroll-view type="custom">` 或 `<sticky-section>` 的直接子节点使用。

## list-view 列表布局

### 基本用法

```html
<scroll-view type="custom" scroll-y style="height: 100vh;">
  <list-view>
    <view wx:for="{{list}}" wx:key="id">
      {{item.name}}
    </view>
  </list-view>
</scroll-view>
```

### 属性说明

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| padding | Array | [0,0,0,0] | 内边距 [top, right, bottom, left] |

### 配合吸顶使用

```html
<scroll-view type="custom" scroll-y>
  <sticky-section>
    <sticky-header>分类 A</sticky-header>
    <list-view>
      <view wx:for="{{categoryA}}" wx:key="id">{{item.name}}</view>
    </list-view>
  </sticky-section>
  
  <sticky-section>
    <sticky-header>分类 B</sticky-header>
    <list-view>
      <view wx:for="{{categoryB}}" wx:key="id">{{item.name}}</view>
    </list-view>
  </sticky-section>
</scroll-view>
```

## grid-view 网格/瀑布流布局

### 基本用法

```html
<scroll-view type="custom" scroll-y>
  <grid-view type="aligned" cross-axis-count="2">
    <view wx:for="{{list}}" wx:key="id" class="grid-item">
      {{item.name}}
    </view>
  </grid-view>
</scroll-view>
```

### 属性说明

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| type | string | - | 布局类型：aligned（网格）/masonry（瀑布流） |
| cross-axis-count | number | 2 | 交叉轴元素数量（列数） |
| main-axis-gap | number | 0 | 主轴方向间距 |
| cross-axis-gap | number | 0 | 交叉轴方向间距 |
| padding | Array | [0,0,0,0] | 内边距 |
| max-cross-axis-extent | number | - | 交叉轴元素最大范围 |

### type 属性

| 值 | 说明 |
|----|------|
| aligned | 网格布局，所有项等高 |
| masonry | 瀑布流布局，项高度可不同 |

### 网格布局示例

```html
<scroll-view type="custom" scroll-y>
  <grid-view 
    type="aligned" 
    cross-axis-count="3"
    cross-axis-gap="8"
    main-axis-gap="8"
  >
    <view 
      wx:for="{{products}}" 
      wx:key="id" 
      class="product-card"
    >
      <image src="{{item.cover}}" mode="aspectFill" />
      <text>{{item.name}}</text>
      <text class="price">¥{{item.price}}</text>
    </view>
  </grid-view>
</scroll-view>
```

### 瀑布流布局示例

```html
<scroll-view type="custom" scroll-y>
  <grid-view 
    type="masonry" 
    cross-axis-count="2"
    cross-axis-gap="12"
    main-axis-gap="12"
  >
    <view 
      wx:for="{{images}}" 
      wx:key="id" 
      class="masonry-item"
    >
      <!-- 瀑布流中每项高度可以不同 -->
      <image 
        src="{{item.url}}" 
        mode="widthFix"
        style="width: 100%;"
      />
      <text>{{item.title}}</text>
    </view>
  </grid-view>
</scroll-view>
```

## list-builder 列表构造器

列表构造器用于实现可回收的虚拟列表，适合超长列表场景。

### 基本用法

```html
<scroll-view type="custom" scroll-y>
  <list-builder
    list="{{list}}"
    child-count="{{list.length}}"
    child-height="200"
    bind:itembuild="onItemBuild"
    bind:itemdispose="onItemDispose"
  >
    <view slot:item slot:index style="height: 200px;">
      <view>{{index}}</view>
    </view>
  </list-builder>
</scroll-view>
```

### 属性说明

| 属性 | 类型 | 说明 |
|------|------|------|
| list | Array | 数据列表 |
| child-count | number | 列表项数量 |
| child-height | number | 列表项高度（定高模式必填） |

### 事件说明

| 事件 | 说明 | detail |
|------|------|--------|
| bind:itembuild | 列表项被创建 | { index } |
| bind:itemdispose | 列表项被回收 | { index } |

### 完整示例

```html
<scroll-view type="custom" scroll-y style="height: 100vh;">
  <list-builder
    list="{{list}}"
    child-count="{{list.length}}"
    child-height="100"
    bind:itembuild="onItemBuild"
    bind:itemdispose="onItemDispose"
  >
    <view slot:item slot:index class="list-item">
      <image class="avatar" src="{{item.avatar}}" />
      <view class="info">
        <text class="name">{{item.name}}</text>
        <text class="desc">{{item.desc}}</text>
      </view>
    </view>
  </list-builder>
</scroll-view>
```

```javascript
Page({
  data: {
    list: Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `用户 ${i}`,
      desc: `这是第 ${i} 个用户的描述`,
      avatar: `https://example.com/avatar/${i}.jpg`
    }))
  },
  
  onItemBuild(e) {
    console.log('创建列表项:', e.detail.index)
  },
  
  onItemDispose(e) {
    console.log('回收列表项:', e.detail.index)
  }
})
```

### 注意事项

1. scroll-view 必须设置 `type="custom"`
2. 列表项默认为定高模式，需通过 `child-height` 指定
3. 不定高模式会存在滚动条跳动问题
4. 只支持纵向滚动
5. 不支持 `scroll-into-view`

## grid-builder 网格构造器

网格构造器与列表构造器类似，用于可回收的网格布局。

### 基本用法

```html
<scroll-view type="custom" scroll-y>
  <grid-builder
    list="{{list}}"
    child-count="{{list.length}}"
    cross-axis-count="4"
    cross-axis-gap="8"
    main-axis-gap="8"
  >
    <view slot:item slot:index class="grid-item">
      <view>{{index}}</view>
    </view>
  </grid-builder>
</scroll-view>
```

### 属性说明

| 属性 | 类型 | 说明 |
|------|------|------|
| list | Array | 数据列表 |
| child-count | number | 网格项数量 |
| cross-axis-count | number | 交叉轴元素数量（列数） |
| cross-axis-gap | number | 交叉轴间距 |
| main-axis-gap | number | 主轴间距 |

## 使用规则

### MUST（必须遵守）

1. list-view/grid-view 必须在 `type="custom"` 的 scroll-view 下使用
2. 使用 list-builder 时必须指定 `child-height`（定高模式）
3. 网格布局必须指定 `cross-axis-count`

### NEVER（禁止行为）

1. 不要在 `type="list"` 的 scroll-view 中使用 list-view/grid-view
2. 不要在 list-builder/grid-builder 外直接放置列表项

## 性能对比

| 方案 | 适用场景 | 优势 | 劣势 |
|------|----------|------|------|
| scroll-view type="list" | 普通列表 | 简单易用 | 大数据量性能一般 |
| list-view | 分组列表 | 配合吸顶 | 需要 custom 模式 |
| list-builder | 超长列表（1000+） | 真正虚拟列表 | 配置复杂，定高限制 |
| grid-view | 网格/瀑布流 | 布局灵活 | 需要 custom 模式 |
| grid-builder | 超长网格 | 虚拟网格 | 配置复杂 |

## 示例代码片段

列表构造器：{% minicode('wiAQEwmN7VRz') %}
网格构造器：{% minicode('GSAP4wms7LRe') %}
