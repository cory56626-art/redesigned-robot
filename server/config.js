// Central configuration: environment loading, proxy-aware transport, provider registry.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProxyAgent, Agent, setGlobalDispatcher } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const WEB_DIR = path.join(ROOT, 'web');

// --- Minimal .env loader (no dependency) -----------------------------------
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let [, k, v] = m;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotEnv();

// --- Proxy-aware global dispatcher -----------------------------------------
// Managed environments route outbound HTTPS through a local proxy with a custom CA.
// Node's native fetch (undici) ignores proxy env vars, so we wire it up explicitly.
export function installTransport() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  let ca;
  const caPath = process.env.NODE_EXTRA_CA_CERTS || '/root/.ccr/ca-bundle.crt';
  try { if (fs.existsSync(caPath)) ca = fs.readFileSync(caPath); } catch { /* ignore */ }
  if (proxy) {
    setGlobalDispatcher(new ProxyAgent({
      uri: proxy,
      requestTls: ca ? { ca } : undefined,
      connectTimeout: 30_000,
      bodyTimeout: 300_000,
      headersTimeout: 300_000,
    }));
    return { proxy, ca: !!ca };
  }
  setGlobalDispatcher(new Agent({ bodyTimeout: 300_000, headersTimeout: 300_000 }));
  return { proxy: null, ca: !!ca };
}

// --- Provider registry -----------------------------------------------------
// `kind` selects the adapter. `env` names the key. Providers with no key are dropped.
export const PROVIDER_DEFS = [
  {
    id: 'groq', label: 'Groq', kind: 'openai',
    env: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1',
    accent: '#f55036', blurb: 'LPU inference — Llama, GPT-OSS, Qwen at very high tok/s.',
  },
  {
    id: 'cerebras', label: 'Cerebras', kind: 'openai',
    env: 'CEREBRAS_API_KEY', base: 'https://api.cerebras.ai/v1',
    accent: '#ff6b35', blurb: 'Wafer-scale inference — GLM, Gemma, GPT-OSS.',
  },
  {
    id: 'mistral', label: 'Mistral', kind: 'openai',
    env: 'MISTRAL_API_KEY', base: 'https://api.mistral.ai/v1',
    accent: '#fa5210', blurb: 'European frontier models — Mistral & Codestral.',
  },
  {
    id: 'openrouter', label: 'OpenRouter', kind: 'openai',
    env: 'OPEN_ROUTER_API_KEY', base: 'https://openrouter.ai/api/v1',
    accent: '#6467f2', blurb: 'One gateway, hundreds of models across every lab.',
    headers: { 'HTTP-Referer': 'https://aurel.local', 'X-Title': 'Aurel IDE' },
  },
  {
    id: 'gemini', label: 'Google Gemini', kind: 'openai',
    env: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    accent: '#4285f4', blurb: 'Gemini 2.x — long context, multimodal.',
  },
  {
    id: 'glm', label: 'Zhipu GLM', kind: 'openai',
    env: 'GLM5.2_API_KEY', base: 'https://api.z.ai/api/paas/v4',
    accent: '#3859ff', blurb: 'GLM series — strong coding & reasoning.', optional: true,
  },
  {
    id: 'cohere', label: 'Cohere', kind: 'cohere',
    env: 'COHERE_API_KEY', base: 'https://api.cohere.com',
    accent: '#39594d', blurb: 'Command family — retrieval & tool use.',
  },
];

export function activeProviders() {
  return PROVIDER_DEFS
    .map((p) => ({ ...p, key: process.env[p.env] }))
    .filter((p) => p.key && p.key.trim().length > 0);
}

export function providerById(id) {
  return activeProviders().find((p) => p.id === id);
}

export const PORT = Number(process.env.PORT || 4173);
export const AUTH_SALT = process.env.AUREL_AUTH_SALT || 'aurel-static-salt';

// Ensure data dirs exist.
for (const d of [DATA_DIR, path.join(DATA_DIR, 'sandboxes')]) {
  fs.mkdirSync(d, { recursive: true });
}
