# draggable-sheet 半屏可拖拽组件

## 概述

`draggable-sheet` 是 Skyline 新增的半屏可拖拽组件，用于实现类似地图 App 底部面板的效果。用户可以通过拖拽来调整面板的高度。

## 基本用法

```html
<draggable-sheet
  class="sheet"
  initial-child-size="0.5"
  min-child-size="0.2"
  max-child-size="0.8"
>
  <scroll-view scroll-y type="list" associative-container="draggable-sheet">
    <!-- 内容 -->
  </scroll-view>
</draggable-sheet>
```

## 属性说明

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| initial-child-size | number | 0.5 | 初始占父容器比例 |
| min-child-size | number | 0.25 | 最小占父容器比例 |
| max-child-size | number | 1.0 | 最大占父容器比例 |
| snap | boolean | false | 拖拽后是否自动对齐关键点 |
| snap-sizes | Array | [] | 对齐关键点（不含最小/最大值） |
| worklet:onsizeupdate | worklet | - | 尺寸变化回调（worklet） |

## 吸附功能

设置 `snap` 和 `snap-sizes` 可以让面板在拖拽松手后自动吸附到指定位置：

```html
<draggable-sheet
  snap="{{true}}"
  snap-sizes="{{[0.3, 0.5, 0.7]}}"
  min-child-size="0.2"
  max-child-size="0.9"
>
```

上例中，松手后面板会自动吸附到 0.2、0.3、0.5、0.7、0.9 中最近的位置。

## 配合 scroll-view 使用

**重要**：内部的 scroll-view 必须设置 `associative-container="draggable-sheet"` 才能正确联动。

```html
<draggable-sheet class="sheet">
  <scroll-view
    scroll-y
    type="list"
    associative-container="draggable-sheet"
    bounces="{{true}}"
  >
    <view wx:for="{{list}}" wx:key="id" class="item">
      {{item.name}}
    </view>
  </scroll-view>
</draggable-sheet>
```

联动策略：
- 向上拖拽时：先展开面板，面板到达最大高度后滚动内容
- 向下拖拽时：先滚动内容到顶部，然后收起面板

## DraggableSheetContext API

通过 `createSelectorQuery` 获取组件节点后，可以使用以下 API：

### scrollTo

```javascript
Page({
  onReady() {
    this.createSelectorQuery()
      .select('.sheet')
      .node()
      .exec(res => {
        const sheetContext = res[0].node
        
        // 滚动到指定位置
        sheetContext.scrollTo({
          size: 0.7,           // 目标尺寸比例
          animated: true,       // 是否动画
          duration: 300,        // 动画时长（ms）
          easingFunction: 'ease' // 缓动函数
        })
      })
  }
})
```

### scrollTo 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| size | number | 目标尺寸比例（0~1） |
| animated | boolean | 是否使用动画 |
| duration | number | 动画时长（毫秒） |
| easingFunction | string | 缓动函数 |

缓动函数可选值：
- `ease`
- `ease-in`
- `ease-out`
- `ease-in-out`
- `linear`

## Worklet 回调

使用 `worklet:onsizeupdate` 可以在 UI 线程监听尺寸变化：

```html
<draggable-sheet
  class="sheet"
  worklet:onsizeupdate="onSizeUpdate"
>
```

```javascript
Page({
  onSizeUpdate(e) {
    'worklet'
    // 在 UI 线程执行
    const { pixels, size } = e
    console.log(`尺寸变化: ${pixels}px, 比例: ${size}`)
    
    // 可以在这里做同步动画
    // 例如：根据面板高度调整其他元素透明度
  }
})
```

## 完整示例：地图底部面板

```html
<view class="container">
  <!-- 地图区域 -->
  <map class="map" latitude="{{latitude}}" longitude="{{longitude}}" />
  
  <!-- 底部面板 -->
  <draggable-sheet
    class="sheet"
    initial-child-size="0.4"
    min-child-size="0.15"
    max-child-size="0.85"
    snap="{{true}}"
    snap-sizes="{{[0.4]}}"
    worklet:onsizeupdate="onSizeUpdate"
  >
    <scroll-view
      class="sheet-content"
      scroll-y
      type="list"
      associative-container="draggable-sheet"
    >
      <!-- 拖拽指示条 -->
      <view class="drag-handle">
        <view class="handle-bar"></view>
      </view>
      
      <!-- 搜索框 -->
      <view class="search-box">
        <input placeholder="搜索地点" />
      </view>
      
      <!-- 附近地点列表 -->
      <view class="section-title">附近地点</view>
      <view 
        wx:for="{{nearbyPlaces}}" 
        wx:key="id"
        class="place-item"
        bindtap="onPlaceTap"
        data-place="{{item}}"
      >
        <view class="place-icon">
          <image src="{{item.icon}}" />
        </view>
        <view class="place-info">
          <text class="place-name">{{item.name}}</text>
          <text class="place-address">{{item.address}}</text>
        </view>
        <text class="place-distance">{{item.distance}}</text>
      </view>
    </scroll-view>
  </draggable-sheet>
</view>
```

```css
.container {
  position: relative;
  height: 100vh;
}

.map {
  width: 100%;
  height: 100%;
}

.sheet {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: #fff;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
}

.sheet-content {
  height: 100%;
}

.drag-handle {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}

.handle-bar {
  width: 40px;
  height: 4px;
  background: #ddd;
  border-radius: 2px;
}

.search-box {
  margin: 0 16px 16px;
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 8px;
}

.section-title {
  padding: 12px 16px;
  font-size: 14px;
  color: #999;
}

.place-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.place-icon {
  width: 40px;
  height: 40px;
  margin-right: 12px;
}

.place-icon image {
  width: 100%;
  height: 100%;
}

.place-info {
  flex: 1;
}

.place-name {
  display: block;
  font-size: 15px;
  color: #333;
}

.place-address {
  display: block;
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.place-distance {
  font-size: 12px;
  color: #999;
}
```

```javascript
Page({
  data: {
    latitude: 39.908823,
    longitude: 116.397470,
    nearbyPlaces: [
      { id: 1, name: '天安门广场', address: '北京市东城区', distance: '500m', icon: '/images/landmark.png' },
      { id: 2, name: '故宫博物院', address: '北京市东城区景山前街4号', distance: '1.2km', icon: '/images/museum.png' },
      // ...
    ]
  },
  
  onSizeUpdate(e) {
    'worklet'
    console.log('sheet size:', e.size)
  },
  
  onPlaceTap(e) {
    const place = e.currentTarget.dataset.place
    // 处理地点点击
  },
  
  // 展开面板
  expandSheet() {
    this.createSelectorQuery()
      .select('.sheet')
      .node()
      .exec(res => {
        res[0].node.scrollTo({
          size: 0.85,
          animated: true,
          duration: 300
        })
      })
  },
  
  // 收起面板
  collapseSheet() {
    this.createSelectorQuery()
      .select('.sheet')
      .node()
      .exec(res => {
        res[0].node.scrollTo({
          size: 0.15,
          animated: true,
          duration: 300
        })
      })
  }
})
```

## 注意事项

1. **仅限 Skyline**：该组件仅在 Skyline 渲染模式下可用
2. **关联容器**：内部 scroll-view 必须设置 `associative-container="draggable-sheet"`
3. **尺寸比例**：所有尺寸属性都是相对于父容器的比例（0~1）
4. **worklet 回调**：`onsizeupdate` 仅支持 worklet 函数

## 示例代码片段

{% minicode('K5M2NamJ7ILV') %}
