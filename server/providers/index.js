// Unified provider dispatch. Selects an adapter by provider.kind.
import * as openai from './openai.js';
import * as cohere from './cohere.js';
import { activeProviders, providerById } from '../config.js';

const ADAPTERS = { openai, cohere };

export function adapterFor(provider) {
  return ADAPTERS[provider.kind] || openai;
}

export { activeProviders, providerById };

export async function listModels(provider) {
  return adapterFor(provider).listModels(provider);
}

// options: { model, messages, temperature, maxTokens, stream, signal, onDelta }
export async function chat(provider, options) {
  return adapterFor(provider).chat(provider, options);
}
