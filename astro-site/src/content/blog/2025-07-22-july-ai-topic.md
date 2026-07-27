---
title: "Azure Functions with AI: Serverless Inference Patterns"
author: Michael John Peña
draft: false
date: 2025-07-22
tags:
  - Azure Functions
  - Serverless
  - AI Inference
  - Python
  - Cost Optimization

---

I wrote "Azure Functions with AI: Serverless Inference Patterns" to share practical, production-minded guidance on this topic.

## Configuring Functions for AI Workloads

Set up your function with appropriate timeouts and memory:

```python
# function_app.py
import azure.functions as func
from openai import AzureOpenAI
import json
import os

app = func.FunctionApp()

# Initialize client outside handler for connection reuse
client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2024-12-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

@app.route(route="analyze", methods=["POST"])
async def analyze_document(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
        document_text = body.get("text", "")
        analysis_type = body.get("type", "summary")

        prompts = {
            "summary": "Summarize this document in 3-5 bullet points:",
            "sentiment": "Analyze the sentiment of this text. Return JSON with overall_sentiment and confidence:",
            "entities": "Extract all named entities (people, organizations, locations) as JSON:"
        }

        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": prompts.get(analysis_type, prompts["summary"])},
                {"role": "user", "content": document_text}
            ],
            max_tokens=1000,
            temperature=0.3
        )

        return func.HttpResponse(
            json.dumps({
                "analysis": response.choices[0].message.content,
                "type": analysis_type,
                "tokens_used": response.usage.total_tokens
            }),
            mimetype="application/json"
        )
    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )
```

## Handling Long-Running AI Tasks

For tasks exceeding the HTTP timeout, use Durable Functions:

```python
import azure.durable_functions as df

@app.orchestration_trigger(context_name="context")
def batch_analysis_orchestrator(context: df.DurableOrchestrationContext):
    documents = context.get_input()

    # Fan out to analyze documents in parallel
    tasks = [
        context.call_activity("analyze_single_document", doc)
        for doc in documents
    ]

    results = yield context.task_all(tasks)

    # Aggregate results
    return {
        "total_documents": len(documents),
        "results": results
    }

@app.activity_trigger(input_name="document")
async def analyze_single_document(document: dict) -> dict:
    # Perform AI analysis
    return {"id": document["id"], "analysis": "..."}
```

## Cost Optimization

Use consumption-based billing to pay only for actual inference time. Implement caching for repeated queries and batch similar requests to amortize cold start costs.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
