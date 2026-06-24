// Multi-AI orchestrator: sends the current index.html to each live provider
// with a role-specific review prompt, collects their contributions.
// Claude (the boss) reads the merged output and integrates the good changes.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CA = "/root/.ccr/ca-bundle.crt";
const env = process.env;
const ROUND = process.argv[2] || "1";
const code = readFileSync("index.html", "utf8");

const tdir = mkdtempSync(join(tmpdir(), "ai-"));

function curlJSON(url, headers, body) {
  const bodyFile = join(tdir, "body.json");
  writeFileSync(bodyFile, JSON.stringify(body));
  const args = ["-sS", "--max-time", "180", url];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  args.push("-H", "Content-Type: application/json", "--data", "@" + bodyFile);
  const out = execFileSync("curl", args, {
    env: { ...env, CURL_CA_BUNDLE: CA },
    maxBuffer: 1024 * 1024 * 32,
  }).toString();
  return JSON.parse(out);
}

const sys = `You are one specialist reviewer in an 8-AI engineering team improving a single-file offline HTML app (an AI-model ranking dashboard with weighted scoring, S–F tiers, search, sort, side-by-side compare, and dynamic recalculation). The whole app must remain ONE offline index.html with no external dependencies or network calls. Review ONLY through the lens of your specialty. Be concrete and terse.`;

function userPrompt(role) {
  return `${role}

Return STRICT JSON only (no markdown fences), an array of up to 6 items:
[{"severity":"high|med|low","area":"short tag","issue":"what is wrong or missing","fix":"concrete change to make"}]
Only report real, actionable items. If the code is solid in your area, return fewer items. Do NOT rewrite the whole file.

--- CURRENT index.html ---
${code}
--- END ---`;
}

const ROLES = {
  GROQ: "ROLE: Speed brain. Hunt for fast-win bugs, broken event handlers, obvious logic errors, and quick correctness fixes.",
  MISTRAL: "ROLE: General coding/debugging brain. Find functional bugs, edge cases (empty states, NaN, division by zero, escaping), and state-management issues.",
  GEMINI: "ROLE: UI/UX brain. Evaluate visual hierarchy, layout responsiveness, color/tier contrast, accessibility, and smooth visual updates.",
  OPENROUTER: "ROLE: Heavy reasoning brain. Scrutinize the weighted scoring model, normalization, tier thresholds, and whether the ranking math is sound and defensible.",
  COHERE: "ROLE: Logic/structure brain. Assess code structure, naming clarity, classification of tiers/factors, and consistency of the data model.",
  CEREBRAS: "ROLE: Deep analysis brain. Long-context review: subtle interactions between filtering, sorting, comparison, editing, and dynamic recalculation; find anything that breaks under combined use.",
};

const providers = {
  GROQ: () => curlJSON("https://api.groq.com/openai/v1/chat/completions",
    { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    { model: "llama-3.3-70b-versatile", temperature: 0.3,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt(ROLES.GROQ) }] }
  ).choices[0].message.content,

  MISTRAL: () => curlJSON("https://api.mistral.ai/v1/chat/completions",
    { Authorization: `Bearer ${env.MISTRAL_API_KEY}` },
    { model: "mistral-large-latest", temperature: 0.3,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt(ROLES.MISTRAL) }] }
  ).choices[0].message.content,

  GEMINI: () => {
    let lastErr = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = curlJSON(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {},
        { contents: [{ parts: [{ text: sys + "\n\n" + userPrompt(ROLES.GEMINI) }] }],
          generationConfig: { maxOutputTokens: 4000, temperature: 0.3 } });
      if (r.candidates && r.candidates[0]?.content?.parts) {
        return r.candidates[0].content.parts.map(p => p.text).join("");
      }
      lastErr = JSON.stringify(r.error || r).slice(0, 200);
      if (r.error && r.error.code === 429) {
        execFileSync("sleep", ["35"]); // respect free-tier rate window
        continue;
      }
      break;
    }
    throw new Error("Gemini: " + lastErr);
  },

  OPENROUTER: () => curlJSON("https://openrouter.ai/api/v1/chat/completions",
    { Authorization: `Bearer ${env.OPEN_ROUTER_API_KEY}` },
    { model: "openai/gpt-4o-mini", temperature: 0.3,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt(ROLES.OPENROUTER) }] }
  ).choices[0].message.content,

  COHERE: () => {
    const r = curlJSON("https://api.cohere.ai/v2/chat",
      { Authorization: `Bearer ${env.COHERE_API_KEY}` },
      { model: "command-a-03-2025", temperature: 0.3,
        messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt(ROLES.COHERE) }] });
    return r.message.content.map(c => c.text).join("");
  },

  CEREBRAS: () => curlJSON("https://api.cerebras.ai/v1/chat/completions",
    { Authorization: `Bearer ${env.CEREBRAS_API_KEY}` },
    { model: "gpt-oss-120b", temperature: 0.3,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt(ROLES.CEREBRAS) }] }
  ).choices[0].message.content,

  NLPCLOUD: () => {
    // CPU-only key: generative models require GPU. Attempt, capture real status.
    const r = curlJSON("https://api.nlpcloud.io/v1/chatdolphin/chatbot",
      { Authorization: `Token ${env.NLP_CLOUD_API_KEY}` },
      { input: userPrompt(ROLES.GROQ) });
    return r.response || JSON.stringify(r);
  },
};

const order = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(providers);
const results = {};
for (const name of order) {
  process.stderr.write(`[round ${ROUND}] calling ${name}... `);
  try {
    const text = providers[name]();
    results[name] = { ok: true, text };
    process.stderr.write("ok\n");
  } catch (e) {
    let msg = e.message;
    if (e.stdout) msg = e.stdout.toString().slice(0, 400);
    results[name] = { ok: false, text: msg };
    process.stderr.write("FAIL\n");
  }
}

const outFile = `round${ROUND}.json`;
writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`\nWrote ${outFile}`);
for (const [k, v] of Object.entries(results)) {
  console.log(`\n================ ${k} (${v.ok ? "OK" : "FAILED"}) ================`);
  console.log(v.text.slice(0, 4000));
}
