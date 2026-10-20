---
name: sandbox
description: Create or change a container sandbox (devcontainer) for running Claude Code isolated from the host. Use when the user asks to "create a sandbox", "set up a sandbox for claude", "give the sandbox access to <folder>/github", "remove access to ...", asks what a sandbox can see, or wants a sandbox to reach them on Slack (escalations, progress summaries). The sandbox is started with the user's `claude-sandbox` / `claude-sci-sandbox` shell commands.
---

# Claude sandbox

A sandbox is a `.devcontainer/` folder in the project. The user starts it with
`claude-sandbox` (personal account) or `claude-sci-sandbox` (Teams for
Scientists account); both also work via VS Code "Reopen in Container". Inside,
Claude runs as user `vscode`, sees only what is mounted, and starts in the
permission mode chosen for that sandbox (Shift+Tab switches mode in a session).

Claude accounts inside the sandbox: each sandbox has its own, initially empty
config volumes (`claude-${devcontainerId}`, `claude-sci-${devcontainerId}`), so
it knows nothing about host sessions or other sandboxes. **Each sandbox has
its own login**: on the first start of each account, run `/login` inside (it
prints a URL to open in the host browser); the login stays in the sandbox's
volume. No token is ever copied between host and sandbox, because a login
shared by several Claude instances breaks whichever one did not renew it last.
Before each start the launcher copies only the onboarding flags
(`hasCompletedOnboarding`, `lastOnboardingVersion`) of the host's
`.claude.json` (`~/.claude` for `claude-sandbox`, `~/.claude-sci` for
`claude-sci-sandbox`), so the welcome screens are skipped. Host settings,
plugins, skills, MCP tokens, history and sessions are never copied.

Templates: `templates/` next to this file (`Dockerfile`, `devcontainer.json`,
`restore-env.sh`, `notify/`). Host-side helper: `host/notify-relay.py`.

## Creating a sandbox

1. **Work out the request.** Ask only about things that are unclear:
   - **Project folder**: the current working directory unless the user names
     another. It is always mounted read-write at the same path.
   - **Extra folders**: expand `~` and relative paths to absolute paths and check
     they exist. **Read-only by default**; read-write only if the user says so
     ("write access", "can edit", ...).
   - **GitHub**: yes if the user mentions GitHub, gh, pushing, PRs, issues.
   - **Permission mode**: always ask with AskUserQuestion (unless the user
     already said which), offering:
     - **Auto mode (Recommended)**: most actions run without asking, but a
       safety check reviews each one and blocks or asks about risky ones
       (deleting data, force-pushing, sending files out). Small delay per action.
     - **Skip permissions**: every action runs with no checks. Fastest; the
       container is then the only protection, and it does not protect
       read-write folders, the GitHub token, or the open network.
   - **Slack DMs** (escalations and progress summaries to the user, see below):
     on by default; leave out only if the user says so.
   - **Toolchains**: R and Python/conda are both included by default. Drop a
     block if the user says it is not needed, or if the project clearly only
     uses one (e.g. only `.py` files, or only `.R`/`DESCRIPTION`).
2. **If `.devcontainer/` already exists**, read it first. If it was made by this
   skill (`"name": "claude-sandbox"`), update it in place. Otherwise tell the user
   it exists and ask before replacing it.
3. **Write `<project>/.devcontainer/`**:
   - Copy `restore-env.sh` unchanged, and the `notify/` folder unchanged
     (unless Slack DMs are off).
   - Copy `Dockerfile`, deleting each unwanted `# >>> X` ... `# <<< X` block
     (`Notify` goes when Slack DMs are off).
     Keep the marker comments of kept blocks.
   - Copy `devcontainer.json` and fill in:
     - one entry in `mounts` per extra folder, same path inside and out:
       `"source=/abs/path,target=/abs/path,type=bind,readonly"` (omit
       `,readonly` for read-write). Remove the example comment once real mounts exist.
     - `"SANDBOX_GITHUB": "1"` if GitHub access was requested, else `"0"`.
     - `"SANDBOX_PERMISSION_MODE"`: `"auto"` or `"bypassPermissions"` (= skip permissions).
     - `"SANDBOX_NOTIFY"`: `"1"` (default) or `"0"`; with `"0"` also delete the
       `notify` socket mount line. `SANDBOX_SUMMARY_MINUTES` /
       `SANDBOX_DONE_MINUTES` only if the user wants other intervals.
   - Never mount `~` itself, `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.claude*`, or
     other credential folders (the sandbox has its own login). If the
     user asks for one, explain the risk and ask them to confirm.
   - **Older sandboxes** mount the shared `claude-sandbox-config` /
     `claude-sci-sandbox-config` volumes or a `~/.claude-sci` bind mount;
     replace those two mount lines with the template's per-sandbox volumes.
4. **Summarise** in a few lines: what the sandbox can see (project rw, each extra
   folder ro/rw, GitHub yes/no) and how to start it:
   `claude-sandbox` or `claude-sci-sandbox` from this folder. Mention that the
   first start builds the image (several minutes, R adds most) and that each
   account needs one `/login` inside the sandbox on its first start (the
   login then persists); nothing from the host Claude config is used. If
   `~/.config/claude-sandbox/slack.env` does not exist yet, point them to the
   one-time Slack setup below.

## Slack DMs (escalation and progress summaries)

With `SANDBOX_NOTIFY` `"1"`, Claude in the sandbox has one MCP tool,
`notify_owner(kind, message, file_path?)`, which DMs the user on Slack.
`kind` is one of these:
- `escalation`: Claude is blocked on a decision or on access only the user has.
- `progress`: an interim summary.
- `done`: a long run has finished.

The MCP server's instructions tell Claude when to use each kind. Hooks track
how long Claude has run *unattended*, measured from the user's last prompt in
the session:
- Every `SANDBOX_SUMMARY_MINUTES` (default 1440, i.e. once a day) they remind Claude to send a
  progress summary.
- After a run longer than `SANDBOX_DONE_MINUTES` (default 20), they make
  Claude send a `done` or `escalation` message before it stops.
- In the same situation, they forward permission prompts directly, because a
  stuck Claude cannot send anything itself.

It is one-way: the user answers in the sandbox terminal, not in Slack.

How it works, and why the sandbox cannot reach anyone else:
- The bot token never enters the container. `host/notify-relay.py` runs on
  the host (the launcher starts it once, in the background). It reads
  `~/.config/claude-sandbox/slack.env` on every message and posts only to
  `SLACK_USER_ID`. It is rate-limited to 20 messages/hour per sandbox and 60
  in total, with files up to 5 MB, attached in the message's thread.
- Sandboxes reach the relay through the socket in
  `~/.cache/claude-sandbox/notify/`, mounted read-only at
  `/run/sandbox-notify`.
- The MCP server and hooks (`notify/` → `/opt/sandbox-notify` in the image)
  use node only, which every sandbox has. The launcher loads them with
  `--mcp-config` / `--settings`, so nothing is written to the login volume.
- Host relay log: `~/.cache/claude-sandbox/notify-relay.log`. To restart the
  relay after changing `notify-relay.py`, run
  `pkill -f notify-relay.py`; the next sandbox start launches it again.

One-time Slack setup (on the host, by the user; walk them through it if asked):
1. At api.slack.com/apps, create an app ("From scratch") in the workspace.
   Under *OAuth & Permissions → Bot Token Scopes*, add `chat:write` and
   `files:write`. Install it to the workspace and copy the *Bot User OAuth
   Token* (`xoxb-...`).
2. Under *App Home*, enable the *Messages Tab* so the DMs show up under the
   app.
3. Find the user's member ID: Slack profile → ⋯ → *Copy member ID* (`U...`).
4. Write `~/.config/claude-sandbox/slack.env` with mode 600, outside
   Nextcloud and dotfiles:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_USER_ID=U...
   ```
5. Test it with `claude-sandbox-notify-test`. It sends a DM with a small file.

Never put the token in the project, the image, `devcontainer.json` or the
dotfiles.

## Changing a sandbox

Edit `.devcontainer/devcontainer.json` (mounts, `SANDBOX_GITHUB`,
`SANDBOX_PERMISSION_MODE`) or the
`Dockerfile`. The launcher notices changed files and rebuilds the container on
the next start; tell the user to exit any running sandbox session first.

## Notes

- The sandbox holds its own login token (in its volume), but no host Claude
  data. Its own sessions stay in its volume
  (`claude --resume` inside works; they do not appear on the host).
- VS Code "Reopen in Container" uses the same login in the sandbox volume
  (asks for one if none).
- GitHub access works by the launcher passing `GH_TOKEN="$(gh auth token)"` from
  the host when the session starts. The token is never written to the project
  or the image. `git push` over https works through gh's credential helper.
- Network access is open. Software Claude installs inside with `sudo apt` is
  lost on rebuild unless listed in `apt-packages.txt`; conda envs come back from
  `environment.yml`, R packages from `pkg.lock` (see `restore-env.sh`).
- Slack DMs and their hooks only work through `claude-sandbox` /
  `claude-sci-sandbox`, not in VS Code "Reopen in Container". The socket
  folder must also exist before VS Code can start the container, and the
  launcher creates it.
- **Adding Slack DMs to an older sandbox**: copy `notify/`, add the Notify
  block to the `Dockerfile`, and add the socket mount and `SANDBOX_NOTIFY` to
  `devcontainer.json`. The next start rebuilds it.
- The permission mode applies to the `claude-sandbox` / `claude-sci-sandbox`
  commands. VS Code "Reopen in Container" always starts in auto mode, because
  its setting lives in the login volume shared by all sandboxes.
- Stop a running sandbox with `claude-sandbox-stop` from the project folder.
