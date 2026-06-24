import os
from openai import OpenAI

api_key = os.getenv("OPEN_ROUTER_API_KEY")
if not api_key:
    raise SystemExit(
        "OPEN_ROUTER_API_KEY is not set. Add it to your environment variables, "
        "then run this script from a fresh session."
    )

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=api_key,
)

response = client.chat.completions.create(
    model="nvidia/nemotron-3-ultra-550b-a55b:free",
    messages=[
        {"role": "user", "content": "Give me 5 insane horror boss ideas."}
    ],
)

print(response.choices[0].message.content)
