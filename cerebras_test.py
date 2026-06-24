import os
from cerebras.cloud.sdk import Cerebras

api_key = os.getenv("CEREBRAS_API_KEY")
if not api_key:
    raise SystemExit(
        "CEREBRAS_API_KEY is not set. Add it to your environment variables, "
        "then run this script from a fresh session."
    )

client = Cerebras(api_key=api_key)

# Best free Cerebras model: zai-glm-4.7 (GLM-4.7), the most capable model
# available on the free tier.
response = client.chat.completions.create(
    model="zai-glm-4.7",
    messages=[
        {"role": "user", "content": "Give me 5 insane horror boss ideas."}
    ],
)

print(response.choices[0].message.content)
