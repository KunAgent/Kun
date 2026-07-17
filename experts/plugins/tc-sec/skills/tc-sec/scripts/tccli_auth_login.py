#!/usr/bin/env python3
"""OAuth 登录入口。

tccli auth login 是交互式登录，必须直接以原生 tccli 在用户当前环境前台
执行：继承标准输入输出让 tccli 的授权提示原样透传给用户（具体授权方式由
tccli 决定，不预设）、不设置隔离 HOME（凭据要写回真实 ~/.tccli/ 才能被后续
tccli_cli.py 调用读取）、不抑制日志输出。因此本脚本不走 tccli_cli.py 包装器。

不 sys.exit，始终输出合法 JSON。
"""

import json
import os
import subprocess
import sys

import base


def _cred_path():
    return os.path.join(base.real_home(), ".tccli", "default.credential")


def _check_creds():
    p = _cred_path()
    if not os.path.exists(p):
        return False, "credential 文件不存在"
    try:
        with open(p) as f:
            data = json.load(f)
    except Exception as e:
        return False, f"credential 文件解析失败: {e}"
    has_ak = bool(data.get("secretId") and data.get("secretKey"))
    has_token = bool(data.get("token") or data.get("Token") or data.get("appToken"))
    if has_ak or has_token:
        return True, ""
    return False, "credential 文件无可用凭据字段"


def main():
    tccli_bin = base.tccli()
    if not tccli_bin:
        # 未安装则自动执行 pip install tccli（代码逻辑安装，非仅提示）。
        ok, msg = base.ensure_tccli_installed()
        if not ok:
            print(json.dumps({"status": "not_installed",
                              "auto_installed": False,
                              "message": f"已尝试自动执行 pip install tccli 但未能完成安装。{msg}"},
                             ensure_ascii=False))
            return
        tccli_bin = base.tccli()
        if not tccli_bin:
            print(json.dumps({"status": "not_installed",
                              "auto_installed": True,
                              "message": "tccli 已安装但当前终端未识别到，请新开终端后重试 OAuth 登录。"},
                             ensure_ascii=False))
            return

    print("[OAuth 登录] 即将执行 `tccli auth login`，请按 tccli 提示完成授权。",
          file=sys.stderr)
    try:
        code = subprocess.run([tccli_bin, "auth", "login"]).returncode
    except KeyboardInterrupt:
        print(json.dumps({"status": "cancelled", "message": "用户中断了 OAuth 登录。"},
                         ensure_ascii=False))
        return
    except Exception as e:
        print(json.dumps({"status": "error",
                          "message": f"执行 tccli auth login 失败: {e}"}, ensure_ascii=False))
        return

    if code != 0:
        print(json.dumps({"status": "failed", "returncode": code,
                          "message": f"tccli auth login 退出码 {code}，登录未成功。"},
                         ensure_ascii=False))
        return

    ok, msg = _check_creds()
    if ok:
        print(json.dumps({"status": "ok",
                          "message": "OAuth 登录成功，凭据已写入 ~/.tccli/，可正常调用腾讯云 API。"},
                         ensure_ascii=False))
    else:
        print(json.dumps({"status": "unknown",
                          "message": f"tccli auth login 已退出但未检测到凭据（{msg}）。请确认授权已完成，或改用 tccli configure 配置 AK。"},
                         ensure_ascii=False))


if __name__ == "__main__":
    main()
