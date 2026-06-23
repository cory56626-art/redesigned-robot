import json
import os
import urllib.error
import urllib.request

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise SystemExit(
        "GEMINI_API_KEY is not set. Add it to your environment variables, "
        "then run this script from a fresh session."
    )

# Use a current model. The older gemini-2.0 / 1.5 models have no free-tier
# quota on new keys, so stick with the 2.5 line.
model = "gemini-2.5-flash"
url = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{model}:generateContent?key={api_key}"
)

payload = {
    "contents": [
        {"parts": [{"text": "Give me 5 insane horror boss ideas."}]}
    ]
}

request = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)

try:
    with urllib.request.urlopen(request) as response:
        data = json.load(response)
except urllib.error.HTTPError as error:
    raise SystemExit(f"Request failed ({error.code}): {error.read().decode()}")

print(data["candidates"][0]["content"]["parts"][0]["text"])
