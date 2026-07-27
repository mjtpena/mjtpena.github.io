---
title: "Azure OpenAI Service Announced: What We Know About the Limited Preview"
author: Michael John Pena
draft: false
date: 2021-11-13
tags:
  - Azure
  - OpenAI
  - AI
  - Machine Learning
  - Cognitive Services

---

I wrote "Azure OpenAI Service Announced: What We Know About the Limited Preview" to share practical, production-minded guidance on this topic.

## What Was Announced

Microsoft and OpenAI announced a partnership to bring OpenAI's large language models to Azure with enterprise-grade security and compliance. Key points from the announcement:

- **Limited Preview**: The service is in extremely limited preview, available only to select customers through an application process
- **Enterprise Security**: Azure AD authentication, compliance certifications, and regional data residency
- **Responsible AI**: Content filtering and usage monitoring built in
- **GPT-3 Models**: Access to OpenAI's GPT-3 family of models

## Why This Matters

Large language models like GPT-3 have demonstrated remarkable capabilities in:

- Natural language understanding and generation
- Code generation and completion
- Text summarization
- Question answering
- Content classification

However, enterprises have been hesitant to adopt these technologies due to concerns about data privacy, compliance, and operational control. Azure OpenAI Service aims to address these concerns by providing:

1. **Data Privacy**: Customer data is not used to train or improve the models
2. **Compliance**: Enterprise compliance certifications
3. **Control**: Azure-native deployment and management
4. **Support**: Microsoft enterprise support

## Current Limitations

As of November 2021, it's important to understand the limitations:

- **Access is Extremely Restricted**: You must apply and be approved to access the service
- **Limited Regions**: Only available in limited Azure regions
- **Preview Features**: This is preview technology subject to change
- **No Public API Documentation Yet**: Detailed API specifications are not publicly available

## How to Apply for Access

If your organization is interested in early access:

```bash
# Check Azure portal for the application form
# Go to Azure Portal -> Create Resource -> Search "OpenAI"
# Or visit the Azure OpenAI Service application page
```

The application process requires:
- Description of your intended use case
- Commitment to responsible AI practices
- Enterprise agreement with Microsoft

## What to Expect

Based on OpenAI's public GPT-3 API, we can anticipate similar capabilities:

- **Completion API**: Generate text continuations from prompts
- **Multiple Model Sizes**: Different models for different use cases and costs
- **Fine-tuning**: Potentially customize models for specific domains

## Responsible AI Considerations

Microsoft emphasized responsible AI practices:

```markdown
Key Principles:
- Fairness: Models should treat all users equitably
- Reliability: Consistent and predictable behavior
- Privacy: Protecting user data and privacy
- Inclusiveness: Designed to be accessible
- Transparency: Clear about AI involvement
- Accountability: Clear ownership and responsibility
```

## Current Alternatives

While waiting for Azure OpenAI access, consider these alternatives:

### Azure Cognitive Services

Azure already offers many AI capabilities that are generally available:

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

# Text Analytics for sentiment, key phrases, entities
client = TextAnalyticsClient(
    endpoint="https://your-resource.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

documents = ["Azure Cognitive Services provides powerful AI capabilities."]

# Analyze sentiment
response = client.analyze_sentiment(documents)
for doc in response:
    print(f"Sentiment: {doc.sentiment}")
    print(f"Confidence: {doc.confidence_scores}")
```

### Azure Machine Learning

For custom language models:

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

# Train your own language models with Azure ML
ml_client = MLClient(
    DefaultAzureCredential(),
    subscription_id="your-sub",
    resource_group_name="your-rg",
    workspace_name="your-workspace"
)

# Use Hugging Face transformers with Azure ML compute
# Deploy fine-tuned models for your specific use cases
```

### OpenAI Direct API

For non-enterprise scenarios, you can use OpenAI's API directly:

```python
import openai

# Direct OpenAI API (not Azure)
openai.api_key = "your-openai-api-key"

response = openai.Completion.create(
    engine="text-davinci-002",
    prompt="Explain cloud computing in simple terms:",
    max_tokens=100
)

print(response.choices[0].text)
```

## Looking Ahead

The Azure OpenAI Service announcement signals a significant shift in how enterprises will access large language models. Key trends to watch:

1. **Broader Access**: Expect expanded preview and eventually general availability
2. **More Models**: Additional model types and sizes
3. **Deeper Integration**: Tighter integration with other Azure services
4. **Industry Solutions**: Pre-built solutions for specific industries

## My Thoughts

This announcement is exciting for the enterprise AI space. The combination of OpenAI's powerful models with Azure's enterprise infrastructure addresses a real gap in the market. However, given the limited preview status, most organizations will need to wait before they can leverage these capabilities.

In the meantime, focus on:
- Understanding your AI use cases
- Building responsible AI governance frameworks
- Developing expertise with existing Azure AI services
- Preparing your data and infrastructure for future AI adoption

## Resources

- [Azure OpenAI Service Announcement](https://azure.microsoft.com/en-us/blog/microsoft-and-openai-extend-partnership/)
- [Apply for Azure OpenAI Access](https://aka.ms/oai/access)
- [Azure Cognitive Services](https://docs.microsoft.com/en-us/azure/cognitive-services/)
- [Responsible AI Principles](https://www.microsoft.com/en-us/ai/responsible-ai)

The journey toward enterprise AI is accelerating. While Azure OpenAI Service is just beginning its preview, it represents an important step in making powerful AI accessible to organizations that need enterprise-grade security and compliance.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
