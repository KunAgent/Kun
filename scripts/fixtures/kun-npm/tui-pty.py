#!/usr/bin/env python3
"""Drive the installed CLI in a real POSIX PTY without importing application code."""
import json
import os
import sys
import time
import urllib.request
if os.name == "nt":
    from windows_conpty import Terminal
else:
    from posix_terminal import Terminal


def runtime_state(data_dir, thread_id=None):
    with open(os.path.join(data_dir, "runtime.json"), encoding="utf-8") as file:
        discovery = json.load(file)
    path = "/v1/threads" if thread_id is None else f"/v1/threads/{thread_id}/state"
    request = urllib.request.Request(discovery["baseUrl"] + path,
                                    headers={"authorization": "Bearer " + discovery["runtimeToken"]})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=0.5) as response:
        return json.load(response)


def main():
    node, entry, data_dir, workspace, *mode = sys.argv[1:]
    command = [] if mode == ["bare"] else ["tui"]
    if mode in [["attach"], ["attach-controlled"]]:
        command = ["tui", "--no-start"]
    terminal = Terminal(node, [entry, *command, "--data-dir", data_dir, "--workspace", workspace,
                               "--model", "kun-npm-fixture"])
    pid = terminal.pid
    output = bytearray()
    started = time.monotonic()
    sent = False
    first_exit = None
    quit_sent = False
    forced_exit = False
    cancelling = mode == ["cancel"]
    cancel_thread = None
    cancelled = False
    next_poll = 0
    controlled = mode in [["controlled"], ["attach-controlled"]]
    control_file = os.environ.get("KUN_TUI_SMOKE_CONTROL_FILE")
    readiness_written = False
    code = None
    try:
        while time.monotonic() - started < 65:
            output.extend(terminal.read(0.1))
            elapsed = time.monotonic() - started
            code = terminal.poll()
            if code is not None:
                break
            if elapsed > 5 and not sent:
                prompt = b"KUN_ARTIFACT_VERIFY_WAIT\r" if cancelling else b"Return the fixture marker\r"
                terminal.write(prompt)
                sent = True
            matched = b"kun-npm-fixture-ok" in output
            if controlled and matched and not readiness_written:
                with open(control_file + ".ready.json", "w", encoding="utf-8") as file:
                    json.dump({"pid": pid, "matchedReply": True}, file)
                readiness_written = True
            if cancelling and sent and elapsed > next_poll and not cancelled:
                next_poll = elapsed + 0.5
                try:
                    if cancel_thread is None:
                        for thread in runtime_state(data_dir)["threads"]:
                            state = runtime_state(data_dir, thread["id"])
                            if (state.get("activeTurn") or {}).get("status") == "running":
                                cancel_thread = thread["id"]
                                terminal.write(b"\x03")
                                break
                    else:
                        turn = runtime_state(data_dir, cancel_thread).get("latestTurn") or {}
                        cancelled = turn.get("status") in ["interrupted", "cancelled", "aborted"]
                except (OSError, ValueError, KeyError):
                    pass
            ready_to_exit = os.path.exists(control_file) if controlled else (cancelled if cancelling else matched)
            if ready_to_exit and first_exit is None:
                first_exit = time.monotonic()
            if first_exit is not None and time.monotonic() - first_exit > 0.75 and not quit_sent:
                terminal.write(b"/quit\r")
                quit_sent = True
        if code is None:
            forced_exit = True
            code = terminal.terminate()
        result = {"exitCode": code, "renderedBytes": len(output),
                  "terminalKind": terminal.kind,
                  "forcedExit": forced_exit,
                  "cancellationVerified": cancelled,
                  "matchedReply": b"kun-npm-fixture-ok" in output,
                  "transcriptTail": output[-6000:].decode("utf-8", errors="replace")}
        print(json.dumps(result))
    finally:
        terminal.close()


if __name__ == "__main__":
    main()
