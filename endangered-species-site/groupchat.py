#!/usr/bin/env python3
"""
groupchat.py — Claude (boss) convenes the 6-AI groupchat.

Each teammate is a REAL API call in their specialty role. They review the
current site code and return findings as compact JSON. Claude merges.
"""
import json, os, pathlib, sys, requests

CA = "/root/.ccr/ca-bundle.crt"
VERIFY = CA if os.path.exists(CA) else True
HERE = pathlib.Path(__file__).parent

def load_code():
    parts = []
    for fn in ["index.html", "style.css", "data.js", "app.js"]:
        parts.append(f"==== FILE: {fn} ====\n" + (HERE / fn).read_text())
    return "\n\n".join(parts)

ROLES = {
    "GROQ":       "speed brain — scan for quick, obvious bugs, typos, broken refs, and fast fixes",
    "MISTRAL":    "general coding/debugging brain — find correctness/logic bugs and edge cases",
    "GEMINI":     "UI/UX brain — critique layout, accessibility, visuals, responsiveness",
    "OPENROUTER": "heavy reasoning brain — deep logic review, data integrity, architecture risks",
    "COHERE":     "logic/structure brain — clarity, classification correctness, data consistency",
}

PROMPT = """You are {name}, the {role} on a 6-AI dev team building a static
website (HTML/CSS/vanilla JS) about endangered species with an evolutionary
family-tree dropdown and a Clippy-style pixel assistant named Jimmy.

Review the code below FROM YOUR SPECIALTY ANGLE. Be concise and concrete.
Respond with ONLY valid JSON (no markdown), shape:
{{"bugs": ["..."], "improvements": ["..."]}}
List real issues only; [] if none. Max 5 items each.
Keep every string under 25 words so the JSON is never truncated.

CODE:
{code}
"""

def call_openai_compat(url, key, model, content, extra_headers=None):
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    body = {"model": model, "messages": [{"role": "user", "content": content}],
            "temperature": 0.3, "max_tokens": 1400}
    r = requests.post(url, headers=headers, json=body, timeout=120, verify=VERIFY)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

def call_groq(content):
    return call_openai_compat("https://api.groq.com/openai/v1/chat/completions",
                              os.environ["GROQ_API_KEY"], "llama-3.3-70b-versatile", content)

def call_mistral(content):
    return call_openai_compat("https://api.mistral.ai/v1/chat/completions",
                              os.environ["MISTRAL_API_KEY"], "mistral-large-latest", content)

def call_openrouter(content):
    return call_openai_compat("https://openrouter.ai/api/v1/chat/completions",
                              os.environ["OPEN_ROUTER_API_KEY"],
                              "meta-llama/llama-3.3-70b-instruct", content,
                              {"HTTP-Referer": "https://example.com", "X-Title": "groupchat"})

def call_gemini(content):
    key = os.environ["GEMINI_API_KEY"]
    for model in ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        body = {"contents": [{"parts": [{"text": content}]}],
                "generationConfig": {"temperature": 0.3, "maxOutputTokens": 900}}
        r = requests.post(url, json=body, timeout=120, verify=VERIFY)
        if r.status_code == 200:
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]
    r.raise_for_status()

def call_cohere(content):
    import cohere
    co = cohere.ClientV2(api_key=os.environ["COHERE_API_KEY"])
    resp = co.chat(model="command-a-03-2025",
                   messages=[{"role": "user", "content": content}])
    return "".join(i.text for i in resp.message.content if i.type == "text")

CALLERS = {"GROQ": call_groq, "MISTRAL": call_mistral, "GEMINI": call_gemini,
           "OPENROUTER": call_openrouter, "COHERE": call_cohere}

def parse_json(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e != -1:
        text = text[s:e + 1]
    return json.loads(text)

def main():
    order = sys.argv[1:] or ["GROQ", "COHERE", "MISTRAL", "GEMINI", "OPENROUTER"]
    code = load_code()
    results = {}
    for name in order:
        prompt = PROMPT.format(name=name, role=ROLES[name], code=code)
        try:
            raw = CALLERS[name](prompt)
            try:
                results[name] = parse_json(raw)
            except Exception:
                results[name] = {"raw": raw[:600], "_parse_error": True}
            status = "ok"
        except Exception as e:
            results[name] = {"_error": repr(e)[:200]}
            status = "ERROR"
        nb = len(results[name].get("bugs", [])) if "bugs" in results[name] else "?"
        print(f"[{name:10}] {status}  bugs={nb}", file=sys.stderr)
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
