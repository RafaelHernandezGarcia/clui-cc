# Clui CC — Command Line User Interface for Claude Code (Windows)

> **Windows version.** This fork is built and tested for Windows. The original macOS version can be found in the [upstream project](https://github.com/lcoutodemos/clui-cc).

A lightweight, transparent desktop overlay for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Clui CC wraps the Claude Code CLI in a floating pill interface with multi-tab sessions, a permission approval UI, voice input, and a skills marketplace.

## Demo

[![Watch the demo](https://img.youtube.com/vi/NqRBIpaA4Fk/maxresdefault.jpg)](https://www.youtube.com/watch?v=NqRBIpaA4Fk)

<p align="center"><a href="https://www.youtube.com/watch?v=NqRBIpaA4Fk">▶ Watch the full demo on YouTube</a></p>

## Features

- **Floating overlay** — transparent, click-through window that stays on top. Toggle with `Alt+Space`.
- **Multi-tab sessions** — each tab spawns its own `claude -p` process with independent session state.
- **Permission approval UI** — intercepts tool calls via PreToolUse HTTP hooks so you can review and approve/deny from the UI.
- **Conversation history** — browse and resume past Claude Code sessions.
- **Skills marketplace** — install plugins from Anthropic's GitHub repos without leaving Clui CC.
- **Voice input** — local speech-to-text via Whisper (no cloud transcription).
- **File & screenshot attachments** — paste images or attach files directly.
- **Dual theme** — dark/light mode with system-follow option.

## Why Clui CC Is Different

- **Claude Code, but visual** — keep CLI power while getting a fast desktop UX for approvals, history, and multitasking.
- **Human-in-the-loop safety** — tool calls can be reviewed/approved in-app before execution.
- **Session-native workflow** — each tab runs an independent Claude session you can resume later.
- **Mostly local-first** — core behavior runs through your local Claude CLI, with minimal network dependency.

## Architecture At a Glance

Clui CC is an Electron app with three layers:

```
Renderer (React UI) -> Preload bridge -> Main process (ControlPlane/RunManager/PermissionServer)
```

Flow:

1. UI sends a prompt from a tab.
2. Main process starts `claude -p` for that tab.
3. Stream events are normalized and rendered live.
4. Tool permission requests are intercepted and shown in the approval UI.
5. Session state is tracked so you can resume work.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full technical deep-dive.

## Quick Start (Recommended)

Run these commands one at a time:

**1) Clone the repo**

```bash
git clone https://github.com/RafaelHernandezGarcia/clui-cc.git
```

**2) Enter the project folder**

```bash
cd clui-cc
```

**3) Start the app**

**macOS:**
```bash
./start.command
```

**Windows (PowerShell):**
```powershell
.\start.ps1
```

Optional on macOS (install voice dependency automatically first):
```bash
./start.command --with-voice
```

The start script runs environment checks first and prints exact fix commands if something is missing. If checks pass, it installs dependencies, builds, and launches the app.

To close the app:
- **macOS:** `./stop.command` or tray icon > Quit
- **Windows:** `.\stop.ps1` or tray icon > Quit

Toggle the overlay: **Alt+Space** (or **Cmd+Shift+K** / **Ctrl+Shift+K** as fallback).

<details>
<summary><strong>Setup Prerequisites (Detailed)</strong></summary>

### Windows

1. **Node.js** (v18+): Download from [nodejs.org](https://nodejs.org) or `winget install OpenJS.NodeJS.LTS`
2. **Claude Code CLI:** `npm install -g @anthropic-ai/claude-code`
3. **Authenticate:** Run `claude` and follow the prompts
4. **Verify:** `claude --version` (should print 2.1.x or higher)

**Optional:** Whisper for voice input — `scoop install whisper-cpp` or `pip install openai-whisper`

### macOS (13+)

**Step 1.** Xcode Command Line Tools: `xcode-select --install`

**Step 2.** Node.js (v18+): `brew install node` or [nodejs.org](https://nodejs.org)

**Step 3.** Python setuptools: `python3 -m pip install --upgrade pip setuptools`

**Step 4.** Claude Code CLI: `npm install -g @anthropic-ai/claude-code`

**Step 5.** Authenticate: `claude` (follow prompts)

**Step 6.** Verify: `claude --version` (should print 2.1.x or higher)

**Optional:** Whisper for voice input: `brew install whisper-cli`

> **No API keys or `.env` file required.** Clui CC uses your existing Claude Code CLI authentication (Pro/Team/Enterprise subscription).

</details>

<details>
<summary><strong>Development Commands</strong></summary>

### Hot Reload

If you are actively developing:

```bash
npm install
```

```bash
npm run dev
```

Renderer changes update instantly. Main-process changes require restarting `npm run dev`.

### Production Build

```bash
npm run build
```

```bash
npx electron .
```

</details>

<details>
<summary><strong>Architecture and Internals</strong></summary>

Clui CC is an Electron app with three layers:

```
┌─────────────────────────────────────────────────┐
│  Renderer (React 19 + Zustand + Tailwind CSS 4) │
│  Components, theme, state management             │
├─────────────────────────────────────────────────┤
│  Preload (window.clui bridge)                    │
│  Secure IPC surface between renderer and main    │
├─────────────────────────────────────────────────┤
│  Main Process                                    │
│  ControlPlane → RunManager → claude -p (NDJSON)  │
│  PermissionServer (HTTP hooks on 127.0.0.1)      │
│  Marketplace catalog (GitHub raw fetch + cache)   │
└─────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full deep-dive.

### Project Structure

```
src/
├── main/                   # Electron main process
│   ├── claude/             # ControlPlane, RunManager, EventNormalizer
│   ├── hooks/              # PermissionServer (PreToolUse HTTP hooks)
│   ├── marketplace/        # Plugin catalog fetching + install
│   ├── skills/             # Skill auto-installer
│   └── index.ts            # Window creation, IPC handlers, tray
├── renderer/               # React frontend
│   ├── components/         # TabStrip, ConversationView, InputBar, etc.
│   ├── stores/             # Zustand session store
│   ├── hooks/              # Event listeners, health reconciliation
│   └── theme.ts            # Dual palette + CSS custom properties
├── preload/                # Secure IPC bridge (window.clui API)
└── shared/                 # Canonical types, IPC channel definitions
```

### How It Works

1. Each tab creates a `claude -p --output-format stream-json` subprocess.
2. NDJSON events are parsed by `RunManager` and normalized by `EventNormalizer`.
3. `ControlPlane` manages tab lifecycle (connecting → idle → running → completed/failed/dead).
4. Tool permission requests arrive via HTTP hooks to `PermissionServer` (localhost only).
5. The renderer polls backend health every 1.5s and reconciles tab state.
6. Sessions are resumed with `--resume <session-id>` for continuity.

### Network Behavior

Clui CC operates almost entirely offline. The only outbound network calls are:

| Endpoint | Purpose | Required |
|----------|---------|----------|
| `raw.githubusercontent.com/anthropics/*` | Marketplace catalog (cached 5 min) | No — graceful fallback |
| `api.github.com/repos/anthropics/*/tarball/*` | Skill auto-install on startup | No — skipped on failure |

No telemetry, analytics, or auto-update mechanisms. All core Claude Code interaction goes through the local CLI.

</details>

## Troubleshooting

For setup issues and recovery commands, see [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

Quick self-check:

```bash
npm run doctor
```

## Tested On

| Component | Version |
|-----------|---------|
| macOS | 15.x (Sequoia) |
| Node.js | 20.x LTS, 22.x |
| Python | 3.12 (with setuptools installed) |
| Electron | 33.x |
| Claude Code CLI | 2.1.71 |

## Known Limitations

- **macOS and Windows** — Linux support is not currently implemented.
- **Requires Claude Code CLI** — Clui CC is a UI layer, not a standalone AI client. You need an authenticated `claude` CLI.
- **Permission mode** — uses `--permission-mode default`. The PTY interactive transport is legacy and disabled by default.

## Author

**Rafael Hernandez Garcia** — [@RafaelHernandezGarcia](https://github.com/RafaelHernandezGarcia) · Montreal, Canada

## License

[MIT](LICENSE)
