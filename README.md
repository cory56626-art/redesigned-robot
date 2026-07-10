# 💸 AI Money App

A tiny, self-hostable web app that pairs an **AI money coach** (Mistral, with
OpenRouter fallback) with **real payment collection** via **Stripe** and a
**Cash App** pay link. You host it anywhere (your own server, ISH on iPhone, a
VPS, whatever) and copy/fork it freely.

## 🧠 The honest part (read this)

Money doesn't appear from nothing. This app doesn't "auto-generate" cash and
**nothing legit can** — anyone claiming an app plugs into your Cash App and
prints money is running a scam. What this app actually does:

- **AI coach** gives you real, do-it-today ways to earn (freelance gigs,
  digital products, reselling, small services) and drafts your messages.
- **Stripe** creates **real payment links and invoices** — when someone pays,
  real money lands in your Stripe balance.
- **Cash App** has **no public API**, so the only thing possible is a real
  **pay-me link/QR** to your `$cashtag`.

So the money flow is real; it just comes from **people paying you**, which the
app makes fast and easy.

## 🚀 Run it

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env
#   then edit .env and add your keys (see below)

# 3. start
npm start
# open http://localhost:3000
```

### Keys you need in `.env`

| Variable | What it's for | Where to get it |
| --- | --- | --- |
| `MISTRAL_API_KEY` | AI coach (preferred) | https://console.mistral.ai |
| `OPEN_ROUTER_API_KEY` | AI fallback | https://openrouter.ai/keys |
| `STRIPE_SECRET_KEY` | Real payments in | https://dashboard.stripe.com/apikeys |
| `CASHAPP_CASHTAG` | Your `$cashtag` for pay links | your Cash App profile |

The app runs even if some keys are missing — the status chips at the top show
you what's connected. Use a Stripe **test** key (`sk_test_…`) to play safely;
switch to a **live** key (`sk_live_…`) when you're ready for real money.

## 🖥️ Hosting on your own server (incl. ISH)

Any box with Node 18+ works:

```bash
git clone <your-fork-url> && cd redesigned-robot
npm install
cp .env.example .env   # add your keys
PORT=3000 npm start
```

On **ISH** (iOS Alpine shell): `apk add nodejs npm`, then the same steps. It's
slow but works for a personal instance. For always-on hosting use a small VPS,
Railway, Render, Fly.io, etc. Keep it behind HTTPS if you use a **live** Stripe
key.

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
