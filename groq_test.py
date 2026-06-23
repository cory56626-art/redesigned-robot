import os
from groq import Groq

api_key = os.getenv("GROQ_API_KEY")
if not api_key:
    raise SystemExit(
        "GROQ_API_KEY is not set. Add it to your environment variables, "
        "then run this script from a fresh session."
    )

client = Groq(api_key=api_key)

response = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[
        {"role": "user", "content": "Give me 5 insane horror boss ideas."}
    ],
)

print(response.choices[0].message.content)
