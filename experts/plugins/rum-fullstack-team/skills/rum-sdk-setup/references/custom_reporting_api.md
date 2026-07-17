# 自定义上报 API 参考

本文档详细说明所有 Aegis SDK 通用的自定义上报方法（继承自 aegis-core，适用于 Web、小程序、React Native、Node.js 等所有平台）。

---

## aegis.reportEvent(name | options)

**用途**：上报自定义事件，用于统计用户行为（如按钮点击、页面曝光）。

### 基本用法

```javascript
// 简单用法：只传事件名
aegis.reportEvent('点击购买按钮');

// 带参数用法
aegis.reportEvent({
  name: '点击购买按钮',
  ext1: '商品类型:数码',
  ext2: '用户来源:搜索',
  ext3: '是否会员:是',
});
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | String | 是 | 事件名称 |
| `ext1` | String | 否 | 扩展字段 1（限长 1024 字节） |
| `ext2` | String | 否 | 扩展字段 2 |
| `ext3` | String | 否 | 扩展字段 3 |

### 使用场景
- 统计按钮点击率
- 统计功能使用率
- A/B 测试曝光打点
- 业务转化漏斗

---

## aegis.reportTime(name | options, duration?)

**用途**：上报自定义测速数据，用于监控业务操作耗时。

### 基本用法

```javascript
// 直接上报已知耗时
aegis.reportTime('首页渲染完成', 1500);

// 带参数用法
aegis.reportTime({
  name: '接口聚合耗时',
  duration: 2300,
  ext1: '接口数量:5',
  ext2: '是否命中缓存:否',
});
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | String | 是 | 测速名称 |
| `duration` | Number | 是 | 耗时（毫秒） |
| `ext1` | String | 否 | 扩展字段 |
| `ext2` | String | 否 | 扩展字段 |
| `ext3` | String | 否 | 扩展字段 |

---

## aegis.time(name) / aegis.timeEnd(name)

**用途**：计时器，计算两个时间点之间的耗时并自动上报。

### 基本用法

```javascript
// 开始计时
aegis.time('数据加载');

// ... 执行异步操作
await fetchData();

// 结束计时（自动上报耗时）
aegis.timeEnd('数据加载');
```

### 注意
- `time` 和 `timeEnd` 的 `name` 必须一致
- 调用 `timeEnd` 时会自动计算差值并上报
- 如果只调用了 `time` 没有调用 `timeEnd`，数据不会上报

---

## aegis.error(error)

**用途**：主动上报一个错误。

### 基本用法

```javascript
// 上报 Error 对象
aegis.error(new Error('支付流程异常'));

// 上报字符串
aegis.error('用户鉴权失败');

// 在 try-catch 中上报
try {
  riskyOperation();
} catch (e) {
  aegis.error(e);
}
```

### 使用场景
- catch 到的业务异常
- 框架 errorHandler 中转发错误（如 Vue.config.errorHandler）
- 自定义的业务告警

---

## aegis.info(msg) / aegis.infoAll(msg)

**用途**：上报信息级别日志。

### 区别

| 方法 | 上报条件 | 数据量 |
|------|---------|--------|
| `info(msg)` | 仅当用户在**白名单**内或页面发生错误时才上报 | 小 |
| `infoAll(msg)` | **所有用户**都上报 | 大 |

### 基本用法

```javascript
// 仅白名单用户上报
aegis.info('用户进入结算页面');

// 所有用户都上报（注意数据量）
aegis.infoAll('应用版本: v2.3.1');
```

### 注意
- `info` 适合记录详细的用户操作路径（只有出问题时才回溯）
- `infoAll` 适合记录关键节点信息（如版本号、配置状态），但要控制频率

---

## aegis.report(options)

**用途**：通用上报方法，可自定义日志类型和扩展字段。

### 基本用法

```javascript
aegis.report({
  msg: '自定义消息内容',
  level: Aegis.logType.INFO,      // 日志级别
  ext1: '扩展字段1',
  ext2: '扩展字段2',
  ext3: '扩展字段3',
});
```

### 可用的 logType

| 类型 | 值 | 说明 |
|------|-----|------|
| `Aegis.logType.INFO_ALL` | `-1` | 全量信息日志（所有用户都上报，发送前转成 INFO） |
| `Aegis.logType.API_RESPONSE` | `1` | API 响应（白名单可见） |
| `Aegis.logType.INFO` | `2` | 普通信息（白名单可见） |
| `Aegis.logType.ERROR` | `4` | JS 错误 |
| `Aegis.logType.PROMISE_ERROR` | `8` | Promise 错误 |
| `Aegis.logType.AJAX_ERROR` | `16` | Ajax 请求错误 |
| `Aegis.logType.SCRIPT_ERROR` | `32` | 脚本加载错误 |
| `Aegis.logType.IMAGE_ERROR` | `64` | 图片加载错误 |
| `Aegis.logType.CSS_ERROR` | `128` | CSS 加载错误 |
| `Aegis.logType.CONSOLE_ERROR` | `256` | Console error |
| `Aegis.logType.MEDIA_ERROR` | `512` | 音视频加载错误 |
| `Aegis.logType.RET_ERROR` | `1024` | 接口返回码错误 |
| `Aegis.logType.REPORT` | `2048` | 自定义上报（默认值，触发告警但不扣分） |
| `Aegis.logType.PAGE_NOT_FOUND_ERROR` | `16384` | 页面不存在错误（仅小程序） |
| `Aegis.logType.WEBSOCKET_ERROR` | `32768` | WebSocket 错误（Web / 小程序） |
| `Aegis.logType.BRIDGE_ERROR` | `65536` | Bridge 错误（Hippy） |
| `Aegis.logType.LAZY_LOAD_ERROR` | `131072` | 异步组件懒加载失败（仅小程序） |

---

## aegis.setConfig(config)

**用途**：动态修改实例配置。

### 基本用法

```javascript
// 登录后更新用户标识
aegis.setConfig({
  uin: 'user_12345',
});

// 切换环境
aegis.setConfig({
  env: Aegis.environment.gray,
});
```

### 使用场景
- 用户登录后设置 `uin`
- 动态切换环境配置
- 运行时调整上报策略

---

## aegis.destroy()

**用途**：销毁 SDK 实例，停止所有数据上报。

### 基本用法

```javascript
// 在组件卸载或页面销毁时调用
aegis.destroy();
```

### 使用场景
- SPA 中某个页面不需要监控时
- 测试环境手动停止上报
- 用户退出登录后停止监控

---

## 实战示例：电商应用完整埋点

```typescript
import Aegis from 'aegis-web-sdk'; // 或 aegis-mp-sdk / aegis-rn-sdk 等
import aegis from './rum';

// ============================================================
// 1. 动态配置：登录后绑定用户身份
// ============================================================
function onLoginSuccess(user: { id: string; vipLevel: string }) {
  aegis.setConfig({
    uin: user.id,
    ext1: `VIP:${user.vipLevel}`,
  });
}

// ============================================================
// 2. 信息日志：记录关键节点（用于问题回溯）
// ============================================================

// info：仅白名单用户上报，适合详细操作路径
aegis.info('用户进入商品详情页');
aegis.info(`当前商品ID: ${productId}, 来源: ${referrer}`);

// infoAll：所有用户都上报，适合关键版本/配置信息（注意数据量）
aegis.infoAll(`应用版本: v2.3.1, 构建时间: ${BUILD_TIME}`);

// ============================================================
// 3. 自定义事件：统计用户行为
// ============================================================

// 简单事件
aegis.reportEvent('商品详情页曝光');

// 带维度的事件（用于多维分析）
aegis.reportEvent({
  name: '点击购买按钮',
  ext1: `商品类型:数码`,
  ext2: `价格区间:1000-5000`,
  ext3: `是否会员:是`,
});

// A/B 实验曝光
aegis.reportEvent({
  name: 'AB实验曝光',
  ext1: `实验:新结算流程`,
  ext2: `分组:实验组`,
});

// ============================================================
// 4. 自定义测速：监控业务操作耗时
// ============================================================

// 方式一：已知耗时直接上报
const start = Date.now();
const recommendations = await fetchRecommendations();
aegis.reportTime('推荐接口耗时', Date.now() - start);

// 带维度的测速
aegis.reportTime({
  name: '首页数据加载',
  duration: 1200,
  ext1: '接口数量:5',
  ext2: '是否命中缓存:否',
});

// 方式二：计时器（适合跨异步操作）
aegis.time('下单流程');
try {
  await createOrder(cartItems);
  aegis.timeEnd('下单流程');
} catch (e) {
  aegis.timeEnd('下单流程'); // 失败也要结束计时，否则数据不会上报
  aegis.error(e);
}

// ============================================================
// 5. 错误上报：主动捕获业务异常
// ============================================================

// 上报 Error 对象
try {
  await processPayment(orderId);
} catch (e) {
  aegis.error(e); // 自动提取 message + stack
}

// 上报字符串错误
if (!token) {
  aegis.error('用户鉴权失败：token 为空');
}

// ============================================================
// 6. 通用上报：自定义日志类型（用于精细化告警分类）
// ============================================================

// 默认 level 为 REPORT（触发告警但不扣分）
aegis.report({
  msg: '库存不足，自动降级为预售模式',
  ext1: `商品ID:${productId}`,
});

// 指定为 ERROR 级别（会计入错误率、影响健康分）
aegis.report({
  msg: '支付回调签名校验失败',
  level: Aegis.logType.ERROR,
  ext1: `订单号:${orderId}`,
  ext2: `渠道:微信支付`,
});

// 指定为 INFO 级别（白名单可见，不触发告警）
aegis.report({
  msg: `降级策略触发: ${fallbackReason}`,
  level: Aegis.logType.INFO,
  ext1: `模块:推荐系统`,
});

// ============================================================
// 7. 销毁实例：退出登录 / 页面卸载时清理
// ============================================================
function onLogout() {
  aegis.destroy();
}
```
