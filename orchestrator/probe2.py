import os, requests, time
TIMEOUT=60
def post(url,h,p):
    r=requests.post(url,headers=h,json=p,timeout=TIMEOUT); return r.status_code, r.text[:300]

# Cohere - try current models
for m in ["command-a-03-2025","command-r-08-2024","command-r7b-12-2024"]:
    h={"Authorization":f"Bearer {os.environ['COHERE_API_KEY']}","Content-Type":"application/json"}
    p={"model":m,"messages":[{"role":"user","content":"Reply OK"}]}
    try:
        sc,b=post("https://api.cohere.ai/v2/chat",h,p); print(f"COHERE {m}: {sc} {b[:120]}")
        if sc==200: break
    except Exception as e: print("COHERE err",e)

# Cerebras retry with backoff, try model variants
for m in ["gpt-oss-120b","llama-3.3-70b","llama3.1-8b"]:
    for attempt in range(3):
        h={"Authorization":f"Bearer {os.environ['CEREBRAS_API_KEY']}","Content-Type":"application/json"}
        p={"model":m,"messages":[{"role":"user","content":"Reply OK"}],"max_tokens":10}
        try:
            sc,b=post("https://api.cerebras.ai/v1/chat/completions",h,p)
            print(f"CEREBRAS {m} try{attempt}: {sc} {b[:120]}")
            if sc==200: break
            time.sleep(2*(attempt+1))
        except Exception as e: print("CEREBRAS err",e); time.sleep(2)
    if sc==200: break

# Gemini try lite + other versions
for m in ["gemini-2.0-flash-lite","gemini-1.5-flash","gemini-2.5-flash"]:
    key=os.environ["GEMINI_API_KEY"]
    url=f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}"
    p={"contents":[{"parts":[{"text":"Reply OK"}]}]}
    try:
        sc,b=post(url,{"Content-Type":"application/json"},p); print(f"GEMINI {m}: {sc} {b[:120]}")
        if sc==200: break
    except Exception as e: print("GEMINI err",e)
