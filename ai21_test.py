import os

import requests

# AI21 Labs ("AL21") chat completions endpoint.
API_URL = "https://api.ai21.com/studio/v1/chat/completions"

# Best model available on the AI21 free trial credits.
MODEL = "jamba-large"

api_key = os.getenv("AL21_API_KEY")
if not api_key:
    raise SystemExit(
        "AL21_API_KEY is not set. Add it to your environment variables, "
        "then run this script from a fresh session."
    )

response = requests.post(
    API_URL,
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    json={
        "model": MODEL,
        "messages": [
            {"role": "user", "content": "Give me 5 insane horror boss ideas."}
        ],
    },
    timeout=60,
)
response.raise_for_status()

data = response.json()
print(data["choices"][0]["message"]["content"])
