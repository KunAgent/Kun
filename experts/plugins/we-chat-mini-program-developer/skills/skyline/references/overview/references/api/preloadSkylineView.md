# wx.preloadSkylineView

预加载下个页面所需要的 Skyline 运行环境。

## 基础信息

| 项目 | 说明 |
|------|------|
| 基础库版本 | 2.24.7+ |
| 小程序插件 | 支持 |
| Promise 风格 | 不支持 |

## 功能说明

微信客户端默认预加载 WebView 环境（因为大多数小程序使用 WebView），不会自动预加载 Skyline 环境。

调用此接口可以提前预加载 Skyline 运行环境，使后续跳转到 Skyline 页面时更快。

## 参数

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| success | function | 否 | 成功回调 |
| fail | function | 否 | 失败回调 |
| complete | function | 否 | 完成回调 |

## 基础示例

```javascript
wx.preloadSkylineView({
  success() {
    console.log('Skyline 环境预加载成功')
  },
  fail(err) {
    console.error('Skyline 环境预加载失败:', err)
  }
})
```

## 最佳实践

### 1. 在 onShow 中延迟调用

```javascript
Page({
  onShow() {
    // 延迟调用，避免阻塞当前页面渲染
    setTimeout(() => {
      wx.preloadSkylineView()
    }, 500)
  }
})
```

**说明**：在 `onShow` 而非 `onLoad` 中调用，确保页面返回时也能重新预加载。

### 2. 在可能跳转的页面调用

```javascript
// pages/list/list.js
// 列表页，用户可能点击进入 Skyline 渲染的详情页

Page({
  onShow() {
    // 预加载 Skyline 环境
    setTimeout(() => {
      wx.preloadSkylineView()
    }, 300)
  },
  
  onItemTap(e) {
    const { id } = e.currentTarget.dataset
    // 跳转到 Skyline 详情页
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    })
  }
})
```

### 3. 条件预加载

```javascript
Page({
  onShow() {
    // 只在支持 Skyline 的环境预加载
    const info = wx.getSkylineInfoSync()
    
    if (info.isSupported) {
      setTimeout(() => {
        wx.preloadSkylineView()
      }, 500)
    }
  }
})
```

### 4. 结合路由判断

```javascript
// app.js
App({
  onLaunch() {
    // 记录即将访问的页面
    this.nextPage = null
  },
  
  preloadIfNeeded(nextPage) {
    // 根据目标页面决定是否预加载
    const skylinePages = [
      'pages/detail/detail',
      'pages/animation/animation'
    ]
    
    if (skylinePages.includes(nextPage)) {
      wx.preloadSkylineView()
    }
  }
})
```

## 调用时机建议

| 场景 | 推荐时机 | 延迟时间 |
|------|----------|----------|
| 首页加载 | onShow | 500ms |
| 列表页 | onShow | 300ms |
| 详情页返回后 | onShow | 200ms |
| 用户操作后 | 操作回调中 | 立即 |

## 性能影响

### 正面影响

- 首次跳转 Skyline 页面时间减少
- 减少白屏时间
- 提升用户体验

### 注意事项

- 预加载会占用一定内存
- 频繁调用不会有额外收益（环境已加载）
- 建议配合条件判断，避免不必要的预加载

## 配合其他优化

### 1. 配合资源预加载

```javascript
Page({
  onShow() {
    // 预加载 Skyline 环境
    wx.preloadSkylineView()
    
    // 预加载图片资源
    wx.getImageInfo({
      src: 'https://example.com/hero.jpg'
    })
  }
})
```

### 2. 配合数据预取

```javascript
Page({
  onShow() {
    // 预加载 Skyline 环境
    wx.preloadSkylineView()
    
    // 预取下一页数据
    this.prefetchDetailData()
  },
  
  prefetchDetailData() {
    // 提前获取详情页数据
  }
})
```

## 与预加载分包配合

```javascript
// 先预加载分包，再预加载 Skyline
wx.preloadSubPackage({
  package: 'packageA',
  success() {
    // 分包加载完成后预加载 Skyline
    wx.preloadSkylineView()
  }
})
```

## 注意事项

1. **调用时机**：避免在关键渲染路径上同步调用
2. **延迟执行**：使用 setTimeout 延迟，避免影响当前页面
3. **条件判断**：只在需要跳转 Skyline 页面时预加载
4. **重复调用**：多次调用不会报错，但无额外收益
