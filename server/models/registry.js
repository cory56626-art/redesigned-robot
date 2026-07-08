// Fetches, normalizes, caches and groups models across every active provider.
import { activeProviders } from '../config.js';
import { listModels } from '../providers/index.js';
import { cached, cacheClear } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

const TTL = 10 * 60 * 1000; // 10 min

// Curated defaults so the app opens on something good, per provider.
const PREFERRED = {
  groq: [/llama-3\.3-70b/, /llama-4/, /qwen.*32b/, /gpt-oss/],
  cerebras: [/gpt-oss-120b/, /glm/, /qwen/],
  mistral: [/mistral-large/, /mistral-medium/, /codestral/],
  openrouter: [/anthropic\/claude.*sonnet/, /openai\/gpt-4o/, /deepseek/, /qwen/],
  gemini: [/gemini-2\.5-flash$/, /gemini-2\.5-pro/, /gemini-2\.0-flash$/],
  glm: [/glm-4/, /glm/],
  cohere: [/command-r-plus/, /command-a/, /command-r/],
};

function pickDefault(providerId, models) {
  const prefs = PREFERRED[providerId] || [];
  for (const re of prefs) {
    const hit = models.find((m) => re.test(m.id));
    if (hit) return hit.id;
  }
  return models[0]?.id;
}

export async function getModelIndex({ force = false } = {}) {
  if (force) cacheClear('models');
  return cached('models:index', TTL, async () => {
    const providers = activeProviders();
    const results = await Promise.allSettled(providers.map(async (p) => {
      const models = await listModels(p);
      models.sort((a, b) => a.name.localeCompare(b.name));
      return {
        id: p.id, label: p.label, accent: p.accent, blurb: p.blurb,
        count: models.length,
        defaultModel: pickDefault(p.id, models),
        models,
      };
    }));

    const groups = [];
    results.forEach((r, i) => {
      const p = providers[i];
      if (r.status === 'fulfilled' && r.value.models.length) {
        groups.push(r.value);
        logger.info('models', `${p.label}: ${r.value.count} models`);
      } else {
        const reason = r.status === 'rejected' ? r.reason?.message : 'no models';
        logger.warn('models', `${p.label} unavailable`, { reason });
      }
    });

    const all = groups.flatMap((g) => g.models);
    const totalDefault =
      all.find((m) => /llama-3\.3-70b/.test(m.id))?.id ||
      groups[0]?.defaultModel || all[0]?.id;

    return {
      providers: groups,
      total: all.length,
      defaultModel: totalDefault,
      defaultProvider: all.find((m) => m.id === totalDefault)?.provider || groups[0]?.id,
      fetchedAt: Date.now(),
    };
  });
}

export async function resolveModel(providerId, modelId) {
  const idx = await getModelIndex();
  const provider = idx.providers.find((p) => p.id === providerId) || idx.providers[0];
  if (!provider) throw new Error('No providers configured — set at least one API key.');
  const model = provider.models.find((m) => m.id === modelId) || provider.models.find((m) => m.id === provider.defaultModel) || provider.models[0];
  return { providerId: provider.id, model };
}
