import os, time, requests, pathlib
TIMEOUT=120
OUT=pathlib.Path("orchestrator/consult"); OUT.mkdir(parents=True, exist_ok=True)

ASK = """You are designing scare mechanics for a Minecraft Bedrock add-on horror entity
("The Smiling Man") using the @minecraft/server scripting API (1.21). I need SPECIFIC,
implementable logic (pseudocode ok), not fluff. Two set-pieces:

1) WINDOW MURDER: entity stands at a window and bangs the glass with its hand (must be
VISIBLE banging - how do I drive a per-entity animation from script? entity properties +
client animation controller?). Banging starts slow, accelerates, then shatters glass.
Then a STRONG darkness/blindness effect + "HIDE" title + loud scream. After 8-12s a 50/50:
- FOUND: it must APPROACH, and only kill AFTER it actually has LINE OF SIGHT to the player.
  If the player walled themselves in, it should break ONE block, peek through the hole,
  STARE for a couple seconds, THEN kill. Never instakill without being seen. How do I do a
  reliable line-of-sight check from entity to player in script (raycast / getBlockFromRay)?
- RAN AWAY: flee fast, smash glass/blocks in its path, show "it ran away", despawn.

2) BACKSPAWN-LOOKDOWN: spawn the (very tall, ~3.6 block) entity behind and slightly ABOVE
the player so it looms and looks DOWN at them. The moment the player turns and looks at it,
play a VERY LOUD sound, then it sprints away breaking any blocks in its path.

Give me: (a) the exact API approach for visible per-entity animation switching,
(b) a robust line-of-sight/raycast snippet, (c) how to make a head look-down pose,
(d) any timing/feel tips to maximize dread. Be concise and concrete."""

def oai(url,key,model):
    h={"Authorization":f"Bearer {key}","Content-Type":"application/json"}
    p={"model":model,"messages":[{"role":"user","content":ASK}],"max_tokens":1100,"temperature":0.5}
    r=requests.post(url,headers=h,json=p,timeout=TIMEOUT); r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

def groq(): return oai("https://api.groq.com/openai/v1/chat/completions",os.environ["GROQ_API_KEY"],"llama-3.3-70b-versatile")
def mistral(): return oai("https://api.mistral.ai/v1/chat/completions",os.environ["MISTRAL_API_KEY"],"mistral-large-latest")
def openrouter(): return oai("https://openrouter.ai/api/v1/chat/completions",os.environ["OPEN_ROUTER_API_KEY"],"openai/gpt-4o-mini")
def cerebras():
    last=""
    for a in range(4):
        try:
            h={"Authorization":f"Bearer {os.environ['CEREBRAS_API_KEY']}","Content-Type":"application/json"}
            p={"model":"gpt-oss-120b","messages":[{"role":"user","content":ASK}],"max_tokens":3500,"temperature":0.5}
            r=requests.post("https://api.cerebras.ai/v1/chat/completions",headers=h,json=p,timeout=TIMEOUT); r.raise_for_status()
            m=r.json()["choices"][0]["message"]; return m.get("content") or m.get("reasoning") or "(empty)"
        except Exception as e:
            last=str(e); time.sleep(3*(a+1))
    raise RuntimeError("cerebras: "+last)
def gemini():
    key=os.environ["GEMINI_API_KEY"]
    url=f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"
    p={"contents":[{"parts":[{"text":ASK}]}],"generationConfig":{"maxOutputTokens":1500,"temperature":0.5}}
    r=requests.post(url,headers={"Content-Type":"application/json"},json=p,timeout=TIMEOUT); r.raise_for_status()
    return "".join(x.get("text","") for x in r.json()["candidates"][0]["content"]["parts"])

for name,fn in [("GROQ",groq),("MISTRAL",mistral),("OPENROUTER",openrouter),("CEREBRAS",cerebras),("GEMINI",gemini)]:
    t0=time.time()
    try:
        out=fn(); (OUT/f"{name}.txt").write_text(out)
        print(f"\n===== {name} ({round(time.time()-t0,1)}s) =====\n{out}\n")
    except Exception as e:
        print(f"\n===== {name} ERROR =====\n{e}\n")
