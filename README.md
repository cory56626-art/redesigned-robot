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
- **World options**: world size (Terraria: small / medium / large),
  difficulty (Terraria: classic / expert / master / journey — Minecraft:
  peaceful / easy / normal / hard), and an optional server **password**
  (Terraria).
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

### Terraria mobile players ("connecting to session…" forever)

**The vanilla dedicated server cannot do mobile crossplay.** Mobile and
console Terraria use a different network protocol than PC, and the plain
`TerrariaServer` binary can't translate it — so a phone hangs on
*"connecting to session…"* forever, **even when PC and mobile are on the
exact same version**. This is a Terraria limitation, not a BlockHost bug.
(BlockHost still sets `upnp=1` so the port is reachable, which matters for
remote *PC* players, but reachability was never the mobile problem.)

To actually get mobile/console players in, run a **modded server that
translates the packets** — TShock plus the Crossplay plugin:

1. Download **TShock** matching your Terraria version (1.4.5.6 →
   TShock 6.1) from
   [github.com/Pryaxis/TShock](https://github.com/Pryaxis/TShock/releases)
   and run it once so it generates its folders (incl. `ServerPlugins`).
   TShock needs the .NET 9 runtime on the host.
2. Download **`Crossplay.dll`** from
   [github.com/Moneylover3246/Crossplay](https://github.com/Moneylover3246/Crossplay/releases)
   and place it in TShock's `ServerPlugins` folder.
3. Restart TShock, load/create your world, then on mobile:
   **Multiplayer → Join via IP →** the host's address and port 7777.

Everything has to be on the same Terraria version — TShock, the Crossplay
plugin, PC and mobile. If the plugin hasn't been rebuilt for the newest
Terraria version yet, mobile crossplay has to wait for that plugin update.
A PC-only Terraria server needs none of this and works out of the box.

> BlockHost runs the vanilla server, so it's great for PC (and PC↔PC over
> the internet). Automating the TShock + Crossplay path inside the panel
> is a possible future addition — it wasn't shipped here because it can't
> be verified without a .NET host and a plugin build confirmed for the
> current version.

## Running it on an iPhone (iSH / a-Shell / Termius)

The panel runs on a phone, and it now **detects what the device can
host** and says so right in the UI instead of failing mysteriously. Be
aware up front: iPhones can't run Java or x86_64 binaries and iOS
suspends backgrounded apps, so on a phone you get the panel — not the
game servers themselves. For actually-free hosting from a phone, use a
free remote host: **fps.ms** (Terraria, free, renew daily with one tap)
or **Aternos** (Minecraft, free). Full remote control of BlockHost works
great from a phone when `server.py` runs on any computer or VPS.

> **First**: this repo is currently private, so downloads from a phone
> will ask for a login. Easiest fix: on github.com open the repo →
> Settings → General → Danger Zone → **Change visibility → Public**.
> (Or create a personal access token and use it as the clone password.)

### iSH

Run each of these one at a time:

```
apk update
```

```
apk add python3 git
```

```
git clone -b claude/game-server-hosting-app-hsl74v https://github.com/cory56626-art/redesigned-robot
```

```
cd redesigned-robot
```

```
python3 server.py
```

Then open Safari and go to `http://localhost:8080`. Tip: in iSH settings,
allow Location access so iOS keeps iSH alive in the background longer.

### a-Shell

a-Shell has Python built in but no git; grab the code as an archive:

```
curl -Lo blockhost.tar.gz https://github.com/cory56626-art/redesigned-robot/archive/refs/heads/claude/game-server-hosting-app-hsl74v.tar.gz
```

```
tar xzf blockhost.tar.gz
```

```
cd redesigned-robot-claude-game-server-hosting-app-hsl74v
```

```
python3 server.py
```

Then open `http://localhost:8080` in Safari. a-Shell's sandbox can't
launch external programs, so expect the "panel-only" banner there.

### Termius

Termius has no local shell to run apps in — it's for connecting *to*
servers. Use it to SFTP into a machine running BlockHost (or into a free
host like fps.ms, whose panel gives you SFTP credentials) to manage world
files from your phone.

## Verified working

Tested end-to-end: a Minecraft 1.21.8 server was created through the API,
downloaded from Mojang, launched, answered a real Minecraft protocol status
ping (correct MOTD and player limit), accepted console commands, and shut
down gracefully. A Terraria 1.4.5.6 server (the current latest) was
downloaded from terraria.org, generated a world, and listened on its port.

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
