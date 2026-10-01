## ADDED Requirements

### Requirement: Shared Agent identity icons
所有 ADE Agent 展示 SHALL 通过稳定 harness ID 使用同一个品牌解析器，Agent 图标与模型供应商品牌分别表达。

#### Scenario: One Agent across multiple surfaces
- **WHEN** 同一 Agent 出现在 composer、列表、worker、任务总览和手机上
- **THEN** 使用一致的品牌身份，不能有的显示正确图标而有的回落通用机器人

### Requirement: Offline bundled brand assets
内置 Agent 图标 SHALL 使用有来源记录的本地资源，支持明暗主题和高分屏，不依赖运行时在线 favicon。

#### Scenario: Offline startup
- **WHEN** 应用离线打开 Agent 选择器
- **THEN** 已支持的内置图标完整显示，无外网请求或破图

### Requirement: Neutral fallback without false branding
未知、自定义或加载失败的 Agent 图标 SHALL 使用中性回退，不能默认冒充另一个内置 Agent。

#### Scenario: Unknown Agent identity
- **WHEN** 历史条目的 Agent ID 尚未解析或本地资源损坏
- **THEN** 名称和中性图标保持可读，原身份不变且布局不跳动

### Requirement: User-facing source and status labels
Agent 菜单 SHALL 使用本地化状态/来源摘要，不直接显示 credentialMode 或内部 transport 标识。

#### Scenario: Available native-login Agent
- **WHEN** Agent 使用已确认的本机账号
- **THEN** 副标题显示用户可理解的账号/来源状态，不显示 `native-login` 或枚举 join

### Requirement: Unavailable rows retain repair actions
未就绪条目 SHALL 只禁止不合法的选择动作，保留可点击和键盘可达的安装、登录、检测或修复入口。

#### Scenario: Missing installation
- **WHEN** 条目显示未找到程序
- **THEN** 用户可打开安装/指定路径流程，原因文字保持可读，不把整行及其恢复操作全部 disabled

### Requirement: Identity and activity indicators are separate
加载和失败状态 SHALL 使用独立状态槽，不替换品牌身份；颜色不得成为唯一提示。

#### Scenario: Probe starts while picker is open
- **WHEN** 已显示 Agent 开始重新探测
- **THEN** 品牌图标和名称保持稳定，另显示加载及文本，焦点和行高不跳动
