# Kun 头像统一：一个方形头像，到处都一样

> 更新：2026-10-08。状态：已实现，见第 8 节。
> 设计稿：https://claude.ai/artifact/MfduEGkMqoLaQGovrUYNRz 的“0 头像一致性（方形头像）”画板（私有链接，需在画布 Share 菜单共享后他人才能打开）。其余画板已换成 v2 修复后的素材。
> 相关：`docs/kun-avatar-art-plan-v2.zh-CN.md`（美术）、`docs/kun-avatar-layered-assets-plan.zh-CN.md`（分层合成）。

## 1. 目标

1. **一种形状。** Agent、自己、群成员在所有会话界面都显示为圆角方形。小尺寸不再裁成圆形，和换装弹窗舞台、Agent 档案里的大头像保持同一个样子。
2. **一种取景。** 28px 及以上显示全身像（和编辑器里看到的一样，包括道具）；只有小于 28px 的头像（@ 提及、输入框上下文、群聊拼图的成员格）才按脸部裁切。
3. **改了就同步。** 保存头像后 0.5 秒内，侧栏会话行、私聊标题、群聊标题拼图、消息头像、@ 提及、成员列表、手机端会话行都更新，不需要切换会话或等待轮询。

不在本次范围：头像编辑流程本身、掉落与收集玩法（见 `docs/kun-avatar-wardrobe-design.zh-CN.md`）、美术素材本身。

## 2. 现状（develop `352c68951`）

### 2.1 形状与取景

`RoomAvatar` 以 48px 为界：≤48px 加 `data-compact`，CSS 裁成圆形；组合头像按 `compactFaceBox [200,236,824,860]` 裁到脸部，道具和抓握翅膀省略，四顶帽子换小尺寸版。>48px 是 0.8rem 圆角方形的全身像。另有 6 处 CSS 再强制 `border-radius: 50%`：

| 文件 | 位置 |
| --- | --- |
| `components/chat/sidebar-agent-chats.css` | 侧栏私聊行 |
| `components/rooms/rooms-chat-surface.css` | 会话标题栏、消息行（两条） |
| `components/rooms/conversation-info.css` | 会话信息板 |
| `components/rooms/conversation-manage.css` | 删除会话确认框 |
| `components/rooms/rooms-init-im.css` | 旧版会话侧栏 |

侧栏底部 Kun 状态（`SidebarKunFooter`）单独用 `.ds-sidebar-kun-face` 裁成圆形并放大 1.25 倍。编码 Agent（Codex、Claude Code 等）的引擎图标已经是 28% 圆角方形。

### 2.2 各处头像的数据来源与刷新

| 位置 | 组件 | 尺寸 | 数据来源 | Agent 改头像后 |
| --- | --- | --- | --- | --- |
| 侧栏私聊行 | `SidebarAgentChatRow` | 34 | 侧栏查询，读 Agent 档案 | 正常，`agent.*` 事件触发刷新 |
| 侧栏群聊拼图 | `RoomAvatarGroup` | 34 | 侧栏查询，`room.members` 原始快照 | **不更新**：成员头像是加入群聊时写进房间文档的副本 |
| 私聊标题、私聊消息 | `RoomDirectChat` | 36 / 38 | `/direct` 详情，`present()` 已用 Agent 档案回填 | 正常，80ms |
| 群聊标题拼图、群聊消息、@ 提及、成员面板 | `RoomHeader` / `RoomMessageRow` / `RoomRichInput` | 30 / 38 / 18 | `useRooms` 会话详情（`present()` 回填） | **延迟**：`agent.updated` 事件挂在 `agent-directory` 名下，被 `event.roomId !== selectedId` 过滤；要等 30 秒兜底轮询 |
| 手机端会话行 | `MobileRoomRow` | 48 | 同侧栏查询 | 群聊同上，不更新 |
| Agent 档案、信息板 | `AgentDetails` / `AgentInfoBoard` | 64 / 72 | Agent 资源，`agent.*` 刷新 | 正常 |

## 3. 设计规则

### 3.1 形状

- 所有 `RoomAvatar` 一律圆角方形：圆角 = 尺寸 × 26%，最小 5px（CSS 变量 `--rooms-avatar-radius`）。常用尺寸：18→5、20→5、28→7、30→8、32→8、34→9、36→9、38→10、48→12、64→17、72→19。
- 编码 Agent 引擎图标沿用同一个圆角变量，不再单独写 28%。
- 1px 内描边：`color-mix(in srgb, var(--ds-text) 10%, transparent)`，用 `::after` 叠在图片上，保证同色背景下方块边界清楚；浅色、深色主题自动适配。
- 没有图片时的身份色底保留（`--rooms-avatar-tone` 10%）。
- 头像外的状态圆点（侧栏“运行中”、Kun 运行状态）仍是圆点，放在方块右下角外侧 3px，带 2px 底色描边。

### 3.2 取景

| 尺寸 | 取景 | 素材细则 | 主要位置 |
| --- | --- | --- | --- |
| <28px | 脸部（`compactFaceBox`） | 省略道具和抓握翅膀；四顶帽子用小尺寸版；加粗眼镜；简化场景 | @ 提及、输入框上下文、群聊拼图成员格 |
| 28–34px | 全身 | 加粗眼镜；简化场景；道具保留 | 成员列表、换装预览、侧栏会话行 |
| 35–48px | 全身 | 简化场景 | 消息、手机会话行 |
| >48px | 全身 | 原版素材 | Agent 档案、信息板 |
| ≥96px 舞台 | 全身 + 稀有度特效 | 只在换装舞台请求 | 换装弹窗 |

取景规则只有一个来源：共享目录新增 `kunAvatarFraming(size)`（`size < 28 ? 'face' : 'portrait'`），`kunAvatarLayerKeys` 的 `framing` 选项默认用它；渲染器、资产检查脚本都调用同一个函数。

旧版 30 张图集头像（`builtin`）同样遵守：脸部取景时放大 1.25 倍，全身取景不放大。上传的照片不裁切，只套方形圆角。

### 3.3 群聊拼图

- 1 人：整块；2 人：两块 66% 方块沿对角线叠放，左上块在重叠处挖出 2px 缝（矩形遮罩，背景无关）；3 人：上 1 下 2；4 人：2×2；5 人以上：3 块 + “+N”。
- 每块按自己的实际尺寸取景（34px 拼图里每格 17–22px，脸部取景）。拼图外框不加底色，整体仍是方形轮廓。

### 3.4 侧栏底部 Kun

保留 Kun 吉祥物图（代表 Kun 运行时，不跟随任何 Agent），改成同规格圆角方形、全身取景，不再放大。

### 3.5 设计稿对照

画布“0 头像一致性”画板演示：同一个 Coder 在侧栏会话行、群聊拼图、私聊标题、消息、@ 提及、成员列表、Agent 档案、换装舞台 8 处的方形头像；点“给 Coder 换一身”三套形象，8 处同时变化；右侧是尺寸/圆角/取景表、34px 改造前后对比和拼图规则。其余画板（换装弹窗、掉落、揭晓、角色卡、手机端、组件规范、工作台外壳）已全部换成 v2 素材：物品图标、6 个表情、6 张场景、漂流瓶、卡背和稀有度特效。

## 4. 同步规则

1. **私聊**：头像唯一来源是 Agent 档案（已是如此）。
2. **群聊会话视图**：`useRooms` 收到 `agent.updated` 时，如果当前会话成员里有 `participantAgentId === payload.id`，按 `room` 部分刷新会话（复用现有 150ms 合并）。
3. **侧栏群聊拼图**：`queryRoomSidebar` 对本页群聊，一次查询取出成员对应的 Agent 档案，用档案里的名字、头像、头衔回填成员，与 `AgentIdentityService.present()` 的规则一致。私聊行逻辑不变。
4. **合成缓存**：缓存键包含素材版本、规范化组合、像素、尺寸、取景和特效；换头像生成新键，旧图按 LRU 释放。

## 5. 实现步骤

| 步骤 | 内容 | 文件 |
| --- | --- | --- |
| S1 | `kunAvatarFraming`；`KunAvatarRenderOptions.framing`；`kunAvatarLayerKeys` 按取景决定省略道具和小帽子 | `kun/src/contracts/kun-avatar-catalog.ts`，测试 |
| S2 | 渲染请求带 `framing`（替换 `compact`），裁切、源图档位、缓存键都按取景 | `room-avatar-compositor.ts`、`room-avatar-composed.ts`，测试 |
| S3 | `RoomAvatar` 计算取景，输出 `data-framing`；拼图成员按格子尺寸渲染 | `RoomAvatar.tsx` |
| S4 | 方形样式；删掉 6 处圆形覆盖；侧栏底部 Kun；“运行中”圆点位置；手机加载骨架 | `rooms-avatars.css` 等 CSS |
| S5 | 群聊会话视图响应 `agent.updated` | `useRooms.ts`，测试 |
| S6 | 侧栏群聊成员用 Agent 档案回填 | `kun/src/rooms/room-sidebar-sqlite.ts`，测试 |
| S7 | 资产检查脚本的小尺寸裁切改用 `kunAvatarFraming` | `scripts/kun-avatar-compose-check.mjs`、`kun-avatar-art-qa.mjs`、`kun-avatar-v2-qa.mjs` |

## 6. 验收

- 单元测试：取景函数边界（27/28）、图层规则（脸部省略道具、全身保留道具、≤34 加粗眼镜、小帽子只在脸部）、渲染请求缓存键区分取景、侧栏群聊成员回填、`useRooms` 收到 Agent 更新后刷新。
- `npm run typecheck`、相关 Vitest、`npm run build:kun`、`npm run check:file-lines`、`git diff --check`。
- 资产检查：`node scripts/kun-avatar-compose-check.mjs --check-only`。
- 目视：设计稿画板与实际界面对照（侧栏、私聊、群聊、手机端），浅色和深色各一次。

## 7. 风险

- 全身像在 34px 下脸比原来的脸部裁切小约 40%，换来的是帽子、衣服、道具都可见、和编辑器一致。若用户觉得太小，回退方式是只调 `kunAvatarFraming` 的阈值，不需要改样式。
- 群聊拼图回填让侧栏查询多一次按 id 的批量读取（每页最多几十个成员），不影响私聊行。
- 资产检查的尺寸对照图（`sizes-*.png`）会随规则变化，是预期结果。

## 8. 实现记录（2026-10-09）

S1–S7 已按第 5 节实现。检查结果：

- Vitest：渲染器 11 个文件 106 项通过（含取景、合成缓存、`useRooms` 的 Agent 更新刷新）；kun 3 个文件 28 项通过（含 `kunAvatarFraming` 边界、侧栏群聊成员回填）。
- `npm run test:avatar-assets` 对应的 `kun-avatar-compose-check.test.mjs` 13 项通过；`node scripts/kun-avatar-compose-check.mjs --check-only` 通过。该命令同时报告的“V2 美术审计 96 个描边距离问题”在未改动的 develop `352c68951` 上数字完全相同，是既有基线，与本次改动无关。
- `npm run typecheck`、`npm run build`（含 `build:kun` 与预加载检查）、`npm run check:file-lines`、`git diff --check` 通过。
- `scripts/smoke-kun-avatar.mjs`：真实组件在桌面/手机、浅色/深色下通过；24px 为脸部取景方块，34/48/96px 为全身方块。
- `scripts/smoke-development-direct-chat.cjs --workbench-only`：Electron 中侧栏私聊行、群聊双人拼图、私聊标题、消息头像、自己的头像、侧栏底部 Kun 均为圆角方形。
- 未单独做“在真实应用里改 Agent 头像后观察群聊刷新”的端到端操作；该路径由 `useRooms` 与侧栏查询的单元测试覆盖。
