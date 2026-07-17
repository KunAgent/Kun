"""
CLIGuard Python SDK
通过 subprocess 调用内嵌的 Node.js cliguard.js 生成签名 Headers。

用法：
    import cliguard  # 顶部引入，自动 patch requests/httpx/urllib
"""

import subprocess
import base64
import json
import sys
import os
from pathlib import Path

# JS 核心目录：
#   发包结构：js/ 内嵌 build 产物（cliguard.js + cliguard-wrapper.js）
#   开发结构：fallback 到 monorepo 各子模块的 dist/ 或 debug/
_PKG_JS_DIR = Path(__file__).resolve().parent / 'js'
_MONOREPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

# 自更新目录（与 JS 侧 UPDATE_DIR 保持一致）
_UPDATE_DIR = Path.home() / '.cliguard' / 'cliguard-updates'

# 云端下发后 package.json 的固定路径
_UPDATED_PKG_PATH = _UPDATE_DIR / 'packages' / 'npm' / 'package.json'

# ── Debug: 设置环境变量 CLIGUARD_DEBUG=1 打印路径诊断信息 ─────────────────────
_CLIGUARD_DEBUG = os.environ.get('CLIGUARD_DEBUG', '').strip() in ('1', 'true', 'yes')


def _debug_log(*args):
    if _CLIGUARD_DEBUG:
        print('[CLIGuard:Debug]', *args, file=sys.stderr, flush=True)


def _clean_node_env(extra=None):
    """返回清理过 NODE_OPTIONS 的环境变量副本。

    安全清空 NODE_OPTIONS，避免宿主进程注入的 --require / --inspect 等
    选项被子 node 进程继承，从而污染 stdout（破坏 JSON 解析）或引发启动异常。

    Args:
        extra: 需要额外设置的环境变量字典（可选）
    """
    env = os.environ.copy()
    env['NODE_OPTIONS'] = ''
    if extra:
        env.update(extra)
    return env


def _is_newer_version(local: str, remote: str) -> bool:
    """简单语义版本比较：返回 True 表示 remote > local
    
    支持带后缀的版本号，移除 -beta 和 .dev 后缀后比较
    例如：1.2.3-beta -> 1.2.3, 0.0.1.dev -> 0.0.1
    """
    def parse_version(v: str):
        # 移除 -beta 及后面的内容，移除 .dev
        core = v.split('-beta')[0]
        core = core.split('.dev')[0]
        return [int(x) for x in core.split('.')]
    
    try:
        l_parts = parse_version(local)
        r_parts = parse_version(remote)
        # 补齐到 3 位
        while len(l_parts) < 3:
            l_parts.append(0)
        while len(r_parts) < 3:
            r_parts.append(0)
        if r_parts[0] != l_parts[0]:
            return r_parts[0] > l_parts[0]
        if r_parts[1] != l_parts[1]:
            return r_parts[1] > l_parts[1]
        return r_parts[2] > l_parts[2]
    except Exception:
        return False


def _get_local_version() -> str:
    """获取本地包版本号"""
    try:
        pkg_json_path = _PKG_JS_DIR / 'package.json'
        if pkg_json_path.exists():
            return json.loads(pkg_json_path.read_text()).get('version', '0.0.0')
    except Exception:
        pass
    return '0.0.0'


def _get_updated_version() -> str:
    """获取云端更新版本号"""
    try:
        if _UPDATED_PKG_PATH.exists():
            return json.loads(_UPDATED_PKG_PATH.read_text()).get('version', '0.0.0')
    except Exception:
        pass
    return '0.0.0'


def _resolve_core(filename: str) -> str:
    """解析 JS 模块路径，优先级：UPDATE_DIR > 发包 js/ > monorepo 产物

    Args:
        filename: 如 'cliguard.js' 或 'cliguard-wrapper.js'
    """
    # 0. 判断本地版本与云端版本，云端版本更高时优先加载
    local_version = _get_local_version()
    updated_version = _get_updated_version()
    use_updated = _is_newer_version(local_version, updated_version)
    _debug_log(f'_resolve_core({filename}): local_version={local_version}, updated_version={updated_version}, use_updated={use_updated}')

    resolved_path = None
    source = None

    if use_updated:
        # 1. 优先从云端更新目录加载
        updated = _UPDATE_DIR / 'core' / filename
        if updated.exists():
            resolved_path = str(updated)
            source = 'cloud-update'

    if resolved_path is None:
        # 2. 发包结构：cliguard/js/cliguard.js
        pkg_file = _PKG_JS_DIR / filename
        if pkg_file.exists():
            resolved_path = str(pkg_file)
            source = 'pip-package'

    if resolved_path is None:
        # 3. 开发结构：monorepo 各子模块的 dist/ 或 debug/
        dev_candidates = []
        if filename == 'cliguard.js':
            dev_candidates = [
                _MONOREPO_ROOT / 'cliguard' / 'dist' / 'cliguard.js',
                _MONOREPO_ROOT / 'cliguard' / 'debug' / 'cliguard.js',
            ]
        elif filename == 'cliguard-wrapper.js':
            dev_candidates = [
                _MONOREPO_ROOT / 'cliguard-wrapper' / 'dist' / 'cliguard-wrapper.js',
                _MONOREPO_ROOT / 'cliguard-wrapper' / 'debug' / 'cliguard-wrapper.js',
            ]
        for candidate in dev_candidates:
            if candidate.exists():
                resolved_path = str(candidate)
                source = 'debug' if '/debug/' in str(candidate) else 'dist'
                break

    if resolved_path is None:
        # 4. fallback：返回发包路径（让调用方报错，方便排查）
        resolved_path = str(_PKG_JS_DIR / filename)
        source = 'fallback'

    _debug_log(f'_resolve_core({filename}): resolved_path={resolved_path}, source={source}')
    return resolved_path

# cliguard.js：签名 + 指纹模块
# cliguard-wrapper.js：守护进程 + 更新模块
_CLIGUARD_PATH = _resolve_core('cliguard.js')
_CLIGUARD_WRAPPER_PATH = _resolve_core('cliguard-wrapper.js')


def _describe_path(resolved: str) -> str:
    """根据路径描述来源类型"""
    p = Path(resolved).resolve()
    update_dir = _UPDATE_DIR.resolve()
    if str(p).startswith(str(update_dir)):
        return 'cloud-update'
    if '/debug/' in str(p):
        return 'debug'
    if '/dist/' in str(p):
        return 'dist'
    if str(_PKG_JS_DIR) in str(p):
        return 'pip-package'
    return 'unknown'


# 打印路径诊断（仅在 CLIGUARD_DEBUG 时生效）
_debug_log('package.json:', Path(__file__).resolve().parent.parent / 'setup.py')
_debug_log('cliguard.js:', Path(_CLIGUARD_PATH).resolve(), '(source:', _describe_path(_CLIGUARD_PATH), ')')
_debug_log('cliguard-wrapper.js:', Path(_CLIGUARD_WRAPPER_PATH).resolve(), '(source:', _describe_path(_CLIGUARD_WRAPPER_PATH), ')')


def _ensure_daemon():
    """启动守护进程（跨平台）。

    所有守护进程管理逻辑（PID 检查、锁、版本比较等）由 cliguard-wrapper.js 的 startDaemon() 处理。
    """
    import platform

    # 传递 pip 包路径给 worker 进程，用于读取版本号
    # package.json 在 js/ 子目录下
    pip_package_path = str((Path(__file__).resolve().parent / 'js'))
    env = _clean_node_env({'CLIGUARD_NPM_PACKAGE_PATH': pip_package_path})

    is_windows = platform.system() == 'Windows'
    if is_windows:
        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        subprocess.Popen(
            ['node', _CLIGUARD_WRAPPER_PATH, '--start'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            env=env,
        )
    else:
        subprocess.Popen(
            ['node', _CLIGUARD_WRAPPER_PATH, '--start'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            env=env,
        )


def _add_common_params(url_str: str) -> str:
    """通过 node -e 调用 cliguard.js 内置的 addCommonParams 注入公参。
    Args:
        url_str: 原始请求 URL 字符串

    Returns:
        追加公参后的 URL 字符串
    """
    try:
        js_code = (
            "const {addCommonParams}=require(" + json.dumps(_CLIGUARD_PATH) + ");"
            "const r=addCommonParams(" + json.dumps(url_str) + ");"
            "console.log(r.url)"
        )
        result = subprocess.check_output(['node', '-e', js_code], timeout=10, stderr=subprocess.PIPE, env=_clean_node_env())
        injected = result.decode('utf-8').strip()
        return injected if injected else url_str
    except Exception as e:
        _debug_log(f'_add_common_params failed, fallback to original url: {e}')
        return url_str


def _normalize_body(body):
    """规范化 body 为 bytes，并检测是否支持签名
    
    Args:
        body: 原始 body 数据
        
    Returns:
        tuple: (body_bytes, unsupported_sign)
        - body_bytes: 规范化后的 bytes，如果不支持签名则为 None
        - unsupported_sign: 是否不支持签名（流式上传场景）
    """
    if body is None:
        return b'', False
    elif isinstance(body, bytes):
        return body, False
    elif isinstance(body, str):
        return body.encode('utf-8'), False
    elif hasattr(body, 'read'):
        # 文件对象（如 io.BytesIO, open() 返回的文件对象）
        _debug_log('body is file-like object, skip signing')
        return None, True
    elif callable(getattr(body, '__iter__', None)) and not isinstance(body, (bytes, str, dict, list)):
        # 生成器或可迭代对象（非基本类型）
        _debug_log('body is generator/iterable, skip signing')
        return None, True
    else:
        # 其他类型，尝试 JSON 序列化
        try:
            import json as _json
            return _json.dumps(body, separators=(',', ':')).encode('utf-8'), False
        except Exception:
            _debug_log('body type unsupported, skip signing')
            return None, True


def _make_sig_headers(method: str, url_str: str, body=None) -> dict:
    """通过 subprocess 调用 cliguard.js 的 signRequest 生成签名 Headers

    Python 侧计算 body MD5，只将 hex 字符串传给 JS。
    注意：此函数只负责签名，不负责注入公参。调用方需先通过 _add_common_params 注入公参。
    
    支持的 body 类型：
    - None: 空请求体
    - bytes: 二进制数据
    - str: 字符串
    - dict/list: 自动 JSON 序列化
    
    不支持的 body 类型（返回空字典）：
    - 文件对象（有 read 方法）
    - 生成器/迭代器

    返回 mtgsig header 格式: {"mtgsig": "{...}"}
    如果不支持签名，返回空字典: {}
    """
    import hashlib
    try:
        # 规范化 body，同时检测是否支持签名
        body_bytes, unsupported_sign = _normalize_body(body)
        
        if unsupported_sign:
            # 流式上传不支持签名，返回空字典
            return {}
        
        # Python 侧计算 body MD5，只传 hash 给 JS（仅取前 16200 字节）
        body_hash = hashlib.md5(body_bytes[:16200]).hexdigest()

        # 通过 node -e require cliguard.js 并调用 signRequest
        js_code = (
            f"const {{signRequest}}=require({json.dumps(_CLIGUARD_PATH)});"
            f"console.log(JSON.stringify(signRequest({json.dumps(method.upper())},{json.dumps(url_str)},{json.dumps(body_hash)})))"
        )
        result = subprocess.check_output(
            ['node', '-e', js_code],
            timeout=10,
            stderr=subprocess.PIPE,
            env=_clean_node_env(),
        )
        sig = json.loads(result.decode('utf-8').strip())
        return sig
    except Exception as e:
        print(f'[CLIGuard] Signing failed: {e}', file=sys.stderr)
        return {}


def _patch_requests():
    try:
        import requests
        _orig_send = requests.Session.send

        def _cliguard_send(self, request, **kwargs):
            # Step 1: 公参注入（始终执行，不受签名影响）
            try:
                signed_url = _add_common_params(str(request.url))
                if signed_url:
                    request.prepare_url(signed_url, None)
            except Exception:
                pass

            # Step 2: 签名（可能因流式 body 而跳过）
            try:
                # hook Session.send：此时 PreparedRequest.body 已是最终序列化字节
                # 避免 Session.request 阶段 dict/json= 尚未序列化导致 body_hash 不一致
                body = request.body
                sig_headers = _make_sig_headers(request.method, str(request.url), body)
                for k, v in sig_headers.items():
                    request.headers[k] = v
            except Exception:
                pass

            return _orig_send(self, request, **kwargs)

        requests.Session.send = _cliguard_send
    except ImportError:
        pass


def _patch_httpx():
    try:
        import httpx
        _orig_send = httpx.Client.send

        def _cliguard_send(self, request, **kwargs):
            # Step 1: 公参注入（始终执行，不受签名影响）
            try:
                signed_url = _add_common_params(str(request.url))
                if signed_url:
                    request.url = httpx.URL(signed_url)
            except Exception:
                pass

            # Step 2: 签名（可能因流式 body 而跳过）
            try:
                body = request.content
                sig_headers = _make_sig_headers(request.method, str(request.url), body)
                for k, v in sig_headers.items():
                    request.headers[k] = v
            except Exception:
                pass

            return _orig_send(self, request, **kwargs)

        httpx.Client.send = _cliguard_send
    except ImportError:
        pass


def _patch_urllib():
    try:
        import urllib.request
        _orig_urlopen = urllib.request.urlopen

        def _cliguard_urlopen(url, data=None, timeout=None, **kwargs):
            url_str = url.full_url if hasattr(url, 'full_url') else str(url)
            method = url.get_method() if hasattr(url, 'get_method') else ('POST' if data else 'GET')
            body = data or (url.data if hasattr(url, 'data') else None)

            # Step 1: 公参注入（始终执行，不受签名影响）
            signed_url = url_str
            try:
                injected_url = _add_common_params(url_str)
                if injected_url:
                    signed_url = injected_url
            except Exception:
                pass

            # Step 2: 签名（可能因流式 body 而跳过）
            sig_headers = {}
            try:
                sig_headers = _make_sig_headers(method, signed_url, body)
            except Exception:
                pass

            # 写回注入公参后的 URL，确保实际发出的请求 URL 与签名保持一致
            target_url = signed_url or url_str
            if hasattr(url, 'add_header'):
                if signed_url:
                    url.full_url = signed_url
                for k, v in sig_headers.items():
                    url.add_header(k, v)
            else:
                req = urllib.request.Request(target_url, headers=sig_headers)
                url = req

            if timeout is not None:
                return _orig_urlopen(url, data, timeout, **kwargs)
            return _orig_urlopen(url, data, **kwargs)

        urllib.request.urlopen = _cliguard_urlopen
    except Exception:
        pass


# Bootstrap
_ensure_daemon()
_patch_requests()
_patch_httpx()
_patch_urllib()

# 公开 API
def sign(method: str, url_str: str, body_hash: str = '') -> dict:
    """生成签名 Headers（对外 API）
    
    直接调用 cliguard.js 的 signRequest，业务侧需要自行计算 body_hash。
    
    Args:
        method: HTTP 方法（GET/POST/PUT/DELETE 等）
        url_str: 请求 URL（建议先通过 add_common_params 注入公参）
        body_hash: 请求 body 的 MD5 哈希值（可选，POST/PUT 请求需要）
    
    Returns:
        签名 Headers 字典，格式: {"mtgsig": "{...}"}
    
    示例:
        import hashlib
        import cliguard
        
        # 注入公参
        url = cliguard.add_common_params('https://example.com/api')
        
        # 计算 body hash
        body = b'{"test": "data"}'
        body_hash = hashlib.md5(body).hexdigest()
        
        # 生成签名
        headers = cliguard.sign('POST', url, body_hash)
    """
    try:
        js_code = (
            f"const {{signRequest}}=require({json.dumps(_CLIGUARD_PATH)});"
            f"console.log(JSON.stringify(signRequest({json.dumps(method.upper())},{json.dumps(url_str)},{json.dumps(body_hash)})))"
        )
        result = subprocess.check_output(
            ['node', '-e', js_code],
            timeout=10,
            stderr=subprocess.PIPE,
            env=_clean_node_env(),
        )
        sig = json.loads(result.decode('utf-8').strip())
        return sig
    except Exception as e:
        print(f'[CLIGuard] Signing failed: {e}', file=sys.stderr)
        return {}


def add_common_params(url_str: str) -> str:
    """注入公共参数到 URL（对外 API）
    
    Args:
        url_str: 原始请求 URL 字符串
        
    Returns:
        追加公参后的 URL 字符串（包含 csecplatform 和 csecversion）
    """
    return _add_common_params(url_str)

# print('[CLIGuard] Python SDK loaded. requests/httpx/urllib patched.', file=sys.stderr)