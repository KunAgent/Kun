# 安装、配置和登录

用于用户要求安装、初始化、登录、检查状态、配置 base URL 或修复认证问题时。

## 检查 CLI

```bash
command -v ihr-cli
ihr-cli version
ihr-cli status
```

如果命令不存在，或当前版本落后于发布端最新版，按当前在线文档重新确认安装方式。当前默认安装策略是**安装最新版**，不要固定到某个历史版本号。

非交互环境必须使用 `--yes`，避免安装脚本读取 `/dev/tty` 后超时：

```bash
curl --http1.1 -fsSL https://cdn-txtoqiniu.ihr360.com/ihr-cli/install.sh | bash -s -- --yes
```

不要使用 `/temporary-resume/ihr-cli/v.../install.sh` 这类固定版本路径，也不要给安装脚本传 `--version ...`。安装入口会解析当前最新版。

使用 CLI 前检查是否有更新：

```bash
curl --http1.1 -fsSL https://cdn-txtoqiniu.ihr360.com/ihr-cli/latest.json
ihr-cli version
```

如果本机版本落后，继续使用上面的最新版安装命令覆盖安装。不要使用不存在或未确认的 `ihr-cli update` 命令。

安装后必须确认二进制路径：

```bash
command -v ihr-cli
ls -l "$(command -v ihr-cli)"
ihr-cli version
```

## 配置环境

先检查 `IHR360_BASE_URL` 与 `IHR360_API_TOKEN`。只要任一缺失，停止执行并向用户索取，不要默认降级。

用户提供 `IHR360_BASE_URL` 后再配置：

```bash
ihr-cli config init --base-url "$IHR360_BASE_URL" || ihr-cli baseurl "$IHR360_BASE_URL"
ihr-cli config show
```

不要自行猜测生产或非生产环境地址；用户明确提供或当前文档说明后再配置。

## 登录

如果需要用户提供 API Token，提示用户按这个路径获取：

```text
登录 i人事 https://v5.ihr360.com，点击右上角用户信息，在下拉菜单中选择“服务身份凭证”，复制服务身份凭证中的 API Token。
```

不要提示用户进入“个人设置 -> API Token”或“开放平台”；这不是当前正确路径。

推荐使用 stdin 登录，避免 token 留在 shell history：

```bash
printf '%s' "$IHR360_API_TOKEN" | ihr-cli auth login --api-token-stdin
```

用户明确要求直接登录时才使用：

```bash
ihr-cli login sk-xxxxx
```

不要在最终回答中回显 token。

## 验证

```bash
ihr-cli auth status
ihr-cli auth verify
```

认证失败时先检查 base URL、token 是否过期、token 是否属于当前租户或环境，再重试业务命令。
`auth verify` 通过只代表认证可用，不代表业务接口通过。后续仍要对目标业务接口执行 live `ihr-cli interface +get/+post` 调用，并确认返回非空业务数据。

## 基础命令

```bash
ihr-cli --help
ihr-cli version
ihr-cli status
ihr-cli config show
ihr-cli baseurl
ihr-cli auth status
ihr-cli auth verify
ihr-cli logout
```
