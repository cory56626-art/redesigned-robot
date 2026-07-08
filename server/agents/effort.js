// Effort profiles. Changing effort immediately changes planning depth, delegation,
// validation, retries, review passes and reasoning — these values are consumed by the orchestrator.

export const EFFORTS = {
  low: {
    id: 'low', label: 'Low', glyph: '○', color: '#94a3b8',
    blurb: 'Fast, direct answers. Minimal planning or validation.',
    planningDepth: 0, parallelism: 1, retries: 0, reviewPasses: 0, validate: false,
    temperature: 0.6, toolIterations: 2, autoSubagents: 0, reasoning: 'brief',
    synthDepth: 'short',
  },
  medium: {
    id: 'medium', label: 'Medium', glyph: '◔', color: '#38bdf8',
    blurb: 'Balanced. Light planning, single pass, one retry.',
    planningDepth: 1, parallelism: 2, retries: 1, reviewPasses: 0, validate: false,
    temperature: 0.6, toolIterations: 3, autoSubagents: 2, reasoning: 'normal',
    synthDepth: 'normal',
  },
  stronger: {
    id: 'stronger', label: 'Stronger', glyph: '◑', color: '#818cf8',
    blurb: 'Plans, delegates, then reviews the result once.',
    planningDepth: 2, parallelism: 3, retries: 1, reviewPasses: 1, validate: true,
    temperature: 0.55, toolIterations: 4, autoSubagents: 3, reasoning: 'deep',
    synthDepth: 'normal',
  },
  superhuman: {
    id: 'superhuman', label: 'Superhuman', glyph: '◕', color: '#a78bfa',
    blurb: 'Deep planning, wide parallel delegation, validation + review.',
    planningDepth: 3, parallelism: 4, retries: 2, reviewPasses: 1, validate: true,
    temperature: 0.5, toolIterations: 6, autoSubagents: 4, reasoning: 'deep',
    synthDepth: 'rich',
  },
  zerotohero: {
    id: 'zerotohero', label: 'Zero to Hero', glyph: '★', color: '#f472b6',
    blurb: 'Everything on: max planning, max parallelism, retries, tests, double review.',
    planningDepth: 3, parallelism: 6, retries: 3, reviewPasses: 2, validate: true,
    temperature: 0.45, toolIterations: 8, autoSubagents: 6, reasoning: 'exhaustive',
    synthDepth: 'rich',
  },
};

export const EFFORT_LIST = Object.values(EFFORTS).map(({ id, label, glyph, color, blurb }) => ({ id, label, glyph, color, blurb }));

export function getEffort(id) { return EFFORTS[id] || EFFORTS.medium; }

const REASONING_PREAMBLE = {
  brief: '',
  normal: 'Think briefly before answering.',
  deep: 'Reason carefully step by step before answering. Consider edge cases and alternatives.',
  exhaustive:
    'Reason exhaustively before answering: enumerate assumptions, consider multiple approaches, weigh trade-offs, anticipate edge cases and failure modes, then commit to the strongest solution.',
};

export function reasoningPreamble(effort) {
  return REASONING_PREAMBLE[effort.reasoning] || '';
}
