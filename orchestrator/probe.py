import os, json, requests, traceback

TIMEOUT=60
def post(url, headers, payload):
    r = requests.post(url, headers=headers, json=payload, timeout=TIMEOUT)
    return r.status_code, r.text[:400]

def openai_compat(name, url, key, model, auth="Bearer"):
    h={"Authorization":f"{auth} {key}","Content-Type":"application/json"}
    p={"model":model,"messages":[{"role":"user","content":"Reply with the single word: OK"}],"max_tokens":10}
    return post(url,h,p)

results={}
def run(name, fn):
    try:
        sc, body = fn()
        results[name]=(sc, body)
        print(f"=== {name} === HTTP {sc}\n{body}\n")
    except Exception as e:
        results[name]=("ERR", str(e))
        print(f"=== {name} === EXCEPTION\n{e}\n")

run("GROQ", lambda: openai_compat("GROQ","https://api.groq.com/openai/v1/chat/completions",os.environ["GROQ_API_KEY"],"llama-3.3-70b-versatile"))
run("MISTRAL", lambda: openai_compat("MISTRAL","https://api.mistral.ai/v1/chat/completions",os.environ["MISTRAL_API_KEY"],"mistral-large-latest"))
run("OPENROUTER", lambda: openai_compat("OPENROUTER","https://openrouter.ai/api/v1/chat/completions",os.environ["OPEN_ROUTER_API_KEY"],"openai/gpt-4o-mini"))
run("CEREBRAS", lambda: openai_compat("CEREBRAS","https://api.cerebras.ai/v1/chat/completions",os.environ["CEREBRAS_API_KEY"],"gpt-oss-120b"))

# Cohere v2 chat
def cohere():
    h={"Authorization":f"Bearer {os.environ['COHERE_API_KEY']}","Content-Type":"application/json"}
    p={"model":"command-r-plus","messages":[{"role":"user","content":"Reply with the single word: OK"}]}
    return post("https://api.cohere.ai/v2/chat",h,p)
run("COHERE", cohere)

# Gemini
def gemini():
    key=os.environ["GEMINI_API_KEY"]
    url=f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}"
    h={"Content-Type":"application/json"}
    p={"contents":[{"parts":[{"text":"Reply with the single word: OK"}]}]}
    return post(url,h,p)
run("GEMINI", gemini)

# NLP Cloud
def nlpcloud():
    key=os.environ["NLP_CLOUD_API_KEY"]
    url="https://api.nlpcloud.io/v1/gpu/finetuned-llama-3-70b/chatbot"
    h={"Authorization":f"Token {key}","Content-Type":"application/json"}
    p={"input":"Reply with the single word: OK","context":"You are helpful.","history":[]}
    return post(url,h,p)
run("NLPCLOUD", nlpcloud)

print("\nSUMMARY:")
for k,v in results.items():
    print(f"  {k}: {v[0]}")
