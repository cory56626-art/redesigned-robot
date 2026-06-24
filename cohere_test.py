import os

import cohere

api_key = os.getenv("COHERE_API_KEY")
if not api_key:
    raise SystemExit(
        "COHERE_API_KEY is not set. Add it to your environment variables, "
        "then run this script from a fresh session."
    )

client = cohere.ClientV2(api_key=api_key)

# command-a-plus-05-2026 is Cohere's newest flagship (Command A+). It's a
# reasoning model, so its response can contain "thinking" blocks in addition
# to the final "text" block. On a Cohere trial key it's free (rate limited).
response = client.chat(
    model="command-a-plus-05-2026",
    messages=[
        {"role": "user", "content": "Give me 5 insane horror boss ideas."}
    ],
)

# Print only the final answer text (skip any reasoning/thinking blocks).
for item in response.message.content:
    if item.type == "text":
        print(item.text)
