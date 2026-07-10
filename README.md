# 🎮 BlockHost — free, self-hosted game server panel

Host **Minecraft** and **Terraria** servers for free, from a clean web UI in
Chrome, Safari, or any browser. No accounts, no credits, no paywalls — the
trick is that *your own computer* is the host. BlockHost is just the control
panel that makes it one-click.

![panel](https://img.shields.io/badge/dependencies-none-brightgreen)
![python](https://img.shields.io/badge/python-3.8%2B-blue)

## Quick start

```bash
python3 server.py
```

Then open **http://localhost:8080** in your browser. That's it — no
`pip install`, no Node, no Docker. Only the Python standard library is used.

From another device on your Wi-Fi (like your phone), open
`http://<your-computer's-IP>:8080` — the panel prints the address when it
starts.

## What you can do

- **Pick a game** with one click: Minecraft (Java Edition) or Terraria.
- **Pick a version**: live list from Mojang for Minecraft, official
  Re-Logic builds for Terraria.
- **Configure resources**: RAM slider, CPU core limit, max players, port,
  world seed. (GPU? Game servers don't use one — it's CPU + RAM only.)
- **Choose uptime**: run until you stop it, or auto-stop after
  30 min / 1 h / 3 h / 6 h / 12 h / 24 h.
- **Live console**: watch server logs in real time and send commands
  (`say hi`, `op <player>`, `time set day`, ...).
- **Start / stop / delete** servers from the panel; worlds persist between
  restarts in the `instances/` folder.

BlockHost downloads the *official* dedicated server files on first start
(Minecraft `server.jar` from Mojang, Terraria server from terraria.org), so
servers are 100% vanilla and legit. For Minecraft you must tick the box
accepting the [Minecraft EULA](https://aka.ms/MinecraftEULA).

## Requirements

| Game      | What the host machine needs                          |
|-----------|------------------------------------------------------|
| Minecraft | Java 21+ for 1.20.5+, Java 17 for 1.17–1.20.4        |
| Terraria  | Nothing extra — the official server binary is self-contained (Linux x86_64, macOS, Windows) |

Plus Python 3.8+ to run the panel itself. The panel shows a warning banner
if Java is missing.

## How friends join

1. Start the server and wait for the **READY** line in the console.
2. **Same Wi-Fi**: they connect to `<your-LAN-IP>:<port>` (shown on the
   server card). Minecraft default port `25565`, Terraria `7777`.
3. **Over the internet**: either forward the port on your router to this
   machine, or use a free tunnel such as [playit.gg](https://playit.gg) or
   `ngrok tcp <port>` and share the address it prints. No paid hosting
   needed.

## A note about running this in iSH (iPhone terminal)

The panel itself runs fine in iSH (`apk add python3`, then
`python3 server.py`), and you can open the UI in Safari at
`http://localhost:8080`. **But** iSH emulates an x86 CPU very slowly and
can't run Java or x86_64 binaries, so the *game servers themselves* won't
run on an iPhone — that's a hardware limitation, not a BlockHost one.

To actually host games for free, run BlockHost on any of these instead:

- an old laptop / desktop (Windows, macOS, Linux — anything with Python),
- a Raspberry Pi (Minecraft works; use `paper` builds for speed),
- a free-tier cloud VM (e.g. Oracle Cloud "Always Free" ARM VM).

You can still *control* it from your phone: run the panel on the computer,
then open `http://<computer-ip>:8080` in Safari on your phone. Full remote
control — create, start, stop, console — from the couch.

## Verified working

Tested end-to-end: a Minecraft 1.21.8 server was created through the API,
downloaded from Mojang, launched, answered a real Minecraft protocol status
ping (correct MOTD and player limit), accepted console commands, and shut
down gracefully. A Terraria 1.4.4.9 server was downloaded from terraria.org,
generated a world, and listened on its port.

## Layout

```
server.py        the whole backend (Python stdlib only)
static/          the web UI (plain HTML/CSS/JS, no frameworks)
instances/       created at runtime — one folder per server (worlds, configs)
```

## Safety notes

- The panel binds to `0.0.0.0` so other devices on your network can reach
  it. It has **no login** — don't expose port 8080 to the open internet
  (exposing the *game* ports is fine; that's how friends join).
- Auto-stop uses a graceful shutdown (`stop` / `exit` command) so worlds
  save before the process exits.
