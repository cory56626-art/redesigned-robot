// ────────────────────────────────────────────────────────────────
//  Auto Money Bot — a REAL AI-driven trading bot on Alpaca.
//
//  You set: a stake per trade, a PROFIT TARGET, and a STOP-LOSS.
//  It runs on its own (crypto trades 24/7, so it works while you sleep),
//  asks the AI (Mistral/OpenRouter) to decide BUY / SELL / HOLD each tick,
//  places REAL orders through your Alpaca account, and stops the moment it
//  either hits your target (win) or your stop-loss (done).
//
//  MODES:
//   - PAPER (default): Alpaca practice money. Real prices, fake dollars.
//   - LIVE (ALPACA_LIVE=true): real money, real risk. YOU flip this switch.
//
//  Honest truth: no bot guarantees profit. Most lose. This can hit your
//  stop-loss just as easily as your target. Only trade what you can lose.
// ────────────────────────────────────────────────────────────────

const bots = new Map(); // id -> bot state

const LIVE = process.env.ALPACA_LIVE === "true";
const TRADE_BASE = LIVE ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

function keys() {
  return {
    id: process.env.ALPACA_API_KEY_ID,
    secret: process.env.ALPACA_API_SECRET_KEY,
  };
}

export function alpacaConfigured() {
  const k = keys();
  return !!(k.id && k.secret);
}

function headers() {
  const k = keys();
  return {
    "APCA-API-KEY-ID": k.id,
    "APCA-API-SECRET-KEY": k.secret,
    "Content-Type": "application/json",
  };
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Alpaca helpers ──────────────────────────────────────
async function getAccount() {
  const res = await fetch(`${TRADE_BASE}/v2/account`, { headers: headers() });
  if (!res.ok) throw new Error(`Alpaca account ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getPrice(symbol) {
  // symbol like "BTC/USD"
  const res = await fetch(
    `${DATA_BASE}/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(symbol)}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Alpaca price ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return Number(data?.trades?.[symbol]?.p);
}

async function getRecentBars(symbol, limit = 12) {
  const res = await fetch(
    `${DATA_BASE}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=1Min&limit=${limit}`,
    { headers: headers() }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.bars?.[symbol] || []).map((b) => Number(b.c));
}

function positionSymbol(symbol) {
  // Positions endpoint wants no slash, e.g. BTCUSD
  return symbol.replace("/", "");
}

async function getPosition(symbol) {
  const res = await fetch(`${TRADE_BASE}/v2/positions/${positionSymbol(symbol)}`, {
    headers: headers(),
  });
  if (res.status === 404) return null; // no open position
  if (!res.ok) throw new Error(`Alpaca position ${res.status}: ${await res.text()}`);
  return res.json();
}

async function buy(symbol, notional) {
  const res = await fetch(`${TRADE_BASE}/v2/orders`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      symbol,
      notional: Number(notional).toFixed(2),
      side: "buy",
      type: "market",
      time_in_force: "gtc",
    }),
  });
  if (!res.ok) throw new Error(`Buy ${res.status}: ${await res.text()}`);
  return res.json();
}

async function closePosition(symbol) {
  const res = await fetch(`${TRADE_BASE}/v2/positions/${positionSymbol(symbol)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Close ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── AI decision ─────────────────────────────────────────
async function askAI(callAI, symbol, price, bars, hasPosition, stake) {
  const recent = bars.map((p) => p.toFixed(2)).join(", ");
  const prompt = `You are an automated crypto trading bot.
Asset: ${symbol}
Current price: $${price}
Recent 1-min closes (oldest→newest): ${recent || "(none)"}
Currently holding a position: ${hasPosition ? "YES" : "NO"}
Stake per buy: $${stake}

Reply with ONLY one word — BUY, SELL, or HOLD.
BUY if you expect a short-term rise. SELL to exit a held position on weakness or to lock gains. HOLD if unsure.`;
  try {
    const { text } = await callAI([
      { role: "system", content: "Output exactly one word: BUY, SELL, or HOLD." },
      { role: "user", content: prompt },
    ]);
    const w = String(text || "").toUpperCase();
    if (w.includes("BUY")) return "BUY";
    if (w.includes("SELL")) return "SELL";
    return "HOLD";
  } catch {
    return "HOLD";
  }
}

// ── Main loop ───────────────────────────────────────────
async function tick(bot, callAI) {
  if (bot.status !== "running") return;
  try {
    const acct = await getAccount();
    const equity = Number(acct.equity);
    if (bot.startEquity == null) bot.startEquity = equity;
    bot.equity = equity;

    const price = await getPrice(bot.symbol);
    bot.lastPrice = price;
    const bars = await getRecentBars(bot.symbol);
    const pos = await getPosition(bot.symbol);
    const hasPosition = !!pos && Math.abs(Number(pos.qty)) > 0;

    const pnl = equity - bot.startEquity;
    bot.pnl = pnl;

    // Win / stop checks BEFORE trading.
    if (bot.takeProfit > 0 && pnl >= bot.takeProfit) {
      if (hasPosition) await closePosition(bot.symbol).catch(() => {});
      return finish(bot, "won", `🎯 Hit profit target (+$${pnl.toFixed(2)}). Bot stopped.`);
    }
    if (bot.maxLoss > 0 && pnl <= -bot.maxLoss) {
      if (hasPosition) await closePosition(bot.symbol).catch(() => {});
      return finish(bot, "stopped", `🛑 Hit stop-loss ($${pnl.toFixed(2)}). Bot stopped.`);
    }

    const decision = await askAI(callAI, bot.symbol, price, bars, hasPosition, bot.stake);

    if (decision === "BUY" && !hasPosition && Number(acct.cash) >= bot.stake) {
      await buy(bot.symbol, bot.stake);
      bot.log.push({ t: Date.now(), type: "buy", price, amount: bot.stake });
    } else if (decision === "SELL" && hasPosition) {
      await closePosition(bot.symbol);
      bot.log.push({ t: Date.now(), type: "sell", price });
    } else {
      bot.log.push({ t: Date.now(), type: "hold", price });
    }
  } catch (err) {
    bot.log.push({ t: Date.now(), type: "error", msg: err.message });
  }
  if (bot.log.length > 200) bot.log.splice(0, bot.log.length - 200);
}

function finish(bot, status, reason) {
  bot.status = status;
  bot.finishedReason = reason;
  bot.log.push({ t: Date.now(), type: "finish", status, msg: reason });
  if (bot.timer) clearInterval(bot.timer);
  bot.timer = null;
}

// ── Public API ──────────────────────────────────────────
export function startBot(config, callAI) {
  const id = newId();
  const bot = {
    id,
    symbol: (config.symbol || "BTC/USD").toUpperCase(),
    mode: LIVE ? "LIVE (real money)" : "paper (practice money)",
    stake: Math.max(1, Number(config.stake) || 10),
    takeProfit: Math.max(0, Number(config.takeProfit) || 0),
    maxLoss: Math.max(0, Number(config.maxLoss) || 0),
    intervalMs: Math.max(15000, (Number(config.intervalSec) || 30) * 1000),
    status: "running",
    startEquity: null,
    equity: null,
    lastPrice: null,
    pnl: 0,
    finishedReason: null,
    log: [{ t: Date.now(), type: "start", msg: `Bot started on ${config.symbol || "BTC/USD"} (${LIVE ? "LIVE" : "paper"}).` }],
    timer: null,
  };
  bots.set(id, bot);
  tick(bot, callAI);
  bot.timer = setInterval(() => tick(bot, callAI), bot.intervalMs);
  return publicView(bot);
}

export function stopBot(id) {
  const bot = bots.get(id);
  if (!bot) return null;
  if (bot.status === "running") finish(bot, "stopped", "Stopped manually.");
  return publicView(bot);
}

export function botStatus(id) {
  const bot = bots.get(id);
  return bot ? publicView(bot) : null;
}

function publicView(bot) {
  return {
    id: bot.id,
    symbol: bot.symbol,
    mode: bot.mode,
    status: bot.status,
    stake: bot.stake,
    takeProfit: bot.takeProfit,
    maxLoss: bot.maxLoss,
    intervalMs: bot.intervalMs,
    startEquity: bot.startEquity,
    equity: bot.equity,
    lastPrice: bot.lastPrice,
    pnl: bot.pnl,
    finishedReason: bot.finishedReason,
    log: bot.log.slice(-40).reverse(),
  };
}
