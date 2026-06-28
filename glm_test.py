import os

import requests

# Note: the environment variable name contains a dot, so it must be read by
# its exact key rather than as a normal shell-style identifier.
api_key = os.environ.get("GLM5.2_API_KEY")
if not api_key:
    raise SystemExit(
        "GLM5.2_API_KEY is not set. Add it to your environment variables, "
        "then run this script from a fresh session."
    )

# GLM (Z.ai / Zhipu) exposes an OpenAI-compatible chat completions endpoint.
# glm-4.5-flash is the free model and is the only one usable without account
# balance. Paid models (e.g. glm-5.2, glm-4.6) need credits on the account.
url = "https://api.z.ai/api/paas/v4/chat/completions"
model = "glm-4.5-flash"

response = requests.post(
    url,
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    json={
        "model": model,
        "messages": [
            {"role": "user", "content": "Give me 5 insane horror boss ideas."}
        ],
        # glm-4.5-flash is a reasoning model: leave room for its hidden
        # reasoning step so the final answer isn't truncated.
        "max_tokens": 2048,
    },
    timeout=60,
)
response.raise_for_status()

print(response.json()["choices"][0]["message"]["content"])
