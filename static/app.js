/* BlockHost frontend — plain JS, no frameworks. */

const $ = (id) => document.getElementById(id);

let SYSTEM = null;
let VERSIONS = { minecraft: [], terraria: [] };
let selectedGame = null;
let consoleTarget = null;   // instance id shown in the console panel
let consoleNext = 0;

const GAME_INFO = {
  minecraft: {
    defaultPort: 25565,
    hint: "Minecraft Java Edition — friends on PC, Mac or Linux join via Multiplayer → Direct Connect. " +
          "Needs Java installed on this host (21+ for recent versions).",
    difficulties: [["peaceful", "Peaceful"], ["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]],
    defaultDifficulty: "normal",
    worldSize: false,   // Minecraft worlds are effectively infinite
    password: false,    // Java Edition uses account auth, not a server password
  },
  terraria: {
    defaultPort: 7777,
    hint: "Terraria dedicated server — friends join via Multiplayer → Join via IP. " +
          "Mobile players (1.4.5+) can join too via crossplay.",
    difficulties: [["classic", "Classic"], ["expert", "Expert"], ["master", "Master"], ["journey", "Journey"]],
    defaultDifficulty: "classic",
    worldSize: true,
    password: true,
  },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/* ---------- system info ---------- */

async function loadSystem() {
  try {
    SYSTEM = await api("/api/system");
    const j = SYSTEM.java_ok ? `Java ${SYSTEM.java} ✔` : "Java missing ✖ (needed for Minecraft)";
    $("sysinfo").textContent =
      `Host: ${SYSTEM.os} · ${SYSTEM.cpu_count} CPU cores · ${Math.round(SYSTEM.total_ram_mb / 1024)} GB RAM\n${j} · LAN IP ${SYSTEM.lan_ip}`;
    document.querySelectorAll(".lan-ip").forEach((el) => (el.textContent = SYSTEM.lan_ip));

    const ram = $("f-ram");
    ram.max = Math.max(1024, SYSTEM.total_ram_mb - 1024); // leave 1 GB for the OS
    const cpu = $("f-cpu");
    cpu.max = SYSTEM.cpu_count;

    // mark games this device can't host
    const caps = SYSTEM.capabilities || {};
    let anyOk = false;
    for (const game of ["minecraft", "terraria"]) {
      const cap = caps[game] || { ok: true };
      if (cap.ok) { anyOk = true; continue; }
      const btn = document.querySelector(`.game-btn[data-game="${game}"]`);
      btn.classList.add("unavailable");
      const tag = document.createElement("span");
      tag.className = "unavail-tag";
      tag.textContent = "⚠️ can't run on this device";
      btn.appendChild(tag);
    }
    if (!anyOk) {
      const note = $("device-note");
      note.textContent =
        "⚠️ The panel is running, but this device can't run the game servers " +
        "themselves. Run server.py on any computer or VPS and open this same " +
        "page from your phone — or see the README for free remote hosts " +
        "(fps.ms for Terraria, Aternos for Minecraft).";
      note.classList.remove("hidden");
    }
  } catch (e) {
    $("sysinfo").textContent = "could not load system info: " + e.message;
  }
}

async function loadVersions() {
  const v = await api("/api/versions");
  VERSIONS = v;
  if (v.minecraft_error) {
    console.warn(v.minecraft_error);
  }
}

/* ---------- create form ---------- */

function pickGame(game) {
  selectedGame = game;
  document.querySelectorAll(".game-btn").forEach((b) =>
    b.classList.toggle("selected", b.dataset.game === game));
  $("config-panel").classList.remove("hidden");
  const cap = (SYSTEM && SYSTEM.capabilities || {})[game] || { ok: true, reason: "" };
  $("platform-hint").textContent =
    GAME_INFO[game].hint + (cap.reason ? " ⚠️ " + cap.reason : "");
  $("btn-create").disabled = !cap.ok;
  $("f-port").value = GAME_INFO[game].defaultPort;
  $("eula-row").classList.toggle("hidden", game !== "minecraft");

  const info = GAME_INFO[game];
  // world size — Terraria only
  $("field-worldsize").classList.toggle("hidden", !info.worldSize);
  // password — Terraria only (Minecraft Java authenticates via accounts)
  $("f-password").closest(".field").classList.toggle("hidden", !info.password);
  // difficulty options are game-specific
  const dsel = $("f-difficulty");
  dsel.innerHTML = "";
  for (const [val, label] of info.difficulties) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    if (val === info.defaultDifficulty) o.selected = true;
    dsel.appendChild(o);
  }

  const sel = $("f-version");
  sel.innerHTML = "";
  const list = VERSIONS[game] || [];
  if (game === "minecraft" && list.length === 0) {
    const o = document.createElement("option");
    o.textContent = "(couldn't fetch versions — is the host online?)";
    o.value = "";
    sel.appendChild(o);
  }
  for (const ver of list) {
    const o = document.createElement("option");
    o.value = ver;
    o.textContent = ver + (list.indexOf(ver) === 0 ? "  (latest)" : "");
    sel.appendChild(o);
  }
}

function bindSliders() {
  const ram = $("f-ram"), cpu = $("f-cpu");
  const upd = () => {
    $("ram-val").textContent =
      ram.value >= 1024 ? (ram.value / 1024).toFixed(1) + " GB" : ram.value + " MB";
    $("cpu-val").textContent = cpu.value === "0" ? "all" : cpu.value;
  };
  ram.oninput = upd;
  cpu.oninput = upd;
  upd();
}

async function createServer() {
  const err = $("create-error");
  err.classList.add("hidden");
  if (!selectedGame) return;
  const btn = $("btn-create");
  btn.disabled = true;
  try {
    await api("/api/servers", {
      method: "POST",
      body: JSON.stringify({
        game: selectedGame,
        name: $("f-name").value,
        version: $("f-version").value,
        ram_mb: +$("f-ram").value,
        cpu_cores: +$("f-cpu").value,
        duration_min: +$("f-duration").value,
        max_players: +$("f-players").value,
        port: +$("f-port").value,
        seed: $("f-seed").value,
        world_size: +$("f-worldsize").value,
        difficulty: $("f-difficulty").value,
        password: $("f-password").value,
        eula: $("f-eula").checked,
      }),
    });
    await refreshServers();
    document.querySelector("#server-list").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}

/* ---------- server list ---------- */

function sizeName(n) {
  return { 1: "small", 2: "medium", 3: "large" }[n] || "medium";
}

function fmtRemaining(stopsAt) {
  const s = Math.max(0, Math.round(stopsAt - Date.now() / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m left` : `${m}m left`;
}

async function refreshServers() {
  const list = await api("/api/servers");
  const box = $("server-list");
  if (!list.length) {
    box.innerHTML = '<p class="hint">No servers yet — create one above!</p>';
    return;
  }
  box.innerHTML = "";
  for (const s of list) {
    const row = document.createElement("div");
    row.className = "server-row";
    const icon = s.game === "minecraft" ? "⛏️" : "🌳";
    const running = s.status === "running";
    const busy = ["downloading", "starting", "stopping"].includes(s.status);
    const addr = SYSTEM ? `${SYSTEM.lan_ip}:${s.port}` : `:${s.port}`;
    row.innerHTML = `
      <div class="server-main">
        <div class="server-name">${icon} ${escapeHtml(s.name)}</div>
        <div class="server-meta">
          ${s.game} ${s.version} · ${s.ram_mb} MB RAM ·
          ${s.cpu_cores ? s.cpu_cores + " cores" : "all cores"} ·
          ${s.max_players} players ·
          ${s.difficulty ? escapeHtml(s.difficulty) + (s.game === "terraria" ? " · " + sizeName(s.world_size) : "") + " · " : ""}
          ${s.password ? "🔒 password · " : ""}
          ${s.duration_min ? s.duration_min + " min limit" : "runs until stopped"}
          ${running && s.stops_at ? " · ⏳ " + fmtRemaining(s.stops_at) : ""}
        </div>
        ${running ? `<div class="addr">join at ${addr}${s.game === "terraria" ? " (PC & mobile)" : ""}</div>` : ""}
        ${s.status === "error" ? `<div class="error">${escapeHtml(s.status_detail)}</div>` : ""}
      </div>
      <span class="badge ${s.status}">${s.status}</span>
      <div class="row-actions">
        <button class="start" ${running || busy ? "disabled" : ""}>▶ Start</button>
        <button class="stop" ${!running && !busy ? "disabled" : ""}>■ Stop</button>
        <button class="console">Console</button>
        <button class="del" ${running || busy ? "disabled" : ""}>🗑</button>
      </div>`;
    row.querySelector(".start").onclick = () => action(s.id, "start");
    row.querySelector(".stop").onclick = () => action(s.id, "stop");
    row.querySelector(".del").onclick = () => removeServer(s.id, s.name);
    row.querySelector(".console").onclick = () => openConsole(s.id, s.name);
    box.appendChild(row);
  }
}

function escapeHtml(t) {
  const d = document.createElement("div");
  d.textContent = t ?? "";
  return d.innerHTML;
}

async function action(id, act) {
  try {
    await api(`/api/servers/${id}/${act}`, { method: "POST" });
    if (act === "start") openConsole(id);
  } catch (e) {
    alert(e.message);
  }
  refreshServers();
}

async function removeServer(id, name) {
  if (!confirm(`Delete "${name}" and its world files?`)) return;
  try {
    await api(`/api/servers/${id}`, { method: "DELETE" });
    if (consoleTarget === id) {
      consoleTarget = null;
      $("console-card").classList.add("hidden");
    }
  } catch (e) {
    alert(e.message);
  }
  refreshServers();
}

/* ---------- console ---------- */

function openConsole(id, name) {
  if (consoleTarget !== id) {
    consoleTarget = id;
    consoleNext = 0;
    $("console-out").textContent = "";
  }
  if (name) $("console-title").textContent = name;
  $("console-card").classList.remove("hidden");
  $("console-card").scrollIntoView({ behavior: "smooth" });
}

async function pollConsole() {
  if (!consoleTarget) return;
  try {
    const data = await api(`/api/servers/${consoleTarget}/console?since=${consoleNext}`);
    if (data.lines.length) {
      const out = $("console-out");
      const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
      out.textContent += data.lines.map((l) => l.t).join("\n") + "\n";
      consoleNext = data.next;
      if (atBottom) out.scrollTop = out.scrollHeight;
    }
  } catch (e) {
    /* server gone; stop polling this target */
    if (String(e.message).includes("no such")) consoleTarget = null;
  }
}

async function sendCommand() {
  const input = $("console-cmd");
  const cmd = input.value.trim();
  if (!cmd || !consoleTarget) return;
  input.value = "";
  try {
    await api(`/api/servers/${consoleTarget}/command`, {
      method: "POST",
      body: JSON.stringify({ command: cmd }),
    });
  } catch (e) {
    alert(e.message);
  }
}

/* ---------- boot ---------- */

document.querySelectorAll(".game-btn").forEach((b) => (b.onclick = () => pickGame(b.dataset.game)));
$("btn-create").onclick = createServer;
$("btn-send").onclick = sendCommand;
$("console-cmd").addEventListener("keydown", (e) => { if (e.key === "Enter") sendCommand(); });

bindSliders();
loadSystem().then(loadVersions).then(refreshServers);
setInterval(refreshServers, 4000);
setInterval(pollConsole, 1500);
