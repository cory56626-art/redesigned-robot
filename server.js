// ────────────────────────────────────────────────────────────────
//  AI Money App — ZERO-dependency server.
//  Runs on plain Node 18+ (built-in http + fetch). No "npm install".
//  On ISH:  apk add nodejs   →   node server.js
// ────────────────────────────────────────────────────────────────
import http from "http";
import { readFile } from "fs/promises";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, extname, normalize } from "path";
import { startBot, stopBot, botStatus, alpacaConfigured } from "./bot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "public");

// ── Tiny .env loader (replaces the "dotenv" package) ─────────────
function loadEnv() {
  const path = join(__dirname, ".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const stripeKey = process.env.STRIPE_SECRET_KEY || null;

const SYSTEM_PROMPT = `You are "Cash Coach", a blunt, practical AI money assistant.
Your job is to help the user actually earn money with realistic, legal, actionable ideas.
Rules:
- Be concrete. Give specific steps, not vague motivation.
- Prefer things that can start today with little/no capital (freelancing, selling a skill, digital products, reselling, service gigs, small SaaS).
- When a plan involves getting PAID, remind the user this app can generate a real Stripe payment link or invoice for them.
- NEVER suggest anything illegal, scammy, "guaranteed returns", or get-rich-quick schemes. If asked, refuse and offer a legit alternative.
- Be honest that making money takes work. No magic.
- Keep answers tight and skimmable. Use short bullets.`;

// ────────────────────────────────────────────────────────────────
//  AI CHAT — Mistral first, OpenRouter fallback
// ────────────────────────────────────────────────────────────────
async function callMistral(messages) {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` },
    body: JSON.stringify({ model: process.env.MISTRAL_MODEL || "mistral-large-latest", messages, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(`Mistral ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { provider: "mistral", text: data.choices?.[0]?.message?.content ?? "" };
}

async function callOpenRouter(messages) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPEN_ROUTER_API_KEY}`,
      "HTTP-Referer": "https://github.com/",
      "X-Title": "AI Money App",
    },
    body: JSON.stringify({ model: process.env.OPENROUTER_MODEL || "mistralai/mistral-large", messages, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { provider: "openrouter", text: data.choices?.[0]?.message?.content ?? "" };
}

// Unified AI caller with Mistral -> OpenRouter fallback. Reused by the bot.
async function callAI(messages) {
  const hasMistral = !!process.env.MISTRAL_API_KEY;
  const hasOpenRouter = !!process.env.OPEN_ROUTER_API_KEY;
  if (!hasMistral && !hasOpenRouter) throw new Error("No AI key configured.");
  if (hasMistral) {
    try {
      return await callMistral(messages);
    } catch (err) {
      if (!hasOpenRouter) throw err;
      console.warn("Mistral failed, falling back to OpenRouter:", err.message);
      return await callOpenRouter(messages);
    }
  }
  return await callOpenRouter(messages);
}

// ────────────────────────────────────────────────────────────────
//  STRIPE via plain REST (replaces the "stripe" package)
// ────────────────────────────────────────────────────────────────
function encodeForm(obj, prefix, out) {
  out = out || [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) encodeForm(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join("&");
}

async function stripeReq(path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${res.status}`);
  return data;
}

async function makePaymentLink({ name, amount, currency }) {
  const price = await stripeReq("prices", {
    currency,
    unit_amount: amount,
    product_data: { name },
  });
  const link = await stripeReq("payment_links", {
    "line_items[0][price]": price.id,
    "line_items[0][quantity]": 1,
  });
  return { url: link.url, id: link.id };
}

async function makeInvoice({ email, description, amount, currency }) {
  const customer = await stripeReq("customers", { email });
  await stripeReq("invoiceitems", { customer: customer.id, amount, currency, description });
  const invoice = await stripeReq("invoices", {
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: 7,
  });
  const finalized = await stripeReq(`invoices/${invoice.id}/finalize`, {});
  await stripeReq(`invoices/${invoice.id}/send`, {});
  return { url: finalized.hosted_invoice_url, pdf: finalized.invoice_pdf, id: finalized.id };
}

// ────────────────────────────────────────────────────────────────
//  Minimal HTTP plumbing
// ────────────────────────────────────────────────────────────────
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy(); // 1MB cap
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  // prevent path traversal
  const filePath = normalize(join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

// ────────────────────────────────────────────────────────────────
//  Router
// ────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;
  const method = req.method;

  try {
    // --- API routes ---
    if (path === "/api/health") return sendJson(res, 200, { ok: true });

    if (path === "/api/config") {
      return sendJson(res, 200, {
        ai: process.env.MISTRAL_API_KEY ? "mistral" : process.env.OPEN_ROUTER_API_KEY ? "openrouter" : "none",
        stripe: !!stripeKey,
        cashtag: process.env.CASHAPP_CASHTAG || null,
        alpaca: alpacaConfigured(),
        alpacaLive: process.env.ALPACA_LIVE === "true",
      });
    }

    if (path === "/api/chat" && method === "POST") {
      const body = await readBody(req);
      const clean = (Array.isArray(body.messages) ? body.messages : [])
        .filter((m) => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));
      if (!process.env.MISTRAL_API_KEY && !process.env.OPEN_ROUTER_API_KEY) {
        return sendJson(res, 500, { error: "No AI key configured. Set MISTRAL_API_KEY or OPEN_ROUTER_API_KEY in your .env." });
      }
      try {
        const result = await callAI([{ role: "system", content: SYSTEM_PROMPT }, ...clean]);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 502, { error: "AI request failed. Check your keys/logs.", detail: err.message });
      }
    }

    if (path === "/api/stripe/payment-link" && method === "POST") {
      if (!stripeKey) return sendJson(res, 400, { error: "Stripe not configured. Add STRIPE_SECRET_KEY to .env." });
      const body = await readBody(req);
      const name = String(body.name || "").trim() || "Payment";
      const amount = Math.round(Number(body.amount) * 100);
      const currency = (body.currency || "usd").toLowerCase();
      if (!Number.isFinite(amount) || amount < 50) return sendJson(res, 400, { error: "Amount must be at least 0.50." });
      try {
        return sendJson(res, 200, await makePaymentLink({ name, amount, currency }));
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (path === "/api/stripe/invoice" && method === "POST") {
      if (!stripeKey) return sendJson(res, 400, { error: "Stripe not configured. Add STRIPE_SECRET_KEY to .env." });
      const body = await readBody(req);
      const email = String(body.email || "").trim();
      const description = String(body.description || "Services").trim();
      const amount = Math.round(Number(body.amount) * 100);
      const currency = (body.currency || "usd").toLowerCase();
      if (!email) return sendJson(res, 400, { error: "Customer email is required." });
      if (!Number.isFinite(amount) || amount < 50) return sendJson(res, 400, { error: "Amount must be at least 0.50." });
      try {
        return sendJson(res, 200, await makeInvoice({ email, description, amount, currency }));
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (path === "/api/bot/start" && method === "POST") {
      const body = await readBody(req);
      if (!process.env.MISTRAL_API_KEY && !process.env.OPEN_ROUTER_API_KEY) {
        return sendJson(res, 400, { error: "No AI key set — the bot needs an AI to make decisions." });
      }
      if (!alpacaConfigured()) {
        return sendJson(res, 400, { error: "Alpaca not connected. Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to your .env." });
      }
      try {
        return sendJson(res, 200, startBot(body, callAI));
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    const botMatch = path.match(/^\/api\/bot\/([a-z0-9]+)(\/stop)?$/i);
    if (botMatch) {
      const id = botMatch[1];
      if (botMatch[2] === "/stop" && method === "POST") {
        const view = stopBot(id);
        return view ? sendJson(res, 200, view) : sendJson(res, 404, { error: "Bot not found." });
      }
      if (method === "GET") {
        const view = botStatus(id);
        return view ? sendJson(res, 200, view) : sendJson(res, 404, { error: "Bot not found (it may have cleared on restart)." });
      }
    }

    if (path.startsWith("/api/")) return sendJson(res, 404, { error: "Unknown endpoint." });

    // --- Static files ---
    return serveStatic(req, res, path);
  } catch (err) {
    console.error("Server error:", err);
    sendJson(res, 500, { error: "Internal error." });
  }
});

server.listen(PORT, () => {
  console.log(`\n💸  AI Money App running on http://localhost:${PORT}`);
  console.log(`    AI:      ${process.env.MISTRAL_API_KEY ? "Mistral" : process.env.OPEN_ROUTER_API_KEY ? "OpenRouter" : "⚠ none configured"}`);
  console.log(`    Stripe:  ${stripeKey ? "configured ✅" : "⚠ not configured"}`);
  console.log(`    Alpaca:  ${alpacaConfigured() ? (process.env.ALPACA_LIVE === "true" ? "LIVE 💰" : "paper") : "⚠ not configured"}`);
  console.log(`    Cashtag: ${process.env.CASHAPP_CASHTAG || "⚠ not set"}\n`);
  console.log("    No npm needed — this runs on plain Node.\n");
});
