---
title: "Azure OpenAI Service Expansion: Bringing GPT Models to Enterprise"
description: "This isn't just \"OpenAI but on Azure\" - it's OpenAI made enterprise-ready. The approval process exists because Microsoft wants to ensure responsible use. Be…"
author: Michael John Peña
draft: false
date: 2022-03-01
tags:
  - Azure
  - OpenAI
  - AI
  - GPT-3
  - Enterprise
---

## Why Azure OpenAI Matters

The raw power of GPT-3 is impressive, but enterprises need more than raw power:

- **Compliance**: Data stays within Azure's compliance boundaries
- **Security**: Enterprise-grade authentication and network isolation
- **SLAs**: Production-ready service level agreements
- **Integration**: Native Azure service connections

This isn't just "OpenAI but on Azure" - it's OpenAI made enterprise-ready.

## Getting Access

Azure OpenAI is currently in limited preview. To apply:

1. Navigate to the Azure OpenAI Service page
2. Complete the application form
3. Describe your intended use case
4. Wait for approval (typically 2-4 weeks)

The approval process exists because Microsoft wants to ensure responsible use. Be specific about your use case - vague applications get rejected.

## Your First Completion

Once approved, here's how to get started with Python:

```python
import openai
import os

openai.api_type = "azure"
openai.api_base = os.environ["AZURE_OPENAI_ENDPOINT"]
openai.api_version = "2022-03-01-preview"
openai.api_key = os.environ["AZURE_OPENAI_KEY"]

response = openai.Completion.create(
    engine="text-davinci-002",  # Your deployment name
    prompt="Explain Azure OpenAI Service in one paragraph:",
    max_tokens=150,
    temperature=0.7,
    top_p=1,
    frequency_penalty=0,
    presence_penalty=0
)

print(response.choices[0].text)
```

The key difference from OpenAI's direct API: you specify `engine` (your deployment name) rather than `model`.

## Understanding the Models

Azure OpenAI currently offers several model families:

**GPT-3 Base Models**:
- `text-davinci-002`: Most capable, highest cost
- `text-curie-001`: Good balance of capability and cost
- `text-babbage-001`: Faster, less capable
- `text-ada-001`: Fastest, simplest tasks only

**Codex Models**:
- `code-davinci-002`: Best for code generation
- `code-cushman-001`: Faster code completion

## Creating a Deployment

Before calling the API, you need to create a deployment:

```bash
az cognitiveservices account deployment create \
    --name myOpenAIResource \
    --resource-group myResourceGroup \
    --deployment-name text-davinci-deployment \
    --model-name text-davinci-002 \
    --model-version "1" \
    --model-format OpenAI \
    --scale-settings-scale-type "Standard"
```

Each deployment gets its own rate limits and can be scaled independently.

## Rate Limits and Quotas

Azure OpenAI has per-minute and per-day limits:

| Model | Tokens/min | Requests/min |
|-------|------------|--------------|
| Davinci | 120,000 | 120 |
| Curie | 120,000 | 120 |
| Babbage | 120,000 | 120 |
| Ada | 120,000 | 120 |

For production workloads, implement retry logic with exponential backoff:

```python
import time
from tenacity import retry, wait_exponential, stop_after_attempt

@retry(wait=wait_exponential(min=1, max=60), stop=stop_after_attempt(5))
def call_openai_with_retry(prompt):
    return openai.Completion.create(
        engine="text-davinci-deployment",
        prompt=prompt,
        max_tokens=150
    )
```

## Content Filtering

Azure OpenAI includes built-in content filtering that you cannot disable. This is by design - Microsoft takes responsible AI seriously.

The filter catches:
- Hate speech
- Violence
- Self-harm content
- Sexual content

If your application legitimately needs to process such content (e.g., content moderation), you'll need to apply for modified filtering.

## Cost Optimization

GPT-3 pricing is based on tokens (roughly 4 characters = 1 token). Tips for cost control:

1. **Choose the right model**: Don't use Davinci when Ada suffices
2. **Limit max_tokens**: Only request what you need
3. **Cache responses**: Store and reuse identical queries
4. **Batch requests**: Combine multiple prompts when possible

```python
# Bad: Separate requests
for item in items:
    result = get_completion(f"Classify: {item}")

# Better: Batched request
prompt = "Classify each item:\n" + "\n".join(items)
result = get_completion(prompt)
```

## Integration with Azure Services

The real power comes from combining Azure OpenAI with other services:

**Azure Functions + OpenAI**:
```python
import azure.functions as func
import openai

def main(req: func.HttpRequest) -> func.HttpResponse:
    prompt = req.get_json().get('prompt')

    response = openai.Completion.create(
        engine="text-davinci-deployment",
        prompt=prompt,
        max_tokens=100
    )

    return func.HttpResponse(
        response.choices[0].text,
        mimetype="text/plain"
    )
```

**Logic Apps**: Use the HTTP connector to call your Function wrapper, enabling no-code GPT integration.

**Power Automate**: Build flows that leverage GPT for document processing, email responses, or content generation.

## Security Best Practices

1. **Never embed keys in code**: Use Azure Key Vault
2. **Use managed identities**: Avoid key management entirely
3. **Enable private endpoints**: Keep traffic on Azure's backbone
4. **Monitor usage**: Set up alerts for unusual patterns

```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient

credential = DefaultAzureCredential()
client = SecretClient(vault_url="https://myvault.vault.azure.net/", credential=credential)
openai.api_key = client.get_secret("openai-key").value
```

## What's Coming

Microsoft has hinted at several upcoming capabilities:
- Fine-tuning support for custom models
- Additional model families
- Increased quotas for high-volume customers
- ChatGPT-style conversational models

The pace of innovation here is remarkable. What's available today is just the beginning.

## Conclusion

Azure OpenAI Service represents a significant shift in how enterprises can leverage AI. The combination of GPT's capabilities with Azure's enterprise features creates possibilities that weren't practical before.

Start small - experiment with a single use case, measure the results, and expand from there. The technology is mature enough for production, but novel enough that best practices are still emerging.

## Resources

- [Azure OpenAI Service Documentation](https://docs.microsoft.com/en-us/azure/cognitive-services/openai/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Responsible AI Guidelines](https://www.microsoft.com/en-us/ai/responsible-ai)
