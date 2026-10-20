#!/usr/bin/env python3
"""Host-side Slack relay for Claude sandboxes.

Sandboxes cannot see the Slack token. Their `sandbox-notify` MCP server sends
one JSON line per message over a unix socket (mounted into each sandbox that
has SANDBOX_NOTIFY=1); this relay posts it as a DM to the owner, and only to
the owner. The token and the owner's user ID are read from
~/.config/claude-sandbox/slack.env on every message, so edits apply at once:

    SLACK_BOT_TOKEN=xoxb-...
    SLACK_USER_ID=U0123456789

Usage:
    notify-relay.py            run the relay (exits at once if one is running)
    notify-relay.py --test     send a test DM directly (checks the config)

The `claude-sandbox` launcher starts the relay in the background. Its log is
~/.cache/claude-sandbox/notify-relay.log (host only, not visible to sandboxes).
"""
import base64
import collections
import fcntl
import json
import os
import socketserver
import sys
import threading
import time
import urllib.parse
import urllib.request

CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"),
                     "claude-sandbox")
SOCK_DIR = os.path.join(CACHE, "notify")      # mounted into sandboxes (read-only)
SOCK = os.path.join(SOCK_DIR, "relay.sock")
LOCK = os.path.join(CACHE, "notify-relay.lock")
CONF = os.path.expanduser("~/.config/claude-sandbox/slack.env")

MAX_REQUEST = 8 * 1024 * 1024    # one JSON line, file included (base64)
MAX_FILE = 5 * 1024 * 1024
MAX_TEXT = 3500
RATE_PER_SANDBOX = 20            # messages per hour
RATE_TOTAL = 60

HEADS = {
    "escalation": ":rotating_light: *Needs your input*",
    "progress": ":hourglass_flowing_sand: *Progress*",
    "done": ":white_check_mark: *Finished*",
    "waiting": ":double_vertical_bar: *Waiting for you*",
}

_sent = collections.defaultdict(collections.deque)
_lock = threading.Lock()


def log(*args):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *args, flush=True)


def load_conf():
    conf = {}
    try:
        with open(CONF) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    conf[k.strip()] = v.strip().strip("'\"")
    except FileNotFoundError:
        raise RuntimeError(f"Slack is not set up on the host ({CONF} missing)")
    for key in ("SLACK_BOT_TOKEN", "SLACK_USER_ID"):
        if not conf.get(key):
            raise RuntimeError(f"{key} missing in {CONF}")
    return conf


def api(token, method, form=None, body=None):
    if body is not None:
        data, ctype = json.dumps(body).encode(), "application/json; charset=utf-8"
    else:
        data, ctype = urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded"
    req = urllib.request.Request("https://slack.com/api/" + method, data,
                                 {"Authorization": "Bearer " + token, "Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r)
    if not res.get("ok"):
        raise RuntimeError(f"Slack {method} failed: {res.get('error')}")
    return res


def check_rate(sandbox):
    now = time.time()
    with _lock:
        for q in _sent.values():
            while q and q[0] < now - 3600:
                q.popleft()
        if len(_sent[sandbox]) >= RATE_PER_SANDBOX:
            raise RuntimeError(f"rate limit: {RATE_PER_SANDBOX} messages per hour per sandbox")
        if sum(len(q) for q in _sent.values()) >= RATE_TOTAL:
            raise RuntimeError(f"rate limit: {RATE_TOTAL} messages per hour in total")
        _sent[sandbox].append(now)


def post(sandbox, kind, text, file=None):
    conf = load_conf()
    token, user = conf["SLACK_BOT_TOKEN"], conf["SLACK_USER_ID"]
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT] + " …(truncated)"
    # The DM goes to the owner's user ID only; the sandbox cannot choose a channel.
    msg = api(token, "chat.postMessage", body={
        "channel": user, "text": f"{HEADS[kind]} from `{sandbox}`\n{text}",
        "unfurl_links": False, "unfurl_media": False})
    if file:
        data = base64.b64decode(file["b64"], validate=True)
        if len(data) > MAX_FILE:
            raise RuntimeError(f"file larger than {MAX_FILE // 2**20} MB")
        name = os.path.basename(str(file["name"]))[:200] or "file"
        up = api(token, "files.getUploadURLExternal", form={"filename": name, "length": len(data)})
        req = urllib.request.Request(up["upload_url"], data,
                                     {"Content-Type": "application/octet-stream"})
        urllib.request.urlopen(req, timeout=60).read()
        api(token, "files.completeUploadExternal", form={
            "files": json.dumps([{"id": up["file_id"], "title": name}]),
            "channel_id": msg["channel"], "thread_ts": msg["ts"]})


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        sandbox = "?"
        try:
            line = self.rfile.readline(MAX_REQUEST + 1)
            if len(line) > MAX_REQUEST:
                raise RuntimeError("request too large")
            req = json.loads(line)
            sandbox = str(req.get("sandbox") or "sandbox").replace("`", "'")[:120]
            kind = req.get("kind")
            text = str(req.get("message") or "").strip()
            if kind not in HEADS:
                raise RuntimeError(f"unknown kind {kind!r}")
            if not text:
                raise RuntimeError("empty message")
            check_rate(sandbox)
            post(sandbox, kind, text, req.get("file"))
            log("sent", sandbox, kind, repr(text[:200]), "+file" if req.get("file") else "")
            reply = {"ok": True}
        except Exception as e:   # report every failure back to the sandbox
            log("error", sandbox, e)
            reply = {"ok": False, "error": str(e)}
        self.wfile.write((json.dumps(reply) + "\n").encode())


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def main():
    if sys.argv[1:2] == ["--test"]:
        post(os.uname().nodename, "progress", "Test message from notify-relay.py --test.",
             {"name": "test.txt", "b64": base64.b64encode(b"test attachment\n").decode()})
        print("Sent. Check your Slack DMs from the bot (one message with a file in its thread).")
        return
    os.makedirs(SOCK_DIR, exist_ok=True)
    os.chmod(SOCK_DIR, 0o755)
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return   # already running
    if os.path.exists(SOCK):
        os.unlink(SOCK)
    server = Server(SOCK, Handler)
    # The container user may have another uid; only sandboxes that mount the
    # socket folder can reach it (~/.cache is private to the owner on the host).
    os.chmod(SOCK, 0o666)
    log("relay listening on", SOCK)
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        sys.exit(f"notify-relay: {e}")
