# 错误恢复

## 命令不存在

```bash
command -v ihr-cli
```

不存在时读取 `cli-install-auth.md`，按当前在线文档重新确认安装入口。
安装后执行 `command -v ihr-cli` 与 `ls -l "$(command -v ihr-cli)"` 确认路径。

## 未登录或 token 失效

先检查：

```bash
ihr-cli auth status
ihr-cli auth verify
ihr-cli config show
```

然后使用：

```bash
ihr-cli auth login --api-token-stdin
```

不要重复重试失败的业务命令。

## base URL 或环境错误

检查：

```bash
test -n "${IHR360_BASE_URL:-}"
test -n "${IHR360_API_TOKEN:-}"
ihr-cli baseurl
ihr-cli config show
```

`IHR360_BASE_URL` 或 `IHR360_API_TOKEN` 缺失时停止执行并向用户索取；用户未明确提供时，不要猜测生产或非生产环境地址。

## 参数错误

先查当前 help：

```bash
ihr-cli <domain> --help
ihr-cli <domain> +<verb> --help
```

只基于 help 修正一次。仍失败时，读取当前在线文档或向用户报告缺少的信息。

## 文档脚本失败

如果 `extract_ihr_docs.py` 无法解析页面：

1. 用浏览器查看 `https://hrclaw-docs.ihr360.com/` 首页。
2. 找到当前静态资源路径。
3. 如果站点结构已变化，说明脚本需要更新。
4. 不要继续依赖旧 bundle hash。
