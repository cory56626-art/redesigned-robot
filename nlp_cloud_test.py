import os
import nlpcloud

api_key = os.getenv("NLP_CLOUD_API_KEY")
if not api_key:
    raise SystemExit(
        "NLP_CLOUD_API_KEY is not set. Add it to your environment variables, "
        "then run this script from a fresh session."
    )

# chatdolphin is NLP Cloud's best conversational model available on the free
# plan. It is served on GPU, so gpu=True is required.
client = nlpcloud.Client("chatdolphin", api_key, gpu=True)

response = client.chatbot(
    input="Give me 5 insane horror boss ideas.",
)

print(response["response"])
