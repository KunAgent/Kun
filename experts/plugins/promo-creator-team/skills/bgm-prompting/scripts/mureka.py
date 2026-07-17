"""Mureka AI music generation CLI — single entry point for all operations."""

import argparse
import json
import os
import sys
import time

import requests

# ---------------------------------------------------------------------------
# API Client
# ---------------------------------------------------------------------------

API_BASE = os.getenv("MUREKA_API_URL", "https://api.mureka.ai").rstrip("/")
POLL_INTERVAL = 5
POLL_TIMEOUT = 600


def get_api_key():
    key = os.getenv("MUREKA_API_KEY")
    if not key:
        print("Error: MUREKA_API_KEY is not set", file=sys.stderr)
        sys.exit(1)
    return key


def headers(api_key=None):
    key = api_key or get_api_key()
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def post_json(path, payload, api_key=None, timeout=60):
    url = f"{API_BASE}{path}"
    resp = requests.post(url, json=payload, headers=headers(api_key), timeout=timeout)
    if not resp.ok:
        raise requests.HTTPError(f"{resp.status_code} {resp.reason}: {resp.text}", response=resp)
    return resp.json()


def get_json(path, api_key=None, timeout=30):
    url = f"{API_BASE}{path}"
    resp = requests.get(url, headers=headers(api_key), timeout=timeout)
    if not resp.ok:
        raise requests.HTTPError(f"{resp.status_code} {resp.reason}: {resp.text}", response=resp)
    return resp.json()


def upload_file_api(file_path, purpose, api_key=None):
    key = api_key or get_api_key()
    url = f"{API_BASE}/v1/files/upload"
    with open(file_path, "rb") as f:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {key}"},
            files={"file": f},
            data={"purpose": purpose},
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def poll_task(query_path, task_id, api_key=None, interval=POLL_INTERVAL, timeout=POLL_TIMEOUT):
    key = api_key or get_api_key()
    path = f"{query_path}/{task_id}"
    deadline = time.time() + timeout
    terminal = {"succeeded", "failed", "timeouted", "cancelled"}

    while True:
        data = get_json(path, api_key=key)
        status = data.get("status", "")
        print(f"  [{status}] task {task_id}", file=sys.stderr)

        if status in terminal:
            if status != "succeeded":
                reason = data.get("failed_reason", status)
                raise RuntimeError(f"Task {task_id} ended with status: {status}. Reason: {reason}")
            return data

        if time.time() > deadline:
            raise RuntimeError(f"Task {task_id} timed out after {timeout}s (last status: {status})")

        time.sleep(interval)


def download_audio(url, output_path):
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(resp.content)
    return output_path


def download_choices(result, args):
    """Download audio files into output directory."""
    choices = result.get("choices", [])
    if not choices:
        print("No results generated.", file=sys.stderr)
        sys.exit(1)

    out_dir = args.output
    os.makedirs(out_dir, exist_ok=True)

    format_key = {"mp3": "url", "flac": "flac_url", "wav": "wav_url"}[args.format]

    for choice in choices:
        idx = choice.get("index", 0)
        url = choice.get(format_key) or choice.get("url")
        duration_ms = choice.get("duration", 0)

        if len(choices) > 1:
            filename = f"audio_{idx}.{args.format}"
        else:
            filename = f"audio.{args.format}"

        output_path = os.path.join(out_dir, filename)
        print(f"Downloading choice {idx} ({duration_ms / 1000:.1f}s) → {output_path}", file=sys.stderr)
        download_audio(url, output_path)
        print(output_path)


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def cmd_song(args):
    """Generate a song with lyrics and vocals."""
    payload = {"lyrics": args.lyrics, "model": args.model}
    if args.prompt:
        payload["prompt"] = args.prompt
    if args.reference_id:
        payload["reference_id"] = args.reference_id
    if args.vocal_id:
        payload["vocal_id"] = args.vocal_id
    if args.melody_id:
        payload["melody_id"] = args.melody_id
    if args.n:
        payload["n"] = args.n

    # Save lyrics and prompt to output directory
    os.makedirs(args.output, exist_ok=True)
    lyrics_path = os.path.join(args.output, "lyrics.txt")
    with open(lyrics_path, "w", encoding="utf-8") as f:
        f.write(args.lyrics)
        if args.prompt:
            f.write(f"\n\n---\nPrompt: {args.prompt}\n")
    print(f"Lyrics saved → {lyrics_path}", file=sys.stderr)

    print("Submitting song generation task...", file=sys.stderr)
    task = post_json("/v1/song/generate", payload)
    task_id = task["id"]
    print(f"Task ID: {task_id}", file=sys.stderr)

    print("Polling for completion...", file=sys.stderr)
    result = poll_task("/v1/song/query", task_id,
                       interval=args.poll_interval, timeout=args.poll_timeout)
    download_choices(result, args)


def cmd_instrumental(args):
    """Generate an instrumental track."""
    payload = {"model": args.model}
    if args.prompt:
        payload["prompt"] = args.prompt
    if args.instrumental_id:
        payload["instrumental_id"] = args.instrumental_id
    if args.n:
        payload["n"] = args.n

    print("Submitting instrumental generation task...", file=sys.stderr)
    task = post_json("/v1/instrumental/generate", payload)
    task_id = task["id"]
    print(f"Task ID: {task_id}", file=sys.stderr)

    print("Polling for completion...", file=sys.stderr)
    result = poll_task("/v1/instrumental/query", task_id,
                       interval=args.poll_interval, timeout=args.poll_timeout)
    download_choices(result, args)


def cmd_lyrics(args):
    """Generate or extend lyrics."""
    if args.lyrics_command == "generate":
        result = post_json("/v1/lyrics/generate", {"prompt": args.prompt})
        title = result.get("title", "")
        lyrics = result.get("lyrics", "")
        if title:
            print(f"Title: {title}\n")
        print(lyrics)
    elif args.lyrics_command == "extend":
        result = post_json("/v1/lyrics/extend", {"lyrics": args.lyrics})
        print(result.get("lyrics", ""))


def cmd_upload(args):
    """Upload a file to Mureka."""
    print(f"Uploading {args.file} (purpose={args.purpose})...", file=sys.stderr)
    result = upload_file_api(args.file, args.purpose)
    file_id = result.get("id", "")
    print(f"File ID: {file_id}")
    print(json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# Shared argument helpers
# ---------------------------------------------------------------------------

def add_generation_args(parser, default_output="./output"):
    """Add common generation arguments."""
    parser.add_argument("--model", default="mureka-8",
                        help="Model (default: mureka-8)")
    parser.add_argument("-n", "--n", type=int, default=None, dest="n",
                        help="Number of results to generate (default 2, max 3)")
    parser.add_argument("--output", default=default_output,
                        help=f"Output directory (default: {default_output})")
    parser.add_argument("--format", choices=["mp3", "flac", "wav"], default="mp3",
                        help="Download format (default: mp3)")
    parser.add_argument("--poll-interval", type=int, default=5,
                        help="Poll interval in seconds (default: 5)")
    parser.add_argument("--poll-timeout", type=int, default=600,
                        help="Poll timeout in seconds (default: 600)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Mureka AI music generation CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  %(prog)s song --lyrics "[Verse]\\nHello world" --prompt "pop, 120 BPM, female vocal"
  %(prog)s instrumental --prompt "ambient, 80 BPM, soft pads"
  %(prog)s lyrics generate "a summer love song"
  %(prog)s lyrics extend "[Verse]\\nExisting lyrics..."
  %(prog)s upload my_voice.mp3 --purpose vocal
""")
    sub = parser.add_subparsers(dest="command", required=True)

    # --- song ---
    p_song = sub.add_parser("song", help="Generate a song with lyrics and vocals")
    p_song.add_argument("--lyrics", required=True,
                        help="Song lyrics (max 3000 chars). Use structure tags: [Verse], [Chorus], etc.")
    p_song.add_argument("--prompt", default=None,
                        help="Style/scene prompt (max 1024 chars)")
    p_song.add_argument("--reference-id", default=None,
                        help="Reference audio file ID (purpose=reference)")
    p_song.add_argument("--vocal-id", default=None,
                        help="Vocal file ID (purpose=vocal)")
    p_song.add_argument("--melody-id", default=None,
                        help="Melody file ID (purpose=melody). Cannot combine with other control options")
    add_generation_args(p_song, "./output")

    # --- instrumental ---
    p_inst = sub.add_parser("instrumental", help="Generate an instrumental track")
    p_inst.add_argument("--prompt", default=None,
                        help="Style/scene prompt (max 1024 chars)")
    p_inst.add_argument("--instrumental-id", default=None,
                        help="Reference instrumental file ID (purpose=instrumental)")
    add_generation_args(p_inst, "./instrumental")

    # --- lyrics ---
    p_lyrics = sub.add_parser("lyrics", help="Generate or extend lyrics")
    lyrics_sub = p_lyrics.add_subparsers(dest="lyrics_command", required=True)

    p_lyrics_gen = lyrics_sub.add_parser("generate", help="Generate lyrics from a prompt")
    p_lyrics_gen.add_argument("prompt", help="Theme or description for lyrics")

    p_lyrics_ext = lyrics_sub.add_parser("extend", help="Extend existing lyrics")
    p_lyrics_ext.add_argument("lyrics", help="Existing lyrics to continue writing")

    # --- upload ---
    p_upload = sub.add_parser("upload", help="Upload a file to Mureka")
    p_upload.add_argument("file", help="Path to the audio file (mp3, m4a, or mid for melody)")
    p_upload.add_argument("--purpose", required=True,
                          choices=["reference", "vocal", "melody", "instrumental", "voice", "audio"],
                          help="Purpose: reference (30s), vocal (15-30s), melody (5-60s), instrumental (30s), voice (5-15s), audio (general)")

    args = parser.parse_args()

    {"song": cmd_song,
     "instrumental": cmd_instrumental,
     "lyrics": cmd_lyrics,
     "upload": cmd_upload}[args.command](args)


if __name__ == "__main__":
    main()
