# 觅诊

调用 `med-agent-proxy` 的单 Agent 型医疗健康咨询专家。

## 类型

Agent 型（单个 AI 专家）

## 功能

觅诊专家用于承接医疗健康、就医指引、科室匹配、用药咨询、检查体检、医院医生查询、医保定点和疫苗等问题。专家启动后预加载 `med-agent-proxy` skill，将用户原始 query 透传给觅诊服务，并按返回结果原样回复。

## 使用示例

- 我想咨询一个健康或就医相关问题，请帮我转给觅诊服务回答。
- 请帮我问问这些症状应该挂哪个科。
- 请帮我咨询一下用药方法和注意事项。

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 安装

将专家包目录放到以下路径：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/mi-zhen-expert/
```

然后运行注册命令使其在 WorkBuddy 中可见：

```bash
python3 scripts/register_expert.py ~/.workbuddy/plugins/marketplaces/my-experts/plugins/mi-zhen-expert/
```

## 打包分享

```bash
python3 /Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/builtin-skills/expert-manager/scripts/package_expert.py ~/.workbuddy/plugins/marketplaces/my-experts/plugins/mi-zhen-expert
```
