"""
mcporter 调用封装（跨平台通用）

解决三个核心问题：
1. Windows cmd.exe 会将 keyword 中的 `|` 解释为管道符，导致命令截断
2. subprocess 调用 mcporter 时，cwd 不在 Workspace 根目录，导致 mcporter
   找不到 Project config（config/mcporter.json），报 "Unknown MCP server"
3. 搜索接口返回的 JSON 过大时 subprocess capture_output 缓冲截断

原理：
- mcporter 配置分两层：
  * System config: ~/.mcporter/mcporter.json（全局配置）
  * Project config: <cwd>/config/mcporter.json（项目配置）
- recruit-mcp 等服务通常配置在 Project config 中
- 本脚本通过 cwd 参数确保 subprocess 在正确的 Workspace 根目录下运行
- 通过将 stdout 直接重定向到文件避免缓冲截断

输出格式：
- 搜索接口（apiId 含 post_v1_resume_search）：JSONL 格式，第一行为元数据，
  后续每行一条简历 JSON，避免大 JSON 被截断
- 其他接口：原样输出

用法:
  python mcporter_call.py <mcporter_path> <server_name> <tool_name> <api_id> <params_json_file> <output_file>

环境变量:
  MCPORTER_WORKSPACE  — 覆盖默认的 Workspace 根目录路径
                        默认自动检测: 优先寻找包含 config/mcporter.json 的祖先目录,
                        其次 ~/.box/Workspace, 最后 fallback 到当前目录
"""
import subprocess, json, sys, os, platform, shutil, pathlib, tempfile


def detect_workspace_root():
    """
    自动检测 Box Workspace 根目录（确保 mcporter 能找到 Project config）。

    检测顺序：
    1. 环境变量 MCPORTER_WORKSPACE
    2. 从当前工作目录向上查找包含 config/mcporter.json 的目录
    3. ~/.box/Workspace（Box 默认 Workspace）
    4. fallback: 当前目录
    """
    # 1. 环境变量优先
    env_val = os.environ.get("MCPORTER_WORKSPACE")
    if env_val and os.path.isdir(env_val):
        return env_val

    # 2. 从 cwd 向上查找包含 config/mcporter.json 的目录
    current = pathlib.Path.cwd()
    for ancestor in [current] + list(current.parents):
        if (ancestor / "config" / "mcporter.json").is_file():
            return str(ancestor)

    # 3. Box 默认 Workspace
    home = pathlib.Path.home()
    default = home / ".box" / "Workspace"
    if (default / "config" / "mcporter.json").is_file():
        return str(default)
    if default.is_dir():
        return str(default)

    # 4. fallback
    return os.getcwd()


def resolve_node_and_cli(mcporter_path):
    """
    Windows 专用：从 mcporter.cmd 路径推算 node.exe + cli.js 路径，
    绕过 .cmd shim 的 %* 管道符问题。
    """
    mcporter_dir = os.path.dirname(mcporter_path)
    cli_js = os.path.join(mcporter_dir, "node_modules", "mcporter", "dist", "cli.js")
    local_node = os.path.join(mcporter_dir, "node.exe")
    node_exe = local_node if os.path.isfile(local_node) else shutil.which("node")
    if not node_exe:
        print("ERROR: node.exe not found", file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(cli_js):
        print(f"ERROR: cli.js not found at {cli_js}", file=sys.stderr)
        sys.exit(1)
    return node_exe, cli_js


def convert_raw_to_jsonl(raw_file_path, output_file_path, api_id):
    """
    将 mcporter 原始输出转换为 JSONL 格式（仅搜索接口）。

    搜索接口输出 JSONL：
    - 第一行: {"_meta": {"total": N, "status": S, "message": M}}
    - 后续每行: 一条简历的完整 JSON

    非搜索接口: 原样复制文件。
    """
    if "post_v1_resume_search" not in api_id:
        # 非搜索接口，直接复制
        if raw_file_path != output_file_path:
            shutil.copy2(raw_file_path, output_file_path)
        return

    # 读取并解析完整 JSON
    with open(raw_file_path, "r", encoding="utf-8") as f:
        raw_content = f.read()

    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError as e:
        # JSON 解析失败（可能被截断），保留原始内容并报错
        print(f"WARNING: JSON 解析失败 ({e})，原样保存", file=sys.stderr)
        if raw_file_path != output_file_path:
            shutil.copy2(raw_file_path, output_file_path)
        return

    # 提取简历列表: response.data.data.list
    inner = data.get("data", {}) or {}
    inner2 = inner.get("data", {}) or {}
    resume_list = inner2.get("list", []) if isinstance(inner2, dict) else []

    # ── 检测 401 / 面试官权限错误 ──
    # 特征: 外层 status=200, 内层 data.status=401, data.data=null
    inner_status = inner.get("status")
    inner_message = inner.get("message", "")
    has_auth_error = (inner_status == 401) or (
        inner2 is None and "面试官" in str(inner_message)
    )

    # 写入 JSONL
    with open(output_file_path, "w", encoding="utf-8") as f:
        # 第一行: 元数据
        meta = {
            "_meta": {
                "total": len(resume_list),
                "status": data.get("status"),
                "inner_status": inner_status,
                "message": inner_message,
            }
        }
        if has_auth_error:
            meta["_meta"]["error"] = "NO_INTERVIEWER_PERMISSION"
            meta["_meta"]["error_detail"] = (
                f"招聘平台返回 401: {inner_message}。"
                "当前账号可能没有面试官权限，请到 hrright.woa.com 申请面试官权限，申请完成后即可正常使用。"
            )
            print(
                f"ERROR: 招聘平台返回 401 (面试官权限不足): {inner_message}",
                file=sys.stderr,
            )
        f.write(json.dumps(meta, ensure_ascii=False) + "\n")

        # 后续每行: 一条简历
        for resume in resume_list:
            f.write(json.dumps(resume, ensure_ascii=False) + "\n")


def main():
    if len(sys.argv) < 7:
        print("用法: python mcporter_call.py <mcporter_path> <server> <tool> <apiId> <params.json> <output.jsonl>",
              file=sys.stderr)
        sys.exit(1)

    mcporter_path = sys.argv[1]
    server_name   = sys.argv[2]
    tool_name     = sys.argv[3]
    api_id        = sys.argv[4]
    params_file   = sys.argv[5]
    output_file   = sys.argv[6]

    # ── 读取参数文件 ──
    with open(params_file, "r", encoding="utf-8") as f:
        params = json.load(f)
    params_str = json.dumps(params, ensure_ascii=False)

    # ── 构建命令 ──
    env = os.environ.copy()

    if platform.system() == "Windows":
        node_exe, cli_js = resolve_node_and_cli(mcporter_path)
        cmd = [node_exe, cli_js, "call", server_name, tool_name,
               f"apiId={api_id}", f"params={params_str}"]
    else:
        cmd = [mcporter_path, "call", server_name, tool_name,
               f"apiId={api_id}", f"params={params_str}"]

    # ── 🔴 关键：设置 cwd 为 Workspace 根目录 ──
    workspace_root = detect_workspace_root()
    print(f"Workspace root: {workspace_root}", file=sys.stderr)

    # ── 🔴 关键：stdout 直接写入临时文件，避免 capture_output 缓冲截断 ──
    output_dir = os.path.dirname(os.path.abspath(output_file)) or "."
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".raw.json", dir=output_dir, delete=False, encoding="utf-8"
    ) as tmp:
        tmp_path = tmp.name

    try:
        with open(tmp_path, "wb") as stdout_f:
            r = subprocess.run(
                cmd, stdout=stdout_f, stderr=subprocess.PIPE,
                shell=False, env=env, cwd=workspace_root
            )

        if r.stderr:
            sys.stderr.buffer.write(r.stderr)

        if r.returncode and r.returncode != 0:
            print(f"mcporter 退出码: {r.returncode}", file=sys.stderr)

        # ── 转换为 JSONL（搜索接口）或原样复制（其他接口） ──
        convert_raw_to_jsonl(tmp_path, output_file, api_id)

    finally:
        # 清理临时文件
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    sys.exit(r.returncode or 0)


if __name__ == "__main__":
    main()
