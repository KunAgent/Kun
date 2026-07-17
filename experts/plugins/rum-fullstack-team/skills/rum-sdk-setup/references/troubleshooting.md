# RUM SDK 接入排障指南

> 本指南适用于所有 Aegis SDK（Web、小程序、React Native、Node.js 等）。大部分排障步骤基于 core 层统一逻辑，所有 SDK 通用；个别平台特有的步骤会标注 `[仅 Web]` 等平台标记。

## 问题 1：无数据上报（Network 中看不到上报请求）

### 排查步骤

1. **检查上报 ID 是否正确**
   - 打开 [RUM 控制台](https://console.cloud.tencent.com/rum)，确认应用存在且 ID 一致
   - ID 格式应为 `pGUVFTCZyew...`，不是 `AKID...`（那是 SecretId）

2. **检查 hostUrl 是否匹配地域**
   - 中国内地（SDK 默认）：`https://rumt-zh.com`
   - 新加坡：`https://rumt-sg.com`
   - 硅谷：`https://rumt-us.com`

3. **检查 SDK 是否被正确加载** `[仅 Web]`
   - 在浏览器控制台输入 `Aegis` 或检查是否有 `aegis-web-sdk` 相关的 import
   - CDN 方式：确认 `<script>` 标签在 `<head>` 中且网络加载成功

4. **检查是否被 beforeRequest 钩子拦截**
   - 如果配置了 `beforeRequest`，检查是否在某些条件下返回了 `false`
   - 开发环境中 `process.env.NODE_ENV !== 'production'` 的判断可能导致拦截

5. **检查是否在 SSR 环境中初始化** `[仅 Web]`
   - Next.js / Nuxt 等 SSR 框架中，SDK 必须只在客户端初始化
   - 检查是否有 `typeof window !== 'undefined'` 的判断

6. **检查 SDK 是否已被熔断销毁**
   - SDK 有自动熔断机制：连续上报失败 **60 次**或收到服务端 **403 forbidden** 响应后，SDK 会自动调用 `destroy()` 销毁自身
   - 销毁后所有方法变为空函数，**不再上报任何数据，且无控制台提示**
   - 排查方法：在控制台执行 `Aegis.instances`，如果返回空数组说明 SDK 已被销毁
   - 常见原因：上报 ID 无效、hostUrl 配置错误导致请求持续失败
   - 解决：修正配置后**刷新页面**重新初始化 SDK

---

## 问题 2：上报接口返回 403

### 原因

**上报 ID 无效或已过期** — 这是 403 的唯一原因。登录 [RUM 控制台](https://console.cloud.tencent.com/rum) 确认应用状态是否正常、ID 是否一致。

### 解决方案

确认上报 ID 正确后刷新页面重新初始化 SDK。

---

## 问题 3：部分错误未上报

### JS 错误未上报

1. **Vue 项目未配置 errorHandler** `[Web / Weex]`
   - Vue 会拦截组件内错误，必须配置 `Vue.config.errorHandler` 转发给 Aegis

2. **错误被 try-catch 吞掉**
   - Web SDK 通过 `window.onerror` 捕获错误 `[仅 Web]`，其他 SDK 有各自的全局错误捕获机制
   - 如果错误被 catch 住了就不会冒泡，在 catch 中使用 `aegis.error(e)` 手动上报

3. **`repeat` 参数限制**
   - 默认同一错误只上报 5 次，之后不再上报
   - 如需调大：`repeat: 50`

### Promise 错误未上报

1. **Promise 被正确 catch 了**
   - 被 `.catch()` 处理的 Promise 不会触发 `unhandledrejection`，这是预期行为
   - 如需上报已 catch 的错误，手动调用 `aegis.error(e)`

### API 错误未上报

1. **未开启 `reportApiSpeed`**
   - 必须设置 `reportApiSpeed: true` 才会监控 Ajax/Fetch 请求

2. **retcode 判定逻辑不匹配**
   - 默认认为 `code/ret/retcode/errcode` 不为 0 时异常
   - 如果你的接口用其他字段或其他成功值，需自定义 `retCodeHandler`

---

## 问题 4：SPA 页面 PV 不准确 `[Web / RN / Cocos]`

### 原因
SPA 路由切换不会触发页面级别的加载事件，SDK 默认不会自动上报。

### 解决方案
```javascript
const aegis = new Aegis({
  id: 'YOUR_REPORT_ID',
  spa: true,  // 开启后会监听 hashchange 和 popstate 事件
});
```

---

## 问题 5：页面性能数据异常 `[仅 Web]`

### 首屏时间为 0 或异常大

1. **SDK 加载太晚**
   - SDK 必须在 `<head>` 中尽早加载，否则无法采集完整的 Performance Timing 数据

2. **页面使用了 SSR**
   - SSR 页面的 DOM 是服务端渲染的，SDK 的首屏检测算法（监听 3s 内 DOM 变化）可能不准确
   - 可考虑使用 Web Vitals 手动上报模式

### 资源测速数据为空

1. **未开启 `reportAssetSpeed`**
   ```javascript
   reportAssetSpeed: true
   ```

2. **跨域资源未配置 Timing-Allow-Origin**
   - 跨域资源的 PerformanceResourceTiming 数据为 0
   - 需要在资源服务器响应头中添加 `Timing-Allow-Origin: *`

---

## 问题 6：控制台出现 SDK 相关警告

### SDK 实际输出的日志（源码确认）

1. **`[Aegis] isSlowApi function happen error: ...`** `[仅 Web]`
   - 自定义的 `api.isSlowApi` 函数执行抛异常，该条测速数据会被丢弃
   - 检查 `isSlowApi` 函数实现是否有 bug

2. **`[Aegis] isSlowAsset function happen error: ...`** `[仅 Web]`
   - 自定义的 `api.isSlowAsset` 函数执行抛异常
   - 检查 `isSlowAsset` 函数实现

3. **`[Aegis] isSlowPage function happen error: ...`** `[仅 Web]`
   - 自定义的 `pagePerformance.isSlowPage` 函数执行抛异常
   - 检查 `isSlowPage` 函数实现

4. **`Unknown platform detected, Aegis initialization stopped`** `[仅小程序]`
   - 小程序 SDK 无法识别当前运行平台（非 wx/my/tt/qq）
   - 检查是否在正确的小程序环境中运行，或通过 `platform` 参数强制指定

---

## 问题 7：构建报错 / TypeScript 类型问题 `[仅 Web]`

### Cannot find module 'aegis-web-sdk'

```bash
# 确认安装
npm install aegis-web-sdk@^1

# 如果是 TypeScript 项目，aegis-web-sdk 自带类型声明，无需额外安装 @types
```

### Module not found (Webpack/Vite)

确认 `node_modules/aegis-web-sdk` 目录存在：
```bash
ls node_modules/aegis-web-sdk
```

如果不存在，删除 `node_modules` 和 `package-lock.json` 后重装：
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## 快速验证清单

接入后按以下步骤验证：

| # | 步骤 | 预期结果 |
|---|------|---------|
| 1 | 启动项目 | 项目正常启动，无构建错误 |
| 2 | 打开 DevTools → Network | 能看到上报请求 |
| 3 | 搜索上报域名 | 找到 `rumt-zh.com`（或对应地域域名）的请求 |
| 4 | 检查请求状态码 | 返回 **200** 或 **204**（204 No Content 也是成功，表示服务器已收到数据） |
| 5 | 触发一个 JS 错误 | Network 中出现新的上报请求 |
| 6 | 等待 2-3 分钟 | RUM 控制台中出现数据 |
| 7 | 点击控制台中的"异常分析" | 能看到刚才触发的错误 |

### 快速触发测试错误

在浏览器控制台执行：
```javascript
// 触发一个 JS 错误（SDK 会自动捕获）
setTimeout(() => { throw new Error('RUM SDK 接入测试'); }, 100);
```

等待几秒后在 Network 中搜索上报域名，确认有新请求发出。
