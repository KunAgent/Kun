# Aladin Test Design

[TODO: 一句话描述]

## 类型

Agent 型（单个 AI 专家）

## 功能

[TODO: 详细功能说明]

## 使用示例

- [TODO: 示例提示词1]
- [TODO: 示例提示词2]
- [TODO: 示例提示词3]

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 安装

将专家包目录放到以下路径：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/aladin-test-design/
```

然后运行注册命令使其在 WorkBuddy 中可见：

```bash
python3 scripts/register_expert.py ~/.workbuddy/plugins/marketplaces/my-experts/plugins/aladin-test-design/
```

## 打包分享

```bash
zip -r aladin-test-design.zip aladin-test-design/
```
