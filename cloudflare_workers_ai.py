"""Cloudflare Workers AI client.

Sends a chat message to Cloudflare Workers AI using the REST API.

Auth: this account uses a Cloudflare Global API Key (the `cfk_` prefixed key),
which authenticates with the `X-Auth-Email` + `X-Auth-Key` headers rather than a
Bearer token. The account ID is discovered automatically from the key.

Required environment variable:
    CLOUD_WORKER_AI   - the Cloudflare Global API Key (starts with "cfk_")

Optional environment variables:
    CLOUDFLARE_EMAIL        - account email (defaults below)
    CLOUDFLARE_ACCOUNT_ID   - skip auto-discovery and use this account id
    WORKERS_AI_MODEL        - override the model
"""

import os
import json
import urllib.request

# Best free model available on this account. All Workers AI models share the
# same free daily allocation, so this is simply the most capable one.
DEFAULT_MODEL = "@cf/openai/gpt-oss-120b"
DEFAULT_EMAIL = "cory56626@gmail.com"

API_BASE = "https://api.cloudflare.com/client/v4"


def _request(url, headers, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method="POST" if body else "GET")
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def get_account_id(email, api_key):
    headers = {"X-Auth-Email": email, "X-Auth-Key": api_key}
    data = _request(f"{API_BASE}/accounts", headers)
    if not data.get("success") or not data.get("result"):
        raise SystemExit(f"Could not fetch account id: {data.get('errors')}")
    return data["result"][0]["id"]


def chat(message, model=DEFAULT_MODEL):
    api_key = os.getenv("CLOUD_WORKER_AI")
    if not api_key:
        raise SystemExit(
            "CLOUD_WORKER_AI is not set. Add your Cloudflare Global API Key to "
            "your environment variables, then run this script from a fresh session."
        )

    email = os.getenv("CLOUDFLARE_EMAIL", DEFAULT_EMAIL)
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID") or get_account_id(email, api_key)
    model = os.getenv("WORKERS_AI_MODEL", model)

    headers = {
        "X-Auth-Email": email,
        "X-Auth-Key": api_key,
        "Content-Type": "application/json",
    }
    url = f"{API_BASE}/accounts/{account_id}/ai/run/{model}"
    payload = {
        "messages": [{"role": "user", "content": message}],
        # Reasoning models (e.g. gpt-oss) spend tokens on hidden reasoning, so
        # give the budget enough room to also produce a visible answer.
        "max_tokens": 2048,
    }
    data = _request(url, headers, payload)

    if not data.get("success"):
        raise SystemExit(f"Workers AI request failed: {data.get('errors')}")

    result = data["result"]
    # The OpenAI-compatible models return choices[]; others return "response".
    if result.get("response"):
        return result["response"]
    message_obj = result["choices"][0]["message"]
    return message_obj.get("content") or message_obj.get("reasoning_content")


if __name__ == "__main__":
    reply = chat("Give me 5 insane horror boss ideas.")
    print(reply)
