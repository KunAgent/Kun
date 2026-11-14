#!/usr/bin/env python3
"""Drive the installed CLI through a real PTY or ConPTY."""
import json
import os
import re
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
    draft_sent = False
    prompt_offset = 0
    submit_offset = 0
    prompt = b"KUN_ARTIFACT_VERIFY_WAIT" if mode == ["cancel"] else b"Return the fixture marker"
    first_exit = None
    quit_sent = False
    quit_submitted = False
    quit_offset = 0
    forced_exit = False
    cancelling = mode == ["cancel"]
    cancel_thread = None
    cancelled = False
    next_poll = 0
    controlled = mode in [["controlled"], ["attach-controlled"]]
    control_file = os.environ.get("KUN_TUI_SMOKE_CONTROL_FILE")
    readiness_written = False
    code = None
    last_poll_error = None
    plain = lambda data: re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", data)
    try:
        while time.monotonic() - started < 65:
            output.extend(terminal.read(0.1))
            elapsed = time.monotonic() - started
            code = terminal.poll()
            if code is not None:
                break
            screen = plain(output)
            if elapsed > 5 and not draft_sent and b"Ask anything" in screen:
                prompt_offset = len(output)
                terminal.write(prompt)
                draft_sent = True
            if draft_sent and not sent and prompt in plain(output[prompt_offset:]):
                submit_offset = len(output)
                terminal.write(b"\r")
                sent = True
            matched = sent and b"kun-npm-fixture-ok" in output[submit_offset:]
            if controlled and matched and not readiness_written:
                with open(control_file + ".ready.json", "w", encoding="utf-8") as file:
                    json.dump({"pid": pid, "matchedReply": True}, file)
                readiness_written = True
            if cancelling and sent and elapsed > next_poll and not cancelled:
                next_poll = elapsed + 0.5
                try:
                    if cancel_thread is None and b"interrupt" in plain(output[submit_offset:]):
                        for thread in runtime_state(data_dir)["threads"]:
                            state = runtime_state(data_dir, thread["id"])
                            if (state.get("activeTurn") or {}).get("status") == "running":
                                cancel_thread = thread["id"]
                                terminal.write(b"\x1b")
                                break
                    else:
                        turn = runtime_state(data_dir, cancel_thread).get("latestTurn") or {}
                        cancelled = turn.get("status") in ["interrupted", "cancelled", "aborted"]
                except (OSError, ValueError, KeyError) as error:
                    last_poll_error = str(error)
            ready_to_exit = os.path.exists(control_file) if controlled else (cancelled if cancelling else matched)
            if ready_to_exit and first_exit is None:
                first_exit = time.monotonic()
            if first_exit is not None and time.monotonic() - first_exit > 0.75 and not quit_sent:
                quit_offset = len(output)
                terminal.write(b"/quit")
                quit_sent = True
            if quit_sent and not quit_submitted and b"/quit" in plain(output[quit_offset:]):
                terminal.write(b"\r")
                quit_submitted = True
        if code is None:
            forced_exit = True
            code = terminal.terminate()
        result = {"exitCode": code, "renderedBytes": len(output),
                  "terminalKind": terminal.kind,
                  "sentPrompt": sent,
                  "draftSent": draft_sent,
                  "quitSubmitted": quit_submitted,
                  "forcedExit": forced_exit,
                  "cancellationVerified": cancelled,
                  "cancellationKey": "escape" if cancelling else None,
                  "lastPollError": last_poll_error,
                  "matchedReply": sent and b"kun-npm-fixture-ok" in output[submit_offset:],
                  "transcriptTail": output[-6000:].decode("utf-8", errors="replace")}
        print(json.dumps(result))
    finally:
        terminal.close()


if __name__ == "__main__":
    main()
