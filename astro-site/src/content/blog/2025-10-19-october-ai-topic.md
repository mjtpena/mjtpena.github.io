---
title: "Azure Functions with AI: Building Serverless AI Applications"
author: Michael John Peña
draft: false
date: 2025-10-19
tags:
  - Azure Functions
  - Serverless
  - AI Applications
  - Azure OpenAI
  - Python

---

I wrote "Azure Functions with AI: Building Serverless AI Applications" to share practical, production-minded guidance on this topic.

## Creating an AI-Powered Function

Build a function that processes text with Azure OpenAI:

```python
import azure.functions as func
from openai import AzureOpenAI
import json
import os

app = func.FunctionApp()

# Initialize Azure OpenAI client
openai_client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-02-01"
)

@app.route(route="analyze", methods=["POST"])
def analyze_text(req: func.HttpRequest) -> func.HttpResponse:
    """Analyze text using Azure OpenAI."""

    try:
        body = req.get_json()
        text = body.get("text")
        analysis_type = body.get("type", "sentiment")

        if not text:
            return func.HttpResponse(
                json.dumps({"error": "Text is required"}),
                status_code=400,
                mimetype="application/json"
            )

        prompts = {
            "sentiment": "Analyze the sentiment of the following text. Return JSON with keys: sentiment (positive/negative/neutral), confidence (0-1), and explanation.",
            "summary": "Summarize the following text in 2-3 sentences. Return JSON with keys: summary and key_points (list).",
            "entities": "Extract named entities from the following text. Return JSON with keys: entities (list of objects with name, type, and context)."
        }

        system_prompt = prompts.get(analysis_type, prompts["sentiment"])

        response = openai_client.chat.completions.create(
            model=os.environ["AZURE_OPENAI_DEPLOYMENT"],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            response_format={"type": "json_object"},
            temperature=0.1
        )

        result = json.loads(response.choices[0].message.content)

        return func.HttpResponse(
            json.dumps({"analysis_type": analysis_type, "result": result}),
            mimetype="application/json"
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )
```

## Queue-Triggered AI Processing

Process documents asynchronously:

```python
@app.queue_trigger(arg_name="msg", queue_name="document-queue", connection="AzureWebJobsStorage")
@app.blob_output(arg_name="outputBlob", path="results/{rand-guid}.json", connection="AzureWebJobsStorage")
def process_document(msg: func.QueueMessage, outputBlob: func.Out[str]):
    """Process documents from queue with AI analysis."""

    message = json.loads(msg.get_body().decode())
    document_content = message.get("content")
    document_id = message.get("id")

    # Process with AI
    response = openai_client.chat.completions.create(
        model=os.environ["AZURE_OPENAI_DEPLOYMENT"],
        messages=[
            {"role": "system", "content": "Extract key information from this document as structured JSON."},
            {"role": "user", "content": document_content}
        ],
        response_format={"type": "json_object"}
    )

    result = {
        "document_id": document_id,
        "extraction": json.loads(response.choices[0].message.content),
        "processed_at": datetime.utcnow().isoformat()
    }

    outputBlob.set(json.dumps(result))
```

## Performance Considerations

Configure appropriate timeout settings for AI operations and implement retry logic for transient failures. Consider using premium plans for latency-sensitive AI workloads.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
