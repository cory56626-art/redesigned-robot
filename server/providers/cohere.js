// Adapter for Cohere v2 (/v2/chat, /v1/models). Streaming via Cohere's SSE event shapes.
import { logger } from '../utils/logger.js';

function headers(provider) {
  return { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' };
}

export async function listModels(provider) {
  const res = await fetch(`${provider.base}/v1/models?page_size=200`, { headers: headers(provider) });
  if (!res.ok) throw new Error(`cohere models ${res.status}`);
  const data = await res.json();
  return (data.models || [])
    .filter((m) => (m.endpoints || []).includes('chat'))
    .map((m) => ({
      id: m.name,
      name: m.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      provider: provider.id,
      providerLabel: provider.label,
      context: m.context_length || 0,
      maxOutput: 0,
      vision: (m.endpoints || []).includes('images') || /vision/.test(m.name),
      tools: true,
      ownedBy: 'Cohere',
    }));
}

export async function chat(provider, { model, messages, temperature = 0.7, maxTokens, stream = true, signal, onDelta }) {
  const body = {
    model,
    messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : m.role, content: m.content })),
    temperature,
    stream,
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const res = await fetch(`${provider.base}/v2/chat`, {
    method: 'POST', headers: headers(provider), body: JSON.stringify(body), signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    logger.error('provider', `cohere chat ${res.status}`, { model, snippet: errText.slice(0, 300) });
    const err = new Error(`Cohere error ${res.status}: ${errText.slice(0, 400)}`);
    err.status = res.status;
    const ra = res.headers.get('retry-after');
    err.retryAfter = ra ? Number(ra) * 1000 : 0;
    throw err;
  }

  if (!stream) {
    const data = await res.json();
    const text = (data.message?.content || []).map((c) => c.text || '').join('');
    if (onDelta && text) onDelta(text);
    return { text, usage: data.usage || null, finish: data.finish_reason };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', text = '', usage = null, finish = null;
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
        let obj; try { obj = JSON.parse(payload); } catch { continue; }
        if (obj.type === 'content-delta') {
          const delta = obj.delta?.message?.content?.text;
          if (delta) { text += delta; if (onDelta) onDelta(delta); }
        } else if (obj.type === 'message-end') {
          finish = obj.delta?.finish_reason || 'stop';
          usage = obj.delta?.usage || usage;
        }
      }
    }
  }
  return { text, usage, finish };
}
