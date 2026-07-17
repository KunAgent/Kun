#!/usr/bin/env python3
"""AKSK 本地 Web 配置入口。

仅在 check_all.py 检测到 no_credentials 且用户表达"我有 AKSK 想配置"语义时拉起。
用 Python 标准库 http.server 在 127.0.0.1 起一个临时 web 服务并自动打开浏览器，
用户在浏览器表单中自行填写 SecretId/SecretKey/Region，脚本收到 POST 后**代码直接
写入** ~/.tccli/default.credential 与 default.configure._sys_param.region，
全程密钥不进 argv / stdout / stderr / 访问日志 / shell history / URL。

不 sys.exit，始终输出合法 JSON：
  {"status": "ok"|"cancelled"|"timeout"|"error", "message": "..."}
message 中绝不出现密钥任何片段（SecretId 仅在 ok 时回显前 4/末 4 位用于人工核对）。

安全要点：
  - 监听 127.0.0.1 + OS 随机端口，绝不绑 0.0.0.0；
  - 一次性 token（URL 必须带 token=…）防止本机其他用户/进程访问；
  - 表单 POST 提交，SecretKey 用 type=password；不打 URL 任何参数；
  - log_message 全部静音，不写访问日志；
  - 写文件用 0600 权限（posix）；
  - 提交成功立即 server.shutdown；空闲 10 分钟超时退出。
"""

import http.server
import json
import os
import secrets
import socketserver
import sys
import threading
import urllib.parse
import webbrowser

import base


IDLE_TIMEOUT_SEC = 600


def _cred_path():
    return os.path.join(base.real_home(), ".tccli", "default.credential")


def _conf_path():
    return os.path.join(base.real_home(), ".tccli", "default.configure")


def _load_existing_region():
    try:
        with open(_conf_path(), encoding="utf-8") as f:
            data = json.load(f)
        r = data.get("_sys_param", {}).get("region") or data.get("region")
        if isinstance(r, str) and r:
            return r
    except (OSError, ValueError):
        pass
    return "ap-guangzhou"


def _open_for_write(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if base.is_windows():
        return open(path, "w", encoding="utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    return os.fdopen(fd, "w", encoding="utf-8")


def _write_credential(sid, skey):
    with _open_for_write(_cred_path()) as f:
        json.dump({"secretId": sid, "secretKey": skey}, f, ensure_ascii=False, indent=2)


def _write_region(region):
    path = _conf_path()
    data = {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    sp = data.setdefault("_sys_param", {})
    if not isinstance(sp, dict):
        sp = {}
        data["_sys_param"] = sp
    sp["region"] = region
    with _open_for_write(path) as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


_FORM_HTML = """<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>腾讯云 API 凭据配置</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0;}}
  body{{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;background:#f2f3f5;color:#000000e0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;}}
  .card{{width:100%;max-width:480px;background:#fff;border:1px solid #dcdcdc;}}
  .card-hd{{background:#0052d9;padding:18px 24px;}}
  .card-hd h1{{color:#fff;font-size:15px;font-weight:600;letter-spacing:.02em;}}
  .card-hd p{{color:rgba(255,255,255,.72);font-size:12px;margin-top:3px;}}
  .card-bd{{padding:24px;}}
  .capi-tip{{font-size:12px;color:#00000066;margin-bottom:18px;}}
  .capi-tip a{{color:#0052d9;text-decoration:none;}}
  .capi-tip a:hover{{text-decoration:underline;}}
  .field{{margin-bottom:16px;}}
  .field label{{display:flex;align-items:center;gap:4px;font-size:13px;font-weight:500;color:#000000cc;margin-bottom:6px;}}
  .req{{color:#e34d59;font-size:14px;line-height:1;}}
  .field input{{display:block;width:100%;padding:8px 12px;border:1px solid #dcdcdc;background:#fff;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#000000e0;outline:none;transition:border-color .15s,box-shadow .15s;}}
  .field input::placeholder{{color:#00000040;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;font-size:12px;}}
  .field input:hover{{border-color:#b0b0b0;}}
  .field input:focus{{border-color:#0052d9;box-shadow:0 0 0 2px rgba(0,82,217,.15);}}
  .hint{{font-size:12px;color:#00000066;margin-top:5px;}}
  .divider{{height:1px;background:#e5e5e5;margin:20px 0;}}
  .row{{display:flex;justify-content:flex-end;gap:8px;}}
  .btn{{display:inline-flex;align-items:center;padding:7px 18px;font-size:13px;cursor:pointer;border:1px solid transparent;font-family:inherit;white-space:nowrap;transition:background .15s,border-color .15s;}}
  .btn-ghost{{background:#fff;color:#000000cc;border-color:#dcdcdc;}}
  .btn-ghost:hover{{background:#f2f3f5;border-color:#b0b0b0;}}
  .btn-primary{{background:#0052d9;color:#fff;border-color:#0052d9;}}
  .btn-primary:hover{{background:#0034ab;border-color:#0034ab;}}
  .btn-primary:active{{background:#002a8a;}}
  .err{{color:#e34d59;font-size:12px;margin-top:12px;}}
</style>
</head><body>
<div class="card">
  <div class="card-hd">
    <h1>API 凭据配置</h1>
    <p>腾讯云安全专家 &middot; AKSK 写入本机 ~/.tccli/</p>
  </div>
  <div class="card-bd">
    <form method="POST" action="/submit?token={token}" autocomplete="off">
      <div class="capi-tip">前往 <a href="https://console.cloud.tencent.com/cam/capi" target="_blank" rel="noopener">访问管理 &rsaquo; API 密钥管理</a> 查看或新建密钥</div>
      <div class="field">
        <label>SecretId <span class="req">*</span></label>
        <input type="text" name="sid" required spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="AKIDxxxxxxxxxxxxxxxx">
      </div>
      <div class="field">
        <label>SecretKey <span class="req">*</span></label>
        <input type="password" name="skey" required spellcheck="false" placeholder="输入 SecretKey（不可见）">
      </div>
      <div class="field">
        <label>地域 Region <span class="req">*</span></label>
        <input type="text" name="region" value="{region}" required spellcheck="false" placeholder="ap-guangzhou">
        <div class="hint">常用：ap-guangzhou &nbsp;&middot;&nbsp; ap-shanghai &nbsp;&middot;&nbsp; ap-beijing &nbsp;&middot;&nbsp; ap-hongkong</div>
      </div>
      <div class="divider"></div>
      <div class="row">
        <button type="button" class="btn btn-ghost" onclick="fetch('/cancel?token={token}',{{method:'POST'}}).then(()=>window.close())">取消</button>
        <button type="submit" class="btn btn-primary">保存配置</button>
      </div>
      <div class="err">{err}</div>
    </form>
  </div>
</div>
</body></html>
"""


_DONE_HTML = """<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>配置完成 — 腾讯云</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;background:#f2f3f5;color:#000000e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
  .card{width:100%;max-width:400px;background:#fff;border:1px solid #dcdcdc;text-align:center;}
  .card-hd{background:#2ba471;padding:16px 24px;}
  .card-hd h1{color:#fff;font-size:15px;font-weight:600;}
  .card-bd{padding:32px;}
  .icon{width:48px;height:48px;margin:0 auto 16px;background:#e8f7f0;display:flex;align-items:center;justify-content:center;}
  p{color:#00000099;font-size:13px;line-height:1.65;}
  p code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f2f3f5;padding:1px 6px;font-size:12px;}
  .tip{font-size:12px;color:#00000066;margin-top:10px;}
</style>
</head><body>
<div class="card">
  <div class="card-hd"><h1>凭据配置完成</h1></div>
  <div class="card-bd">
    <div class="icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M5 12.5L10 17.5L19 7.5" stroke="#2BA471" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <p>AKSK 已写入 <code>~/.tccli/</code>，可正常调用腾讯云 API。</p>
    <p class="tip">你可以关闭此页面，回到对话界面继续操作。</p>
  </div>
</div>
</body></html>
"""


def _build_handler(token, initial_region, state, done_event):
    """每次请求都会被实例化为一个 handler；闭包持有共享 state/event。"""

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_a, **_kw):
            pass

        def _check_token(self, parsed):
            qs = urllib.parse.parse_qs(parsed.query)
            return qs.get("token", [""])[0] == token

        def _send_html(self, code, html):
            body = html.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(body)

        def _send_form(self, err=""):
            html = _FORM_HTML.format(token=token, region=initial_region, err=err)
            self._send_html(200, html)

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path != "/" or not self._check_token(parsed):
                self._send_html(404, "<h1>404</h1>")
                return
            self._send_form()

        def do_POST(self):
            parsed = urllib.parse.urlparse(self.path)
            if not self._check_token(parsed):
                self._send_html(403, "<h1>403</h1>")
                return

            if parsed.path == "/cancel":
                state["status"] = "cancelled"
                self._send_html(200, "ok")
                done_event.set()
                return

            if parsed.path != "/submit":
                self._send_html(404, "<h1>404</h1>")
                return

            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 16 * 1024:
                self._send_form(err="提交体异常。")
                return
            raw = self.rfile.read(length).decode("utf-8", errors="replace")
            form = urllib.parse.parse_qs(raw, keep_blank_values=False)

            sid = (form.get("sid", [""])[0] or "").strip()
            skey = (form.get("skey", [""])[0] or "").strip()
            region = (form.get("region", [""])[0] or "").strip()

            if not sid or not skey or not region:
                self._send_form(err="SecretId / SecretKey / Region 均不能为空。")
                return

            try:
                _write_credential(sid, skey)
                _write_region(region)
            except Exception as e:
                self._send_form(err=f"写入失败：{type(e).__name__}。请检查 ~/.tccli/ 目录权限后重试。")
                return

            state["status"] = "ok"
            state["sid_hint"] = f"{sid[:4]}…{sid[-4:]}" if len(sid) >= 8 else "已写入"
            state["region"] = region
            self._send_html(200, _DONE_HTML)
            done_event.set()

    return Handler


def _emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def main():
    token = secrets.token_urlsafe(24)
    initial_region = _load_existing_region()
    state = {"status": "cancelled"}
    done_event = threading.Event()

    Handler = _build_handler(token, initial_region, state, done_event)

    try:
        httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    except OSError as e:
        _emit({"status": "error", "message": f"无法在 127.0.0.1 启动本地服务：{e}"})
        return
    httpd.daemon_threads = True
    httpd.allow_reuse_address = True

    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{port}/?token={token}"

    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    print(f"[AKSK 配置] 已启动本地配置页面：{url}", file=sys.stderr)
    print("[AKSK 配置] 若浏览器未自动打开，请手动复制上面的 URL 到本机浏览器访问。", file=sys.stderr)
    print("[AKSK 配置] 仅监听 127.0.0.1（不对外），URL 含一次性 token，提交后立即关闭。", file=sys.stderr)

    try:
        webbrowser.open(url, new=1, autoraise=True)
    except Exception:
        pass

    try:
        finished = done_event.wait(timeout=IDLE_TIMEOUT_SEC)
    except KeyboardInterrupt:
        finished = False
        state["status"] = "cancelled"

    if not finished:
        _emit({
            "status": "timeout",
            "message": f"AKSK 配置页面 {IDLE_TIMEOUT_SEC // 60} 分钟内未提交，已自动关闭。如需重试请再次拉起。",
        })
    elif state["status"] == "ok":
        _emit({
            "status": "ok",
            "message": (
                f"AKSK 已写入 ~/.tccli/，可正常调用腾讯云 API。"
                f"SecretId 指纹：{state.get('sid_hint','')}，Region：{state.get('region','')}。"
            ),
        })
    else:
        _emit({"status": "cancelled", "message": "用户取消了 AKSK 配置，未写入任何文件。"})

    sys.stdout.flush()
    sys.stderr.flush()
    try:
        httpd.shutdown()
    except Exception:
        pass
    try:
        httpd.server_close()
    except Exception:
        pass
    os._exit(0)


if __name__ == "__main__":
    main()
