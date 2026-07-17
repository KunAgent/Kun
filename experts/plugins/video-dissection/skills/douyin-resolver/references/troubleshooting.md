# 故障排查

| 问题 | 解决 |
|------|------|
| Level 1 返回 404 | URL 过期，自动降级到 Level 2 |
| Level 2 未找到视频流 | 可能需要登录抖音，或视频已被删除 |
| ffmpeg 未找到 | 安装 ffmpeg（Mac: `brew install ffmpeg`） |
| Playwright 未安装 | `npm install playwright` |
| yt-dlp 未安装 | `pip install yt-dlp` 或 `brew install yt-dlp` |
| 硅基流动 429 | API 调用限流，等 1 分钟再试 |
| 音频 >25MB | 建议用更短的视频 |
