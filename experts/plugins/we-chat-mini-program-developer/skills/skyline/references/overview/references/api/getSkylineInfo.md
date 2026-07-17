# wx.getSkylineInfo / wx.getSkylineInfoSync

获取当前运行环境对于 Skyline 渲染引擎的支持情况。

## 基础信息

| 项目 | 说明 |
|------|------|
| 基础库版本 | 2.26.2+ |
| 小程序插件 | 支持 |
| 鸿蒙 OS | 支持 |

## wx.getSkylineInfo (异步)

### 参数

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| success | function | 否 | 成功回调 |
| fail | function | 否 | 失败回调 |
| complete | function | 否 | 完成回调 |

### 返回值 (res)

| 属性 | 类型 | 说明 |
|------|------|------|
| isSupported | boolean | 是否支持 Skyline |
| version | string | Skyline 版本号，如 `0.9.7` |
| reason | string | 不支持的原因（仅当 `isSupported` 为 `false`） |

### reason 可能值

| 值 | 说明 | 解决方案 |
|----|------|----------|
| `client not supported` | 微信客户端不支持 | 升级微信客户端 |
| `baselib not supported` | 基础库不支持 | 升级微信客户端（基础库自动更新） |
| `a-b test not enabled` | 未命中 AB 实验 | 配置 We 分析 AB 实验 |
| `SwitchRender option set to webview` | 强切为 WebView | 切换回 Auto 或 Skyline |

### 示例

```javascript
wx.getSkylineInfo({
  success(res) {
    console.log('Skyline 支持:', res.isSupported)
    console.log('Skyline 版本:', res.version)
    
    if (!res.isSupported) {
      console.log('不支持原因:', res.reason)
    }
  },
  fail(err) {
    console.error('获取 Skyline 信息失败:', err)
  }
})
```

## wx.getSkylineInfoSync (同步)

### 返回值

与异步版本的 `res` 相同。

### 示例

```javascript
const info = wx.getSkylineInfoSync()

console.log('Skyline 支持:', info.isSupported)
console.log('Skyline 版本:', info.version)

if (!info.isSupported) {
  console.log('不支持原因:', info.reason)
}
```

## 使用场景

### 判断是否启用 Skyline 特性

```javascript
Page({
  onLoad() {
    const info = wx.getSkylineInfoSync()
    
    if (info.isSupported) {
      // 使用 Skyline 专属特性
      this.initWorkletAnimation()
    } else {
      // 降级方案
      this.initFallbackAnimation()
    }
  }
})
```

### 日志上报

```javascript
App({
  onLaunch() {
    const info = wx.getSkylineInfoSync()
    
    // 上报 Skyline 使用情况
    wx.reportAnalytics('skyline_status', {
      supported: info.isSupported,
      version: info.version || 'N/A',
      reason: info.reason || 'N/A'
    })
  }
})
```

### 调试信息展示

```javascript
Page({
  data: {
    debugInfo: ''
  },
  
  onLoad() {
    const info = wx.getSkylineInfoSync()
    
    this.setData({
      debugInfo: `Skyline: ${info.isSupported ? '✓' : '✗'} v${info.version || 'N/A'}`
    })
  }
})
```

## 与 this.renderer 的区别

| 对比项 | wx.getSkylineInfo | this.renderer |
|--------|-------------------|---------------|
| 调用时机 | 任何时候 | 页面/组件实例化后 |
| 返回信息 | 详细信息（版本、原因） | 仅当前渲染器类型 |
| 用途 | 全局能力检测 | 页面级别判断 |

```javascript
Page({
  onLoad() {
    // API 方式 - 获取全局支持情况
    const info = wx.getSkylineInfoSync()
    console.log('全局支持:', info.isSupported)
    
    // 实例属性 - 获取当前页面实际使用的渲染器
    console.log('当前页面:', this.renderer)  // 'skyline' 或 'webview'
  }
})
```

## 注意事项

1. **版本要求**：需要基础库 2.26.2+
2. **不支持 Promise**：异步版本不支持 Promise 风格调用
3. **AB 实验影响**：即使 `isSupported` 为 true，实际渲染器仍受 AB 实验控制
