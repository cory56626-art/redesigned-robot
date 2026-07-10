import express from "express";
import dotenv from "dotenv";
import Stripe from "stripe";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// ── Stripe (optional — only if a key is configured) ─────────────
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// ── The AI's "personality": a pragmatic money coach ─────────────
const SYSTEM_PROMPT = `You are "Cash Coach", a blunt, practical AI money assistant.
Your job is to help the user actually earn money with realistic, legal, actionable ideas.
Rules:
- Be concrete. Give specific steps, not vague motivation.
- Prefer things that can start today with little/no capital (freelancing, selling a skill, digital products, reselling, service gigs, small SaaS).
- When a plan involves getting PAID, remind the user this app can generate a real Stripe payment link or invoice for them.
- NEVER suggest anything illegal, scammy, "guaranteed returns", gambling, or get-rich-quick schemes. If asked, refuse and offer a legit alternative.
- Be honest that making money takes work. No magic.
- Keep answers tight and skimmable. Use short bullets.`;

// ────────────────────────────────────────────────────────────────
//  AI CHAT  — Mistral first, OpenRouter fallback
// ────────────────────────────────────────────────────────────────
async function callMistral(messages) {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_MODEL || "mistral-large-latest",
      messages,
      temperature: 0.7,
    }),
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
      "HTTP-Referer": "https://github.com/", // OpenRouter likes an attribution header
      "X-Title": "AI Money App",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "mistralai/mistral-large",
      messages,
      temperature: 0.7,
    }),
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

app.post("/api/chat", async (req, res) => {
  const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
  // Only keep role/content, cap history length to stay cheap.
  const clean = history
    .filter((m) => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...clean];

  const hasMistral = !!process.env.MISTRAL_API_KEY;
  const hasOpenRouter = !!process.env.OPEN_ROUTER_API_KEY;

  if (!hasMistral && !hasOpenRouter) {
    return res.status(500).json({
      error: "No AI key configured. Set MISTRAL_API_KEY or OPEN_ROUTER_API_KEY in your .env.",
    });
  }

  try {
    const result = await callAI(messages);
    res.json(result);
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(502).json({ error: "AI request failed. Check your keys/logs.", detail: err.message });
  }
});

// ────────────────────────────────────────────────────────────────
//  STRIPE  — the part that genuinely brings money IN
// ────────────────────────────────────────────────────────────────

// Create a shareable payment link for a one-off product/service.
app.post("/api/stripe/payment-link", async (req, res) => {
  if (!stripe) return res.status(400).json({ error: "Stripe not configured. Add STRIPE_SECRET_KEY to .env." });
  try {
    const name = String(req.body?.name || "").trim() || "Payment";
    const amount = Math.round(Number(req.body?.amount) * 100); // dollars -> cents
    const currency = (req.body?.currency || "usd").toLowerCase();
    if (!Number.isFinite(amount) || amount < 50) {
      return res.status(400).json({ error: "Amount must be at least 0.50." });
    }

    const price = await stripe.prices.create({
      currency,
      unit_amount: amount,
      product_data: { name },
    });

    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
    });

    res.json({ url: link.url, id: link.id });
  } catch (err) {
    console.error("Stripe payment-link error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// Create + send an invoice by email.
app.post("/api/stripe/invoice", async (req, res) => {
  if (!stripe) return res.status(400).json({ error: "Stripe not configured. Add STRIPE_SECRET_KEY to .env." });
  try {
    const email = String(req.body?.email || "").trim();
    const description = String(req.body?.description || "Services").trim();
    const amount = Math.round(Number(req.body?.amount) * 100);
    const currency = (req.body?.currency || "usd").toLowerCase();
    if (!email) return res.status(400).json({ error: "Customer email is required." });
    if (!Number.isFinite(amount) || amount < 50) {
      return res.status(400).json({ error: "Amount must be at least 0.50." });
    }

    const customer = await stripe.customers.create({ email });
    await stripe.invoiceItems.create({
      customer: customer.id,
      amount,
      currency,
      description,
    });
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: 7,
    });
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(invoice.id);

    res.json({ url: finalized.hosted_invoice_url, pdf: finalized.invoice_pdf, id: finalized.id });
  } catch (err) {
    console.error("Stripe invoice error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────
//  CONFIG  — tell the frontend what's actually wired up
// ────────────────────────────────────────────────────────────────
app.get("/api/config", (req, res) => {
  res.json({
    ai: process.env.MISTRAL_API_KEY ? "mistral" : process.env.OPEN_ROUTER_API_KEY ? "openrouter" : "none",
    stripe: !!stripe,
    cashtag: process.env.CASHAPP_CASHTAG || null,
  });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`\n💸  AI Money App running on http://localhost:${PORT}`);
  console.log(`    AI:      ${process.env.MISTRAL_API_KEY ? "Mistral" : process.env.OPEN_ROUTER_API_KEY ? "OpenRouter" : "⚠ none configured"}`);
  console.log(`    Stripe:  ${stripe ? "configured ✅" : "⚠ not configured"}`);
  console.log(`    Cashtag: ${process.env.CASHAPP_CASHTAG || "⚠ not set"}\n`);
});
