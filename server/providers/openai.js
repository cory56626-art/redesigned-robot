// Adapter for any OpenAI-compatible /chat/completions provider.
// Covers Groq, Cerebras, Mistral, OpenRouter, Gemini (openai surface) and GLM.
import { logger } from '../utils/logger.js';

function authHeaders(provider) {
  return {
    Authorization: `Bearer ${provider.key}`,
    'Content-Type': 'application/json',
    ...(provider.headers || {}),
  };
}

export async function listModels(provider) {
  const url = provider.modelsUrl || `${provider.base}/models`;
  const res = await fetch(url, { headers: authHeaders(provider) });
  if (!res.ok) throw new Error(`${provider.id} models ${res.status}`);
  const data = await res.json();
  const rows = data.data || data.models || [];
  return rows.map((m) => normalizeModel(provider, m)).filter(Boolean);
}

function normalizeModel(provider, m) {
  const id = m.id || m.name;
  if (!id) return null;
  const ctx = m.context_window || m.context_length || m.max_context_length || m.contextWindow || 0;
  const name = m.name && typeof m.name === 'string' && m.name !== id ? m.name : prettify(id);
  return {
    id,
    name,
    provider: provider.id,
    providerLabel: provider.label,
    context: ctx,
    maxOutput: m.max_completion_tokens || m.max_output_tokens || 0,
    vision: !!(m.capabilities?.vision),
    tools: m.capabilities?.function_calling !== false,
    ownedBy: m.owned_by || m.owned_by || provider.label,
  };
}

function prettify(id) {
  return id.split('/').pop().replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Streaming chat. Calls onDelta(text) for each token chunk. Returns { text, usage, finish }.
export async function chat(provider, { model, messages, temperature = 0.7, maxTokens, stream = true, signal, onDelta }) {
  const body = {
    model,
    messages,
    temperature,
    stream,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (stream) body.stream_options = { include_usage: true };

  const res = await fetch(`${provider.base}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(provider),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    logger.error('provider', `${provider.id} chat ${res.status}`, { model, snippet: errText.slice(0, 300) });
    const err = new Error(`${provider.label} error ${res.status}: ${errText.slice(0, 400)}`);
    err.status = res.status;
    const ra = res.headers.get('retry-after');
    const m = errText.match(/try again in ([\d.]+)s/i);
    err.retryAfter = ra ? Number(ra) * 1000 : (m ? Math.ceil(Number(m[1]) * 1000) : 0);
    throw err;
  }

  if (!stream) {
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (onDelta && text) onDelta(text);
    return { text, usage: data.usage || null, finish: data.choices?.[0]?.finish_reason };
  }

  // Parse SSE stream.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let usage = null;
  let finish = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        let obj;
        try { obj = JSON.parse(payload); } catch { continue; }
        const delta = obj.choices?.[0]?.delta?.content;
        if (delta) { text += delta; if (onDelta) onDelta(delta); }
        if (obj.choices?.[0]?.finish_reason) finish = obj.choices[0].finish_reason;
        if (obj.usage) usage = obj.usage;
      }
    }
  }
  return { text, usage, finish };
}
