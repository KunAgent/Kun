# Skyline 发布上线指南

## 关注要点

发布 Skyline 项目时需关注两个问题：

1. **版本覆盖**：低版本微信如何处理
2. **稳定性**：如何灰度发布验证

## 一、版本覆盖策略

### 策略一：提高最低版本要求

设置「基础库最低可用版本」为 Skyline 支持版本：

- 基础库 3.0.2+（对应微信 8.0.40+）

**影响**：低版本用户无法使用小程序。

### 策略二：兼容 WebView 降级

Skyline 在不支持的版本**自动降级为 WebView 渲染**。

**前提条件**：
- 样式遵循 Web 标准 CSS 子集
- 对 Skyline 新增特性做好兼容

### 特性兼容性表

| 特性 | WebView 兼容性 | 低版本兼容性 |
|------|---------------|--------------|
| worklet 动画 | ✅ 已兼容 | ⚠️ 需自行兼容 |
| 手势系统 | ⚪ 相当于空节点 | ⚠️ 需自行兼容 |
| 自定义路由 | ✅ 无动效但可用 | ✅ 无需兼容 |
| 共享元素 | ✅ 无动效但可用 | ✅ 无需兼容 |
| scroll-view 按需渲染 | ✅ 无优化但可用 | ✅ 无需兼容 |
| scroll-view 新属性/事件 | ❌ 不兼容 | ⚠️ 需自行兼容 |
| grid-view | ✅ 已兼容 | ⚠️ 需自行兼容 |
| sticky-section/header | ❌ 不兼容 | ⚠️ 需手动加 `position: sticky` |

### 低版本兼容示例

```javascript
// 检测 Skyline 支持
const info = wx.getSkylineInfoSync()

if (info.isSupported) {
  // 使用 Skyline 特性
} else {
  // 降级方案
}
```

```javascript
// worklet 兼容
if (wx.worklet) {
  // 使用 worklet 动画
} else {
  // 使用传统动画
}
```

## 二、灰度发布方案

### 方案一：We 分析 AB 实验（推荐）

Skyline **默认需要经过 We 分析 AB 实验**。

#### 配置步骤

1. **进入 We 分析**
   - 打开 We 分析平台
   - 进入 AB 实验 > 实验看板

2. **新建实验**
   - 点击「新建实验」
   - 实验类型选择「小程序基础库实验」

3. **配置分流**
   - 选择实验层级
   - 分配流量比例
   - 小范围测试：分配 0% 流量，在 Skyline 分组填入测试微信号

4. **创建实验**
   - 确认配置后创建
   - 实验立即生效

#### 流量说明

| 流量分配 | 实际效果 |
|----------|----------|
| 0% | 只有白名单用户使用 Skyline |
| 50% | Skyline 和 WebView 各 50% |
| 100% | Skyline 和 WebView 各 50%（不是全量） |
| 结束实验 + 选择全量 | 真正全量 |

#### 全量上线步骤

1. AB 实验验证稳定
2. 在 We 分析上关闭实验
3. 选择 Skyline 全量

### 方案二：小程序版本灰度

若已充分测试，可跳过 AB 实验直接启用：

#### 配置关闭 AB 实验

```json
// app.json 或 page.json
{
  "rendererOptions": {
    "skyline": {
      "disableABTest": true,
      "sdkVersionBegin": "3.0.1",
      "sdkVersionEnd": "15.255.255"
    }
  }
}
```

#### 按客户端版本配置

```json
{
  "rendererOptions": {
    "skyline": {
      "disableABTest": true,
      "iosVersionBegin": "8.0.40",
      "iosVersionEnd": "15.255.255",
      "androidVersionBegin": "8.0.40",
      "androidVersionEnd": "15.255.255",
      "ohosVersionBegin": "1.0.5",
      "ohosVersionEnd": "15.255.255"
    }
  }
}
```

**注意**：`xxxVersionEnd` 填最大值，否则新版本不生效。

#### 结合小程序灰度发布

1. 在小程序后台设置版本灰度比例
2. 新版本使用 Skyline
3. 逐步提高灰度比例

## 三、监控与回滚

### 监控指标

1. **崩溃率**：对比 Skyline 和 WebView 崩溃率
2. **首屏性能**：监控首屏渲染时间
3. **用户反馈**：关注用户反馈渠道

### 回滚方案

#### 方案一：We 分析回滚

1. 进入 AB 实验看板
2. 结束实验
3. 选择 WebView 全量

#### 方案二：配置回滚

移除 Skyline 配置或指定 WebView：

```json
// page.json
{
  "renderer": "webview"
}
```

#### 方案三：紧急发布

准备一个不含 Skyline 的备用版本，必要时紧急发布。

## 四、发布检查清单

### 发布前

- [ ] 开发者工具测试通过
- [ ] 真机预览测试通过（Android + iOS）
- [ ] 低版本 WebView 降级测试
- [ ] 原生组件（map/canvas/video）真机测试
- [ ] 性能指标达标

### AB 实验阶段

- [ ] 配置 We 分析 AB 实验
- [ ] 添加测试账号白名单
- [ ] 监控崩溃率和性能指标
- [ ] 收集用户反馈

### 全量发布

- [ ] AB 实验数据达标
- [ ] 关闭 AB 实验
- [ ] 选择 Skyline 全量
- [ ] 持续监控线上表现

## 五、常见发布问题

### Q: 为什么真机还是 WebView？

**A**: 检查以下几点：
1. 是否配置了 We 分析 AB 实验
2. 当前账号是否在白名单
3. 是否开启了强切开关

### Q: 如何快速测试不同渲染引擎？

**A**: 使用快捷切换入口（开发版/体验版）：
- 菜单 > 开发调试 > Switch Render
- 选择 Auto / WebView / Skyline

### Q: 全量后如何回滚？

**A**: 
1. We 分析全量：重新创建实验，选择 WebView
2. 配置全量：发布新版本，移除 `disableABTest` 或指定 `renderer: webview`
