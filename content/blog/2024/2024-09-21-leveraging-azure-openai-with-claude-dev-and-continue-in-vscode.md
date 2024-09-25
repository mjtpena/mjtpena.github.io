---
title: Leveraging Azure OpenAI with Claude Dev and Continue in VSCode
date: 2024-09-21T14:00:00.000Z
tags:
  - Claude
  - Tools
  - LLM
  - Copilot
  - VSCode
author: Michael John Peña
---

# Leveraging Azure OpenAI with Claude Dev and Continue in VSCode

As a developer constantly evaluating new tools to enhance productivity, I've recently implemented a setup that combines Azure OpenAI with two VSCode extensions: Continue and Claude Dev. This configuration has significantly improved my coding workflow, and I'd like to share the setup process and my experiences.

## The Search for an Efficient Code Assistant

GitHub Copilot has been a popular choice for code assistance, but alternatives have emerged. Local hosting options like Ollama offer benefits but can be resource-intensive. Anthropic's Claude API is powerful but comes with additional licensing costs.

I found a middle ground by utilizing Azure OpenAI, which is available through my Visual Studio Enterprise subscription. This approach balances functionality and cost-effectiveness.

## Configuring Continue: An Alternative to Copilot

To set up Continue, I followed these steps:

1. Uninstalled GitHub Copilot and installed the Continue plugin.

2. Navigated to the "Best experience" tab in the setup.

[Screenshot placeholder: Continue plugin setup page]

3. Selected "Click here" to add a chat model from OpenAI.

4. Chose the Azure OpenAI option and entered my API key.

[Screenshot placeholder: Azure OpenAI connection in Continue]

The crucial part was configuring the `continue.json` file in my base directory:

```json
{
  "apiKey": "XXXXXXX",
  "engine": "gpt-4o",
  "apiBase": "https://azoai-mj-realtime-aue01.openai.azure.com/",
  "apiVersion": "2023-03-15-preview",
  "apiType": "azure",
  "model": "gpt-4o",
  "contextLength": 128000,
  "title": "GPT-4o",
  "systemMessage": "You are an expert software developer. You give helpful and concise responses.",
  "provider": "azure"
}
```

Note: Replace `apiKey`, `engine`, `apiBase`, and `apiVersion` with your Azure OpenAI details.

## Implementing Claude Dev: Advanced AI Assistance

Claude Dev offers more comprehensive functionality than typical code completion tools. It can read files, generate new ones, and execute multiple LLM calls for complex tasks.

Setting up Claude Dev required an additional step due to its lack of native Azure OpenAI support:

1. Installed the Claude Dev extension in VSCode.

2. Set up a Docker container as a proxy:

```bash
docker run -d -p 8080:8080 --name=azure-openai-proxy \
  --env AZURE_OPENAI_ENDPOINT=https://azoai-mj-realtime-aue01.openai.azure.com/ \
  --env AZURE_OPENAI_API_VER=2023-03-15-preview \
  --env AZURE_OPENAI_MODEL_MAPPER=gpt-4o=gpt-4o \
  stulzq/azure-openai-proxy:latest
```

3. In Claude Dev's extension setup, selected "OpenAI Compatible" as the API provider.

4. Entered the local proxy address (http://localhost:8080/v1), Azure OpenAI API key, and model ID.

[Screenshot placeholder: Claude Dev configuration in VSCode]

## Impact on Development Workflow

This setup has noticeably improved my coding efficiency. Continue handles quick autocompletes and code chats, while Claude Dev manages more complex, multi-step tasks that previously required significant time investment.

By utilizing resources available through my Visual Studio Enterprise subscription, I've created a powerful yet cost-effective development environment.

For developers looking to optimize their coding setup, this configuration offers a compelling balance of functionality and resource utilization. It's worth considering if you're aiming to streamline your development process.
