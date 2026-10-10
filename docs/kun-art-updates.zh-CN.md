# Kun 2D 美术资源热更新

## 已实现

- 账号资源接口：`https://api-kun-server.com/api/assets/releases/latest?channel=stable&appVersion=0.3.10&schemaVersion=1`。
- R2 桶 `deepseek-gui` 的独立 `kun-art/v1/` 前缀；不修改安装包发布目录。
- 下载地址由固定 Kunserve 域名提供：`/art/releases/<id>.json`、`/art/objects/<sha256>.webp`。
- Worker 使用 R2 binding 读取，边缘缓存不可变文件；客户端不持有 R2 凭据。
- Ed25519 签名覆盖完整目录、渲染参数及文件 SHA-256、尺寸、字节数。
- 仅登录用户可查询版本、下载清单和资源，所有请求先验证用户，再读取内部缓存；响应为 private, no-store。
- 主进程下载和验证，renderer 通过 `kun-asset://<release>/<logical-path>` 访问清单内的图片。
- 启动后台检查，成功后每 30 分钟检查，失败后每分钟重试；衣橱可手动检查。
- 四路下载，仅补齐缺失或损坏的文件；同一版本的目录和图片一起切换。
- 保留安装包全部原有资源作为离线兜底，以及已激活版本和上一版本。
- 主进程原子替换 `active.json`，中断、校验失败、磁盘写入失败不启用半成品。
- 衣橱的“回退资源”退回上版（第一版退回内置资源），并暂停自动更新；“检查更新”恢复更新。
- 运行时和 renderer 同步加载展示目录；账号拥有、兑换、掉落仍由服务端裁定。

## 本地布局

`app.getPath('userData')/art-assets/` 下有 `objects/`、`manifests/`、`staging/`、`active.json`。
签名公钥在 `src/main/art-assets/public-key.ts`；签名私钥不在仓库中。
首次发布的私钥保存在操作者机器的 `~/.config/kun-art-release/signing-key.pem`，权限 0600。
需要在团队秘密管理系统单独备份私钥。新增验证公钥需要先发布支持该公钥的客户端。

当前协议限制单文件 8 MiB、清单 2 MiB、每版最多 5000 文件、总文件大小 100 MiB。
只允许静态 WebP 和结构化展示目录；不能通过这个通道运行脚本或安装可执行代码。
文件读取时再次检查哈希，启动时重新核验签名和全部文件。

## 发布流程

在应用仓库执行（输出目录已被 Git 忽略）：

```sh
node scripts/export-kun-wardrobe-catalog.mjs --out .art-release/economy.json
node scripts/build-art-release.mjs \
  --release art-YYYYMMDD-vN \
  --key "$HOME/.config/kun-art-release/signing-key.pem" \
  --out .art-release/art-YYYYMMDD-vN \
  --catalog .art-release/economy.json
node scripts/publish-art-release.mjs \
  .art-release/art-YYYYMMDD-vN /absolute/path/to/r2-credentials.env
```

首次运行先创建 `.art-release/`。上传器使用 S3_BUCKET、S3_ENDPOINT、S3_ACCESS_KEY_ID、
S3_SECRET_ACCESS_KEY；可选 HTTPS_PROXY。凭据文件放在忽略提交的位置。
上传器只创建不存在的对象，并读回核验；相同路径不同内容会拒绝覆盖。

1. 更新制作源、图片及 TypeScript 默认目录，使用既有美术检查流程。
2. 构建、签名、上传，通过图像解码及所有对象读回校验。
3. 在 Supabase SQL 控制台执行生成的 `register.sql`，登记草稿。
4. 新增可收集装扮时，先准备与 `catalogVersion` 对应的服务端衣橱目录迁移。
   图片已上传后，在受控事务中完成目录发布及渠道推广，避免未备齐图片就发放新装备。
5. `select art.promote('beta', '<release-id>');` 验证兼容版本、图片和目录。
6. `select art.promote('stable', '<release-id>');` 正式发布。客户端默认只检查 stable。

同一资源 ID 的图片可以替换；新增装扮可以沿用当前槽位、分层、遮挡和裁剪能力。
新渲染能力仍需要客户端版本升级。不要删除已存在的衣橱 ID；过时商品通过服务端下架。
发布记录和推广操作只有运营角色可写，客户端仅能读已发布目录。

## 回滚

服务端：`select art.promote('stable', '<previous-release-id>');`。
渠道顺序就是更新目标，因此允许返回旧版，不能用版本字符串大小阻止运营回滚。
如果要停用某个问题版本，应从渠道候选列表移除它，防止兼容性筛选回落到该版本。
资源文件不可变；不要覆盖旧 manifest 或删除仍被旧客户端引用的对象。

客户端：衣橱“回退资源”。此操作不改变用户装扮所有权、账号会话或任何任务数据。
启动发现当前缓存损坏时，会恢复有效上版；若上版也损坏则使用内置资源。
不支持新渲染协议的客户端继续使用兼容版本。

## 验证

```sh
npx vitest run src/main/art-assets/service.test.ts src/renderer/src/components/rooms/art-assets.test.ts
node scripts/smoke-art-release.mjs
npm run typecheck
npm run build
npm run check:file-lines
```

生产 smoke 使用隔离的临时缓存，验证真实全量下载、未变更零下载、离线重启及回滚，不读取账号凭据。
Node 代理环境可使用 Node 支持的 `NODE_USE_ENV_PROXY=1` 和 `HTTPS_PROXY`；应用使用 Electron 网络栈。

## 未登录体验

未登录使用内置默认形象。所有个人换装（包括随机、恢复、上传头像）会引导登录，运行时也拒绝匿名写入。
游客对话/任务按原有概率、间隔、每日上限产生漂流瓶体验提示，文案明确说明登录后有机会掉落瓶子并抽取装备或角色卡；
提示不创建可打开的瓶子、不发装备、角色或羽毛，登录后不补发游客提示。
退出或切换账号会终止资源请求、屏蔽本地热更新资源读取，并切回内置资源；重新登录后复用已验证缓存。
生产下载 smoke 现在需要从安全环境提供 KUN_ART_ACCESS_TOKEN，不应将令牌写入日志或仓库。
