# 安装 TCCLI

**前提**：系统已安装 Python 2.7+ 与 pip。TCCLI 依赖 TencentCloudApi Python SDK，安装时会自动处理依赖。

**安装方式**：

```sh
# 方式一：pip（推荐，Windows / Mac / Linux 通用）
pip install tccli

# 若从 3.0.252.3 以下版本升级，需先卸载再装：
# pip uninstall tccli jmespath && pip install tccli

# 方式二：macOS Homebrew
brew tap tencentcloud/tccli
brew install tccli
# 更新：brew upgrade tccli

# 方式三：源码安装
# git clone https://github.com/TencentCloud/tencentcloud-cli.git && cd tencentcloud-cli && python setup.py install
```

验证安装：

```sh
tccli --version
```
