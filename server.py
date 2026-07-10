#!/usr/bin/env python3
"""
BlockHost — a free, self-hosted game server control panel.

Run `python3 server.py`, open http://localhost:8080 in any browser
(Chrome, Safari, or even a text browser), pick a game, configure
RAM / CPU / uptime, and BlockHost downloads the official dedicated
server and runs it on THIS machine. No accounts, no credits, no cost:
the computer running this script is the host.

Only the Python standard library is used, so it works on any OS with
Python 3.8+ (Linux, macOS, Windows, a VPS, a Raspberry Pi, ...).
"""

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
import zipfile
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT, "static")
INSTANCES_DIR = os.path.join(ROOT, "instances")

PANEL_PORT = int(os.environ.get("BLOCKHOST_PORT", "8080"))

MC_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"

# Vanilla dedicated-server builds published by Re-Logic. The zip contains
# Windows, Mac and Linux builds; we launch the one matching this OS.
TERRARIA_VERSIONS = {
    "1.4.4.9": "1449",
    "1.4.3.6": "1436",
    "1.4.2.3": "1423",
}
TERRARIA_ZIP_URL = "https://terraria.org/api/download/pc-dedicated-server/terraria-server-{build}.zip"

USER_AGENT = "BlockHost/1.0 (self-hosted game server panel)"


def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=timeout)


def fetch_json(url):
    with http_get(url) as resp:
        return json.loads(resp.read().decode("utf-8"))


def total_ram_mb():
    try:
        if hasattr(os, "sysconf") and "SC_PHYS_PAGES" in os.sysconf_names:
            return os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE") // (1024 * 1024)
    except (ValueError, OSError):
        pass
    return 4096  # sensible fallback when the OS won't tell us


def java_version():
    """Return the installed Java major version, or None."""
    java = shutil.which("java")
    if not java:
        return None
    try:
        out = subprocess.run([java, "-version"], capture_output=True, text=True, timeout=20)
        m = re.search(r'version "([0-9._]+)"', out.stderr + out.stdout)
        if not m:
            return None
        parts = m.group(1).split(".")
        return int(parts[1]) if parts[0] == "1" else int(parts[0])
    except (subprocess.SubprocessError, OSError, ValueError):
        return None


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


class Instance:
    """One configured game server (a directory under instances/)."""

    def __init__(self, config):
        self.config = config
        self.id = config["id"]
        self.dir = os.path.join(INSTANCES_DIR, self.id)
        self.proc = None
        self.status = "stopped"   # stopped | downloading | starting | running | stopping | error
        self.status_detail = ""
        self.console = deque(maxlen=500)
        self.console_seq = 0      # id of the next line to be appended
        self.stop_timer = None
        self.started_at = None
        self.lock = threading.Lock()

    # ---------- console ----------

    def log(self, line):
        with self.lock:
            self.console.append((self.console_seq, line.rstrip("\n")))
            self.console_seq += 1

    def console_since(self, since):
        with self.lock:
            return [{"i": i, "t": t} for i, t in self.console if i >= since], self.console_seq

    # ---------- serialization ----------

    def to_dict(self):
        d = dict(self.config)
        d["status"] = self.status
        d["status_detail"] = self.status_detail
        d["started_at"] = self.started_at
        if self.started_at and self.config.get("duration_min"):
            d["stops_at"] = self.started_at + self.config["duration_min"] * 60
        return d

    def save(self):
        os.makedirs(self.dir, exist_ok=True)
        with open(os.path.join(self.dir, "config.json"), "w") as f:
            json.dump(self.config, f, indent=2)

    # ---------- download / install ----------

    def ensure_installed(self):
        game = self.config["game"]
        if game == "minecraft":
            self._install_minecraft()
        elif game == "terraria":
            self._install_terraria()
        else:
            raise RuntimeError(f"unknown game {game!r}")

    def _download(self, url, dest, label):
        self.log(f"[blockhost] downloading {label} ...")
        tmp = dest + ".part"
        with http_get(url, timeout=600) as resp, open(tmp, "wb") as f:
            total = int(resp.headers.get("Content-Length") or 0)
            done, last_pct = 0, -1
            while True:
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if total:
                    pct = done * 100 // total
                    if pct >= last_pct + 10:
                        last_pct = pct
                        self.log(f"[blockhost] {label}: {pct}% ({done // (1024*1024)} MB)")
        os.replace(tmp, dest)
        self.log(f"[blockhost] {label} downloaded.")

    def _install_minecraft(self):
        jar = os.path.join(self.dir, "server.jar")
        if not os.path.exists(jar):
            manifest = fetch_json(MC_MANIFEST_URL)
            version = self.config["version"]
            entry = next((v for v in manifest["versions"] if v["id"] == version), None)
            if entry is None:
                raise RuntimeError(f"Minecraft version {version} not found")
            detail = fetch_json(entry["url"])
            self._download(detail["downloads"]["server"]["url"], jar, f"Minecraft {version} server")

        # The Mojang EULA must be accepted by the user (checkbox at create time).
        with open(os.path.join(self.dir, "eula.txt"), "w") as f:
            f.write("eula=%s\n" % ("true" if self.config.get("eula") else "false"))

        props = {
            "server-port": str(self.config["port"]),
            "max-players": str(self.config["max_players"]),
            "motd": self.config["name"],
            "enable-command-block": "true",
            "online-mode": "true",
            "level-seed": self.config.get("seed", ""),
        }
        prop_path = os.path.join(self.dir, "server.properties")
        existing = {}
        if os.path.exists(prop_path):
            with open(prop_path) as f:
                for line in f:
                    if "=" in line and not line.startswith("#"):
                        k, _, v = line.partition("=")
                        existing[k.strip()] = v.rstrip("\n")
        existing.update(props)
        with open(prop_path, "w") as f:
            for k, v in existing.items():
                f.write(f"{k}={v}\n")

    def _terraria_binary(self):
        plat = sys.platform
        if plat.startswith("linux"):
            name = "TerrariaServer.bin.x86_64"
            sub = "Linux"
        elif plat == "darwin":
            name = "TerrariaServer.bin.osx"
            sub = "Mac"
        else:
            name = "TerrariaServer.exe"
            sub = "Windows"
        return os.path.join(self.dir, "srv", sub, name)

    def _install_terraria(self):
        binary = self._terraria_binary()
        if not os.path.exists(binary):
            build = TERRARIA_VERSIONS[self.config["version"]]
            zpath = os.path.join(self.dir, "terraria-server.zip")
            if not os.path.exists(zpath):
                self._download(TERRARIA_ZIP_URL.format(build=build), zpath,
                               f"Terraria {self.config['version']} server")
            self.log("[blockhost] extracting server ...")
            srv = os.path.join(self.dir, "srv")
            with zipfile.ZipFile(zpath) as z:
                tmp = os.path.join(self.dir, "srv.tmp")
                z.extractall(tmp)
                # zip layout: <build>/{Linux,Mac,Windows}/...  -> flatten one level
                inner = os.path.join(tmp, os.listdir(tmp)[0])
                if os.path.exists(srv):
                    shutil.rmtree(srv)
                os.replace(inner, srv)
                shutil.rmtree(tmp, ignore_errors=True)
            os.remove(zpath)
            for root, _, files in os.walk(srv):
                for fn in files:
                    if fn.startswith("TerrariaServer"):
                        os.chmod(os.path.join(root, fn), 0o755)
            self.log("[blockhost] extracted.")

        world_dir = os.path.join(self.dir, "worlds")
        os.makedirs(world_dir, exist_ok=True)
        cfg = [
            f"world={os.path.join(world_dir, 'world.wld')}",
            "autocreate=2",                     # medium world if it doesn't exist yet
            f"worldname={self.config['name']}",
            f"port={self.config['port']}",
            f"maxplayers={self.config['max_players']}",
            f"worldpath={world_dir}",
            "npcstream=60",
            "priority=1",
        ]
        seed = self.config.get("seed", "")
        if seed:
            cfg.append(f"seed={seed}")
        with open(os.path.join(self.dir, "serverconfig.txt"), "w") as f:
            f.write("\n".join(cfg) + "\n")

    # ---------- lifecycle ----------

    def build_command(self):
        game = self.config["game"]
        ram = int(self.config["ram_mb"])
        if game == "minecraft":
            cmd = ["java", f"-Xms{min(ram, 512)}M", f"-Xmx{ram}M",
                   "-jar", "server.jar", "nogui"]
            cwd = self.dir
        else:
            binary = self._terraria_binary()
            cmd = [binary, "-config", os.path.join(self.dir, "serverconfig.txt")]
            cwd = os.path.dirname(binary)

        # CPU core limit: use taskset when the OS has it, otherwise best effort.
        cores = int(self.config.get("cpu_cores") or 0)
        if cores and shutil.which("taskset"):
            cores = min(cores, os.cpu_count() or 1)
            cmd = ["taskset", "-c", ",".join(str(i) for i in range(cores))] + cmd
        return cmd, cwd

    def start(self):
        if self.proc and self.proc.poll() is None:
            raise RuntimeError("already running")
        if self.config["game"] == "minecraft" and not self.config.get("eula"):
            raise RuntimeError("Mojang EULA not accepted for this server")
        self.status, self.status_detail = "downloading", "preparing files"
        threading.Thread(target=self._start_thread, daemon=True).start()

    def _start_thread(self):
        try:
            self.ensure_installed()
            self.status, self.status_detail = "starting", "launching process"
            cmd, cwd = self.build_command()
            self.log("[blockhost] launching: " + " ".join(cmd))
            self.proc = subprocess.Popen(
                cmd, cwd=cwd,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=1,
            )
            self.started_at = time.time()
            duration = int(self.config.get("duration_min") or 0)
            if duration > 0:
                self.stop_timer = threading.Timer(duration * 60, self._duration_expired)
                self.stop_timer.daemon = True
                self.stop_timer.start()
                self.log(f"[blockhost] server will auto-stop in {duration} minutes.")
            threading.Thread(target=self._pump_output, daemon=True).start()
        except Exception as e:  # surfaced in the UI
            self.status, self.status_detail = "error", str(e)
            self.log(f"[blockhost] ERROR: {e}")

    def _pump_output(self):
        ready_markers = ("Done (", "Server started", "Listening on port")
        proc = self.proc
        for line in proc.stdout:
            self.log(line)
            if self.status == "starting" and any(m in line for m in ready_markers):
                self.status, self.status_detail = "running", ""
                self.log("[blockhost] server is READY — players can join now.")
        code = proc.wait()
        if self.stop_timer:
            self.stop_timer.cancel()
            self.stop_timer = None
        if self.status not in ("error",):
            self.status = "stopped"
            self.status_detail = f"exited with code {code}"
        self.started_at = None
        self.log(f"[blockhost] server process ended (exit code {code}).")

    def _duration_expired(self):
        self.log("[blockhost] uptime limit reached — stopping server.")
        try:
            self.stop()
        except Exception as e:
            self.log(f"[blockhost] auto-stop failed: {e}")

    def send_command(self, text):
        if not (self.proc and self.proc.poll() is None):
            raise RuntimeError("server is not running")
        self.proc.stdin.write(text + "\n")
        self.proc.stdin.flush()
        self.log(f"> {text}")

    def stop(self):
        proc = self.proc
        if not (proc and proc.poll() is None):
            return
        self.status, self.status_detail = "stopping", ""
        graceful = "stop" if self.config["game"] == "minecraft" else "exit"
        try:
            self.send_command(graceful)
        except (RuntimeError, OSError, ValueError):
            pass
        threading.Thread(target=self._enforce_stop, args=(proc,), daemon=True).start()

    def _enforce_stop(self, proc):
        try:
            proc.wait(timeout=45)
        except subprocess.TimeoutExpired:
            self.log("[blockhost] graceful stop timed out, terminating.")
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()


class Manager:
    def __init__(self):
        self.instances = {}
        self.lock = threading.Lock()
        self._mc_versions_cache = None
        os.makedirs(INSTANCES_DIR, exist_ok=True)
        for entry in sorted(os.listdir(INSTANCES_DIR)):
            cfg_path = os.path.join(INSTANCES_DIR, entry, "config.json")
            if os.path.exists(cfg_path):
                try:
                    with open(cfg_path) as f:
                        cfg = json.load(f)
                    self.instances[cfg["id"]] = Instance(cfg)
                except (json.JSONDecodeError, KeyError, OSError) as e:
                    print(f"skipping instance {entry}: {e}", file=sys.stderr)

    def minecraft_versions(self):
        if self._mc_versions_cache is None:
            manifest = fetch_json(MC_MANIFEST_URL)
            releases = [v["id"] for v in manifest["versions"] if v["type"] == "release"]
            self._mc_versions_cache = releases[:40]
        return self._mc_versions_cache

    def create(self, data):
        name = str(data.get("name") or "").strip() or "My Server"
        game = data.get("game")
        if game not in ("minecraft", "terraria"):
            raise ValueError("game must be 'minecraft' or 'terraria'")
        version = str(data.get("version") or "")
        if game == "terraria" and version not in TERRARIA_VERSIONS:
            raise ValueError("unknown Terraria version")
        if game == "minecraft":
            if version not in self.minecraft_versions():
                raise ValueError("unknown Minecraft version")
            if not data.get("eula"):
                raise ValueError("you must accept the Mojang EULA to run a Minecraft server")

        ram = max(256, min(int(data.get("ram_mb") or 2048), total_ram_mb()))
        cores = max(0, min(int(data.get("cpu_cores") or 0), os.cpu_count() or 1))
        port = int(data.get("port") or (25565 if game == "minecraft" else 7777))
        if not (1024 <= port <= 65535):
            raise ValueError("port must be between 1024 and 65535")
        with self.lock:
            used = {i.config["port"] for i in self.instances.values()}
            if port in used:
                raise ValueError(f"port {port} is already used by another server")
            cfg = {
                "id": uuid.uuid4().hex[:12],
                "name": name[:60],
                "game": game,
                "version": version,
                "ram_mb": ram,
                "cpu_cores": cores,
                "duration_min": max(0, min(int(data.get("duration_min") or 0), 60 * 24 * 30)),
                "port": port,
                "max_players": max(1, min(int(data.get("max_players") or 8), 255)),
                "seed": str(data.get("seed") or "")[:64],
                "eula": bool(data.get("eula")),
                "created_at": time.time(),
            }
            inst = Instance(cfg)
            inst.save()
            self.instances[inst.id] = inst
        return inst

    def delete(self, inst_id):
        with self.lock:
            inst = self.instances.pop(inst_id, None)
        if inst is None:
            raise KeyError(inst_id)
        inst.stop()
        # give a graceful stop a moment before removing files
        def _rm():
            for _ in range(50):
                if not (inst.proc and inst.proc.poll() is None):
                    break
                time.sleep(1)
            shutil.rmtree(inst.dir, ignore_errors=True)
        threading.Thread(target=_rm, daemon=True).start()

    def system_info(self):
        jv = java_version()
        return {
            "os": sys.platform,
            "cpu_count": os.cpu_count() or 1,
            "total_ram_mb": total_ram_mb(),
            "java": jv,
            "java_ok": jv is not None,
            "lan_ip": lan_ip(),
            "panel_port": PANEL_PORT,
            "notes": {
                "gpu": "Game servers are CPU + RAM only — no GPU is used or needed.",
                "java": None if jv else
                        "Java not found: Minecraft needs Java (21+ for recent versions). "
                        "Terraria works without Java.",
            },
        }


MANAGER = Manager()


class Handler(BaseHTTPRequestHandler):
    server_version = "BlockHost/1.0"

    # ---------- helpers ----------

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 1_000_000:
            raise ValueError("request too large")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def serve_static(self, rel):
        path = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not path.startswith(STATIC_DIR) or not os.path.isfile(path):
            self.send_json({"error": "not found"}, 404)
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }.get(os.path.splitext(path)[1], "application/octet-stream")
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def instance_or_404(self, inst_id):
        inst = MANAGER.instances.get(inst_id)
        if inst is None:
            self.send_json({"error": "no such server"}, 404)
        return inst

    def log_message(self, fmt, *args):  # keep the terminal quiet
        pass

    # ---------- routes ----------

    def do_GET(self):
        path, _, query = self.path.partition("?")
        try:
            if path == "/" or path == "/index.html":
                self.serve_static("index.html")
            elif path.startswith("/static/"):
                self.serve_static(path[len("/static/"):])
            elif path == "/api/system":
                self.send_json(MANAGER.system_info())
            elif path == "/api/versions":
                try:
                    mc = MANAGER.minecraft_versions()
                    mc_err = None
                except Exception as e:
                    mc, mc_err = [], f"could not reach Mojang: {e}"
                self.send_json({
                    "minecraft": mc,
                    "minecraft_error": mc_err,
                    "terraria": list(TERRARIA_VERSIONS.keys()),
                })
            elif path == "/api/servers":
                self.send_json([i.to_dict() for i in MANAGER.instances.values()])
            else:
                m = re.fullmatch(r"/api/servers/([0-9a-f]+)/console", path)
                if m:
                    inst = self.instance_or_404(m.group(1))
                    if inst:
                        since = 0
                        qm = re.search(r"since=(\d+)", query)
                        if qm:
                            since = int(qm.group(1))
                        lines, seq = inst.console_since(since)
                        self.send_json({"lines": lines, "next": seq,
                                        "status": inst.status,
                                        "status_detail": inst.status_detail})
                else:
                    self.send_json({"error": "not found"}, 404)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def do_POST(self):
        path = self.path.partition("?")[0]
        try:
            if path == "/api/servers":
                data = self.read_body()
                inst = MANAGER.create(data)
                self.send_json(inst.to_dict(), 201)
                return
            m = re.fullmatch(r"/api/servers/([0-9a-f]+)/(start|stop|command)", path)
            if not m:
                self.send_json({"error": "not found"}, 404)
                return
            inst = self.instance_or_404(m.group(1))
            if not inst:
                return
            action = m.group(2)
            if action == "start":
                inst.start()
            elif action == "stop":
                inst.stop()
            else:
                cmd = str(self.read_body().get("command") or "").strip()
                if not cmd:
                    raise ValueError("empty command")
                inst.send_command(cmd)
            self.send_json(inst.to_dict())
        except (ValueError, RuntimeError, KeyError) as e:
            self.send_json({"error": str(e)}, 400)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def do_DELETE(self):
        m = re.fullmatch(r"/api/servers/([0-9a-f]+)", self.path.partition("?")[0])
        if not m:
            self.send_json({"error": "not found"}, 404)
            return
        try:
            MANAGER.delete(m.group(1))
            self.send_json({"ok": True})
        except KeyError:
            self.send_json({"error": "no such server"}, 404)


def main():
    addr = ("0.0.0.0", PANEL_PORT)
    httpd = ThreadingHTTPServer(addr, Handler)
    ip = lan_ip()
    print("BlockHost is running.")
    print(f"  On this device:   http://localhost:{PANEL_PORT}")
    print(f"  On your network:  http://{ip}:{PANEL_PORT}")
    print("Press Ctrl+C to quit (running game servers will be stopped).")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down ...")
        for inst in MANAGER.instances.values():
            inst.stop()
        time.sleep(1)


if __name__ == "__main__":
    main()
