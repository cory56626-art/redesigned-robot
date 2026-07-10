# 💸 AI Money App

A tiny, self-hostable web app that pairs an **AI money coach** (Mistral, with
OpenRouter fallback) with **real payment collection** via **Stripe** and a
**Cash App** pay link. You host it anywhere (your own server, ISH on iPhone, a
VPS, whatever) and copy/fork it freely.

## 🧠 The honest part (read this)

Money doesn't appear from nothing. No app "auto-generates" cash from your Cash
App or Stripe — anyone claiming that is running a scam. What this app really does:

- **🤖 Money Bot** — an AI trading bot on **Alpaca** (a real brokerage). You set
  a stake, a **profit target**, and a **loss limit**, hit go, and it trades
  crypto on its own (24/7, so it runs while you sleep), stopping the instant it
  hits your target *or* your loss limit. Real money, **real risk** — it can lose.
  Defaults to Alpaca **paper mode** (practice money) so you can watch it first.
- **💬 AI coach** — real, do-it-today ways to earn, and drafts your messages.
- **💳 Stripe** — real payment links and invoices; when someone pays, money lands
  in your Stripe balance.
- **📱 Cash App** — no public API exists, so it just makes a real **pay-me
  link/QR** to your `$cashtag`.

> ⚠️ **The bot does not guarantee profit. Most trading bots lose money.** It can
> hit your loss limit as easily as your target. Only ever trade money you can
> afford to lose. This is not financial advice.

## 🚀 Run it (no npm install needed)

This app has **zero dependencies** — it runs on plain Node 18+. You do **not**
run `npm install`. Just:

```
cp .env.example .env
```
Edit `.env`, add your keys (see below), then:
```
node server.js
```
Open http://localhost:3000.

### Keys you need in `.env`

| Variable | What it's for | Where to get it |
| --- | --- | --- |
| `MISTRAL_API_KEY` | AI coach (preferred) | https://console.mistral.ai |
| `OPEN_ROUTER_API_KEY` | AI fallback | https://openrouter.ai/keys |
| `STRIPE_SECRET_KEY` | Real payments in | https://dashboard.stripe.com/apikeys |
| `CASHAPP_CASHTAG` | Your `$cashtag` for pay links | your Cash App profile |
| `ALPACA_API_KEY_ID` | Money Bot trading | https://alpaca.markets |
| `ALPACA_API_SECRET_KEY` | Money Bot trading | https://alpaca.markets |
| `ALPACA_LIVE` | `false` = practice money, `true` = real money | you decide |

The app runs even if some keys are missing — the status chips at the top show
you what's connected. Use a Stripe **test** key (`sk_test_…`) to play safely;
switch to a **live** key (`sk_live_…`) when you're ready for real money.

## 🖥️ Hosting on your own server (incl. ISH)

Any box with Node 18+ works. On **ISH** (iOS Alpine shell), run these **one line
at a time**:

```
apk add nodejs
```
```
apk add git
```
```
git clone https://github.com/cory56626-art/redesigned-robot
```
```
cd redesigned-robot
```
```
cp .env.example .env
```
Edit `.env` and paste your keys, then:
```
node server.js
```
Open http://localhost:3000 in Safari. No `npm install`, no build step. For
always-on hosting use a small VPS, Railway, Render, Fly.io, etc. Keep it behind
HTTPS if you use a **live** Stripe key.

## 📁 What's inside

```
server.js        Express API: /api/chat, /api/stripe/*, /api/config
public/          The web UI (chat + Get Paid + Setup tabs)
.env.example     Copy to .env and fill in
```

## 🔐 Safety

- Your `.env` (real keys) is git-ignored — never commit it.
- Nothing here moves money **out** of your accounts or trades on your behalf;
  it only helps money come **in**.
- Not financial advice.
