import os
from mistralai import Mistral

api_key = os.getenv("MISTRAL_API_KEY")
if not api_key:
    raise SystemExit(
        "MISTRAL_API_KEY is not set. Add it to your environment variables, "
        "then run this script from a fresh session."
    )

client = Mistral(api_key=api_key)

response = client.chat.complete(
    model="magistral-small-latest",  # free open-weight model
    messages=[
        {"role": "user", "content": "Give me 5 insane horror boss ideas."}
    ],
)

print(response.choices[0].message.content)
