---
title: "Microsoft Ignite 2025 Preview: What to Expect for Azure AI"
author: Michael John Peña
draft: false
date: 2025-11-12
tags:
  - Ignite 2025
  - Azure AI
  - Microsoft
  - Announcements
  - Preview

---

I wrote "Microsoft Ignite 2025 Preview: What to Expect for Azure AI" to share practical, production-minded guidance on this topic.

## Expected Azure OpenAI Announcements

Based on recent previews and roadmap signals, we anticipate significant updates to Azure OpenAI Service:

```python
# Anticipated new capabilities based on preview access
from azure.ai.openai import AzureOpenAI

client = AzureOpenAI(
    api_version="2025-11-01",  # New API version expected
    azure_endpoint="https://your-resource.openai.azure.com/"
)

# Expected: Enhanced function calling with parallel execution
response = client.chat.completions.create(
    model="gpt-4-turbo",  # Updated model expected
    messages=[{"role": "user", "content": "Analyze sales data and create report"}],
    tools=[
        {"type": "function", "function": {"name": "query_database"}},
        {"type": "function", "function": {"name": "generate_chart"}},
        {"type": "function", "function": {"name": "send_email"}}
    ],
    parallel_tool_calls=True,  # New capability
    tool_choice="auto"
)

# Expected: Improved structured outputs
response = client.chat.completions.create(
    model="gpt-4-turbo",
    messages=[{"role": "user", "content": "Extract invoice details"}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "invoice",
            "schema": {
                "type": "object",
                "properties": {
                    "vendor": {"type": "string"},
                    "amount": {"type": "number"},
                    "date": {"type": "string", "format": "date"}
                },
                "required": ["vendor", "amount", "date"]
            }
        }
    }
)
```

## Microsoft Fabric Updates

Fabric continues rapid development with expected enhancements:

- **Real-Time Intelligence GA**: Full general availability of real-time analytics capabilities
- **Copilot for Fabric**: Enhanced AI assistance for data engineering and analysis
- **Cross-Cloud Shortcuts**: Improved integration with AWS S3 and Google Cloud Storage
- **Governance Enhancements**: Advanced data lineage and classification features

## Copilot Stack Evolution

The Copilot platform is expected to receive significant updates:

```yaml
# Expected Copilot extensibility improvements
copilot_extension:
  name: "Enterprise Knowledge Assistant"
  capabilities:
    - declarative_agents  # New capability
    - custom_actions
    - knowledge_grounding

  declarative_config:
    personality: "professional, helpful"
    knowledge_sources:
      - sharepoint_sites
      - custom_api

  actions:
    - name: create_support_ticket
      api: "/api/tickets"
      method: POST
      authentication: oauth2
```

## Sessions to Watch

Key technical sessions typically include:
- Azure AI Platform Roadmap
- Building Enterprise AI with Azure OpenAI
- Microsoft Fabric Deep Dive
- Copilot Extensibility Workshop

Ignite 2025 promises to be a pivotal event for enterprise AI adoption. The convergence of Azure AI, Fabric, and Copilot technologies creates opportunities for organizations to accelerate their AI initiatives.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
