---
title: "Azure OpenAI Service is Now Generally Available"
author: Michael John Peña
draft: false
date: 2023-01-20
tags:
  - Azure
  - OpenAI
  - AI
  - GPT-3
  - Enterprise

---

I wrote "Azure OpenAI Service is Now Generally Available" to share practical, production-minded guidance on this topic.

## What is Azure OpenAI Service?

Azure OpenAI Service gives you API access to OpenAI's models - GPT-3.5, Codex, and DALL-E - but running on Azure infrastructure with enterprise-grade security.

The key differentiators from using OpenAI directly:
- **Data Privacy**: Your prompts and completions are not used to train models
- **Compliance**: HIPAA, SOC 2, GDPR compliance inherited from Azure
- **Network Security**: VNet integration, private endpoints
- **Regional Deployment**: Data stays in your chosen region
- **SLA**: Enterprise support and uptime guarantees

## Getting Started

Access is still request-based - you need to apply and be approved. Once approved:

```python
import openai

openai.api_type = "azure"
openai.api_base = "https://YOUR_RESOURCE.openai.azure.com/"
openai.api_version = "2022-12-01"
openai.api_key = "YOUR_API_KEY"

response = openai.Completion.create(
    engine="text-davinci-003",  # Your deployed model name
    prompt="Explain Azure Synapse Analytics in one paragraph.",
    max_tokens=200,
    temperature=0.7
)

print(response.choices[0].text)
```

The API is familiar if you've used OpenAI's Python library - you just add the Azure-specific configuration.

## Model Deployment

Unlike the public OpenAI API where you call models by name, Azure requires you to deploy models first:

1. Create an Azure OpenAI resource
2. Deploy models (GPT-3.5, Codex, etc.) to your resource
3. Call your deployed model by its deployment name

```bash
# Azure CLI deployment example
az cognitiveservices account deployment create \
    --name my-openai \
    --resource-group my-rg \
    --deployment-name gpt35 \
    --model-name gpt-35-turbo \
    --model-version "0301" \
    --model-format OpenAI \
    --scale-settings-scale-type "Standard"
```

## Practical Use Cases

**1. Internal Knowledge Base Q&A**

Combine Azure OpenAI with Azure Cognitive Search to build Q&A over your internal documents:

```python
# Retrieve relevant documents from Cognitive Search
search_results = search_client.search(query=user_question, top=5)

# Construct prompt with retrieved context
context = "\n".join([doc['content'] for doc in search_results])
prompt = f"""Based on the following context, answer the question.

Context:
{context}

Question: {user_question}

Answer:"""

# Generate answer
response = openai.Completion.create(engine="gpt35", prompt=prompt, max_tokens=500)
```

This pattern - Retrieval Augmented Generation (RAG) - grounds GPT's responses in your actual data.

**2. Code Documentation Generation**

Generate documentation for your internal codebases:

```python
code = """
def calculate_daily_metrics(df, date_col, metric_cols):
    return df.groupby(pd.Grouper(key=date_col, freq='D'))[metric_cols].agg(['sum', 'mean', 'count'])
"""

prompt = f"""Generate detailed docstring for this Python function:

```python
{code}
```

Include Args, Returns, and Example sections."""

response = openai.Completion.create(engine="gpt35", prompt=prompt, max_tokens=500)
```

**3. Data Quality Description**

Generate human-readable descriptions of data quality issues:

```python
dq_results = {
    "null_percentage": 15.2,
    "duplicate_rate": 0.3,
    "outlier_count": 47,
    "schema_violations": ["order_date has 12 future dates", "amount has 3 negative values"]
}

prompt = f"""Write a brief data quality summary for stakeholders based on these metrics:
{json.dumps(dq_results, indent=2)}

Keep it non-technical and actionable."""
```

## Enterprise Considerations

**Content Filtering**

Azure OpenAI includes built-in content filters for:
- Hate speech
- Sexual content
- Violence
- Self-harm

You can configure filter sensitivity levels per deployment.

**Rate Limiting and Quotas**

Throughput is measured in tokens per minute (TPM). Default quotas:
- GPT-3.5 Turbo: 120K TPM
- Text-davinci-003: 120K TPM

For higher limits, request quota increases through Azure support.

**Cost Management**

Pricing is per 1,000 tokens:
- GPT-3.5 Turbo: ~$0.002 per 1K tokens
- Text-davinci-003: ~$0.02 per 1K tokens

Build cost tracking into your applications:

```python
response = openai.Completion.create(engine="gpt35", prompt=prompt, max_tokens=500)

tokens_used = response['usage']['total_tokens']
estimated_cost = tokens_used * 0.002 / 1000

# Log for cost tracking
logger.info(f"Request used {tokens_used} tokens, estimated cost: ${estimated_cost:.4f}")
```

## What's Coming: ChatGPT

Microsoft confirmed ChatGPT will be added to Azure OpenAI Service "soon." This will enable:
- Multi-turn conversations
- System prompts for persona control
- Better instruction following

When it lands, we'll be able to build ChatGPT-like experiences within our enterprise applications, with all the security and compliance benefits of Azure.

## My Recommendations

1. **Apply for access now** - The waitlist is growing; get in queue
2. **Start with RAG patterns** - Don't let GPT hallucinate; ground it in your data
3. **Build cost tracking early** - Token costs add up at scale
4. **Use content filtering** - Don't ship without appropriate guardrails
5. **Monitor and iterate** - Prompt engineering is an ongoing process

This is a pivotal moment. The technology that powered ChatGPT is now available for enterprise applications, with the security posture our organizations require. The question isn't whether to use it, but how.

## Resources

- [Azure OpenAI Service Documentation](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/)
- [Azure OpenAI Pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)
- [Responsible AI Practices](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/concepts/responsible-ai)
- [Apply for Access](https://aka.ms/oai/access)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
