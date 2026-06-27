import os, sys, json, time, requests, pathlib

TIMEOUT = 120
ROUND = sys.argv[1] if len(sys.argv) > 1 else "1"
TARGET = sys.argv[2] if len(sys.argv) > 2 else "addon/SmilingMan_BP/scripts/main.js"
OUTDIR = pathlib.Path(f"orchestrator/round{ROUND}")
OUTDIR.mkdir(parents=True, exist_ok=True)

code = open(TARGET).read()
entity = open("addon/SmilingMan_BP/entities/smiling_man.json").read()

TASK = (
    "You are a senior Minecraft Bedrock add-on engineer reviewing a SERVER SCRIPT that uses "
    "the @minecraft/server scripting API (module version 1.13.0, Bedrock 1.21). "
    "Find CONCRETE bugs: API misuse, methods that don't exist or have wrong signatures, "
    "runtime crashes, logic errors, or things that won't work in-game. "
    "Output a SHORT numbered list. Each item: <function/area> - <problem> - <fix>. "
    "Be specific and terse. If genuinely no bugs, output exactly 'NO BUGS'.\n\n"
    "Known API facts for 1.13: system.runInterval/runTimeout/clearRun exist; "
    "entity.isValid may be a property in newer versions; dimension.runCommand is sync and exists; "
    "block.setPermutation/withState exist; player.onScreenDisplay.setTitle/setActionBar exist; "
    "player.applyDamage(amount, options) exists; world.getTimeOfDay() exists.\n\n"
    "=== BP ENTITY JSON ===\n" + entity[:4000] +
    "\n\n=== SERVER SCRIPT (main.js) ===\n" + code
)

def openai_compat(url, key, model, auth="Bearer"):
    h = {"Authorization": f"{auth} {key}", "Content-Type": "application/json"}
    p = {"model": model, "messages": [{"role": "user", "content": TASK}],
         "max_tokens": 1200, "temperature": 0.3}
    r = requests.post(url, headers=h, json=p, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

def groq():     return openai_compat("https://api.groq.com/openai/v1/chat/completions", os.environ["GROQ_API_KEY"], "llama-3.3-70b-versatile")
def mistral():  return openai_compat("https://api.mistral.ai/v1/chat/completions", os.environ["MISTRAL_API_KEY"], "mistral-large-latest")
def openrouter():return openai_compat("https://openrouter.ai/api/v1/chat/completions", os.environ["OPEN_ROUTER_API_KEY"], "openai/gpt-4o-mini")

def cerebras():
    url = "https://api.cerebras.ai/v1/chat/completions"
    h = {"Authorization": f"Bearer {os.environ['CEREBRAS_API_KEY']}", "Content-Type": "application/json"}
    p = {"model": "gpt-oss-120b", "messages": [{"role": "user", "content": TASK}],
         "max_tokens": 4000, "temperature": 0.3}
    last = ""
    for attempt in range(5):
        try:
            r = requests.post(url, headers=h, json=p, timeout=TIMEOUT)
            r.raise_for_status()
            msg = r.json()["choices"][0]["message"]
            return msg.get("content") or msg.get("reasoning") or "(empty)"
        except Exception as e:
            last = str(e)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("cerebras unavailable after retries: " + last)

def cohere():
    h = {"Authorization": f"Bearer {os.environ['COHERE_API_KEY']}", "Content-Type": "application/json"}
    p = {"model": "command-a-03-2025", "messages": [{"role": "user", "content": TASK}], "max_tokens": 1200}
    r = requests.post("https://api.cohere.ai/v2/chat", headers=h, json=p, timeout=TIMEOUT)
    r.raise_for_status()
    parts = r.json()["message"]["content"]
    return "".join(b.get("text", "") for b in parts)

def gemini():
    key = os.environ["GEMINI_API_KEY"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"
    p = {"contents": [{"parts": [{"text": TASK}]}], "generationConfig": {"maxOutputTokens": 1500, "temperature": 0.3}}
    r = requests.post(url, headers={"Content-Type": "application/json"}, json=p, timeout=TIMEOUT)
    r.raise_for_status()
    cand = r.json()["candidates"][0]["content"]["parts"]
    return "".join(part.get("text", "") for part in cand)

def nlpcloud():
    key = os.environ["NLP_CLOUD_API_KEY"]
    url = "https://api.nlpcloud.io/v1/gpu/finetuned-llama-3-70b/chatbot"
    h = {"Authorization": f"Token {key}", "Content-Type": "application/json"}
    # nlpcloud chatbot has tighter limits; send a trimmed payload
    p = {"input": TASK[:6000], "context": "You review Minecraft Bedrock scripts and list concrete bugs tersely.", "history": []}
    r = requests.post(url, headers=h, json=p, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["response"]

AGENTS = [
    ("GROQ", groq), ("MISTRAL", mistral), ("GEMINI", gemini),
    ("OPENROUTER", openrouter), ("COHERE", cohere),
    ("NLPCLOUD", nlpcloud), ("CEREBRAS", cerebras),
]

summary = {}
for name, fn in AGENTS:
    t0 = time.time()
    try:
        out = fn()
        (OUTDIR / f"{name}.txt").write_text(out)
        nobugs = out.strip().upper().startswith("NO BUGS")
        summary[name] = ("OK", round(time.time() - t0, 1), len(out), nobugs)
        print(f"\n========== {name}  ({summary[name][1]}s) ==========\n{out}\n")
    except Exception as e:
        (OUTDIR / f"{name}.ERROR.txt").write_text(str(e))
        summary[name] = ("ERROR", round(time.time() - t0, 1), 0, None)
        print(f"\n========== {name} ERROR ==========\n{e}\n")

print("\n==== ROUND", ROUND, "SUMMARY ====")
for k, v in summary.items():
    print(f"  {k}: {v[0]}  {v[1]}s  chars={v[2]}  nobugs={v[3]}")
