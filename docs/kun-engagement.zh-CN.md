# 服务端活动票据

Code 用户任务和 Agent 对话在运行时记录开始、完成/失败/取消事件。
Electron 主进程同步活动队列，开始时领票，结束后核销。窗口动画仅由服务端回执驱动。
后台续跑、子代理、失败或取消活动不参与抽取；任何认证/网络错误不阻塞任务。

## 本地责任

- `kun/src/rooms/engagement/`：SQLite 持久 outbox，开始身份、票据、终态、回执去重。
- `src/main/engagement/`：账号令牌或游客凭据、领票、响应丢失查询、离线补报。
- `src/main/kun-account/wardrobe-sync.ts`：库存与外观镜像、开瓶等原有账号操作。
- `kun/src/contracts/kun-engagement.ts`：服务端进度数据。
- `kun/src/test-support/`：旧随机模拟器只供测试，不参与产品运行。

活动中的本地上下文（标题、房间、任务）不上传。远程 runId 使用 SHA-256 产生不含正文的标识。
游客凭据位于 userData/kun-account/engagement-guest.v1.json，仅主进程访问，目录 0700、文件 0600。
游客凭据有效 30 天；过期会生成新身份，旧票据和计数不转移。

outbox 以申请时身份绑定；切换账号会停止旧主体上报。切回原账号可核销仍有效的原票据。
主进程刷新 30 秒身份租约，未获得身份的开始事件不参与；离线使用应用仍正常。
有开始记录但没有票据的活动完成后只查询已发票据，不能事后补领。
只有 claim 已持久化、且任务仍在运行时才能发起领票。
票据/回执的网络响应丢失会重试。SQLite 同事务写入回执状态、库存和通知，因此不会重复动画。
库存响应另带服务器 revision，迟到的旧快照不能覆盖新库存。

缓存服务端 progress 供额度、保底、开瓶数量、价格和重置时间展示。离线时它代表最后一次服务器快照。
本地不改变服务端计数、不产生离线奖励。旧的无票据 activity 队列不会补造票据。

## 验证

- Runtime：`cd kun && node node_modules/vitest/vitest.mjs run src/rooms/engagement/queue.test.ts`
- Main：`npx vitest run src/main/engagement/service.test.ts`
- 线上游客全链路（显式开启；只创建游客，不创建真实奖励）：
  `KUN_ENGAGEMENT_LIVE=1 NODE_USE_ENV_PROXY=1 npx vitest run src/main/engagement/live.test.ts`
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`
- `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
- `npm run check:file-lines`

Kunserve 已上线新接口；旧 `/api/wardrobe/activity` 返回 426，已有资产仍可读取和打开。
客户端改动仅提交本地 develop，不推送，不发布官网。
