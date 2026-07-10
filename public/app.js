// ── Tabs ────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById("tab-" + t.dataset.tab).classList.add("active");
  });
});

// ── Config chips ────────────────────────────────────────
let CONFIG = { ai: "none", stripe: false, cashtag: null };
async function loadConfig() {
  try {
    CONFIG = await (await fetch("/api/config")).json();
  } catch {}
  const ai = document.getElementById("chipAI");
  ai.textContent = "AI: " + (CONFIG.ai === "none" ? "not set" : CONFIG.ai);
  ai.className = "chip " + (CONFIG.ai === "none" ? "bad" : "ok");

  const st = document.getElementById("chipStripe");
  st.textContent = "Stripe: " + (CONFIG.stripe ? "connected" : "not set");
  st.className = "chip " + (CONFIG.stripe ? "ok" : "bad");

  const ca = document.getElementById("chipCash");
  ca.textContent = "Cash App: " + (CONFIG.cashtag ? CONFIG.cashtag : "not set");
  ca.className = "chip " + (CONFIG.cashtag ? "ok" : "bad");
}
loadConfig();

// ── Chat ────────────────────────────────────────────────
const chat = document.getElementById("chat");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const history = [];

function addMsg(role, text) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "bot");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.appendChild(bubble);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  addMsg("user", text);
  history.push({ role: "user", content: text });

  const typing = addMsg("bot", "typing…");
  typing.classList.add("typing");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();
    typing.classList.remove("typing");
    if (!res.ok) {
      typing.textContent = "⚠️ " + (data.error || "AI error");
      return;
    }
    typing.textContent = data.text || "(no reply)";
    history.push({ role: "assistant", content: data.text || "" });
  } catch (err) {
    typing.classList.remove("typing");
    typing.textContent = "⚠️ Network error: " + err.message;
  }
});

// ── Helpers for Get Paid actions ────────────────────────
function resultBox(id) {
  return document.getElementById(id);
}
function showLink(box, label, url) {
  box.innerHTML = `<span class="ok">✅ ${label}</span><br /><a href="${url}" target="_blank" rel="noopener">${url}</a>`;
}
function showErr(box, msg) {
  box.innerHTML = `<span class="err">⚠️ ${msg}</span>`;
}
async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json() };
}

// Stripe payment link
document.getElementById("plBtn").addEventListener("click", async () => {
  const box = resultBox("plResult");
  const name = document.getElementById("plName").value.trim();
  const amount = document.getElementById("plAmount").value;
  box.textContent = "Creating…";
  const { ok, data } = await post("/api/stripe/payment-link", { name, amount });
  ok ? showLink(box, "Payment link ready — share it:", data.url) : showErr(box, data.error);
});

// Stripe invoice
document.getElementById("invBtn").addEventListener("click", async () => {
  const box = resultBox("invResult");
  const email = document.getElementById("invEmail").value.trim();
  const description = document.getElementById("invDesc").value.trim();
  const amount = document.getElementById("invAmount").value;
  box.textContent = "Sending…";
  const { ok, data } = await post("/api/stripe/invoice", { email, description, amount });
  ok ? showLink(box, "Invoice emailed! View it:", data.url) : showErr(box, data.error);
});

// Cash App link (client-side — it's just a URL to your $cashtag)
document.getElementById("cashBtn").addEventListener("click", () => {
  const box = resultBox("cashResult");
  if (!CONFIG.cashtag) {
    showErr(box, "No $cashtag set. Add CASHAPP_CASHTAG to your .env and restart.");
    return;
  }
  const tag = CONFIG.cashtag.replace(/^\$/, "");
  const amount = document.getElementById("cashAmount").value;
  const url = amount ? `https://cash.app/$${tag}/${amount}` : `https://cash.app/$${tag}`;
  showLink(box, "Cash App pay link — send it to whoever owes you:", url);
});
