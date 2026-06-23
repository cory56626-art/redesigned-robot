import os
import openai

openai.api_key = os.getenv("OPENAI_API_KEY")

response = openai.chat.completions.create(
    model="gpt-5",
    messages=[
        {"role": "user", "content": "Give me 5 insane horror boss ideas."}
    ]
)

print(response.choices[0].message.content)
