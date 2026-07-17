# 错误处理速查表

| 场景 | 处理方式 |
|------|----------|
| tencent-news-cli 未安装 | 自动 fallback 到纯 web_search 模式，推送末尾附安装提醒 |
| tencent-news-cli 返回 API Key 错误 | 提示用户运行 `tencent-news-cli apikey-set <KEY>` |
| tencent-news-cli 返回为空 | 对该维度 fallback 到 web_search 补充 |
| web_search 无结果 | 放宽搜索关键词，或提示用户稍后再试 |
| 搜索到的新闻相关性都很低 | 扩展搜索维度或降低筛选标准 |
| 用户说"换一批"但搜不到新内容 | 输出"暂时没有更多相关内容"提示 |
| 画像文件损坏 | 使用 `--reset-profile` 重建 |
