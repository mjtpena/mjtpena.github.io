---
title: "Using Codex Models for Azure Development Automation"
author: Michael John Peña
draft: false
date: 2022-11-10
tags:
  - Azure
  - OpenAI
  - Codex
  - AI
  - Automation

---

I wrote "Using Codex Models for Azure Development Automation" to share practical, production-minded guidance on this topic.

## Understanding Codex

Codex models (code-davinci-002, code-cushman-001) are descendants of GPT-3 fine-tuned on public code repositories. They understand:

- Multiple programming languages
- API patterns and conventions
- Framework idioms
- Infrastructure as Code

## Setting Up for Azure Development

```python
import openai
import os

openai.api_type = "azure"
openai.api_base = os.getenv("AZURE_OPENAI_ENDPOINT")
openai.api_key = os.getenv("AZURE_OPENAI_KEY")
openai.api_version = "2022-12-01"

def generate_code(prompt: str, language: str = "python") -> str:
    """Generate code using Codex."""

    full_prompt = f"# Language: {language}\n{prompt}\n\n"

    response = openai.Completion.create(
        engine="code-davinci-002",
        prompt=full_prompt,
        max_tokens=2000,
        temperature=0,
        stop=["# End", "```"]
    )

    return response.choices[0].text.strip()
```

## Generating Azure Infrastructure Code

### Terraform Generation

```python
prompt = """# Create Terraform code for:
# - Azure Resource Group in East US
# - Azure Storage Account with blob container
# - Private endpoint for storage
# - Azure Key Vault for secrets
# - All resources tagged with environment=dev

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~>3.0"
    }
  }
}
"""

terraform_code = generate_code(prompt, "terraform")
print(terraform_code)
```

**Output:**
```hcl
provider "azurerm" {
  features {}
}

locals {
  tags = {
    environment = "dev"
  }
}

resource "azurerm_resource_group" "main" {
  name     = "rg-dev-eastus"
  location = "East US"
  tags     = local.tags
}

resource "azurerm_storage_account" "main" {
  name                     = "stdeveastus001"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }

  tags = local.tags
}

resource "azurerm_storage_container" "main" {
  name                  = "data"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

resource "azurerm_private_endpoint" "storage" {
  name                = "pe-storage-dev"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.private.id

  private_service_connection {
    name                           = "storage-connection"
    private_connection_resource_id = azurerm_storage_account.main.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  tags = local.tags
}

resource "azurerm_key_vault" "main" {
  name                = "kv-dev-eastus-001"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  purge_protection_enabled = true

  tags = local.tags
}
```

### Bicep Generation

```python
prompt = """# Create Bicep template for:
# - Azure Container Registry with admin enabled
# - Azure Container Apps Environment
# - Container App with auto-scaling
# Parameters for environment name and location

@description('Environment name')
param environmentName string

@description('Location for resources')
param location string = resourceGroup().location
"""

bicep_code = generate_code(prompt, "bicep")
```

## Generating Azure SDK Code

### Python SDK for Cosmos DB

```python
prompt = """# Python class for Azure Cosmos DB operations
# Requirements:
# - Async support using aiohttp
# - CRUD operations for a "products" container
# - Pagination support
# - Change feed processing
# - Bulk operations

from azure.cosmos.aio import CosmosClient
from azure.identity.aio import DefaultAzureCredential
import asyncio
from typing import AsyncIterator, List, Optional
"""

cosmos_code = generate_code(prompt, "python")
```

### C# SDK for Service Bus

```python
prompt = """// C# class for Azure Service Bus messaging
// Requirements:
// - Send messages to queue
// - Receive messages with sessions
// - Dead letter handling
// - Message scheduling
// - Batch operations

using Azure.Messaging.ServiceBus;
using Microsoft.Extensions.Logging;
"""

servicebus_code = generate_code(prompt, "csharp")
```

## Generating Azure Functions

```python
prompt = """# Azure Function in Python that:
# 1. Triggers on Blob Storage upload
# 2. Processes image using Azure Computer Vision
# 3. Stores results in Cosmos DB
# 4. Sends notification via Event Grid

import azure.functions as func
import logging
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from azure.cosmos import CosmosClient
from azure.eventgrid import EventGridPublisherClient
"""

function_code = generate_code(prompt, "python")
```

**Output:**
```python
import azure.functions as func
import logging
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from azure.cognitiveservices.vision.computervision.models import VisualFeatureTypes
from azure.cosmos import CosmosClient, PartitionKey
from azure.eventgrid import EventGridPublisherClient
from azure.core.credentials import AzureKeyCredential
from msrest.authentication import CognitiveServicesCredentials
import os
import json
from datetime import datetime

# Configuration
CV_ENDPOINT = os.environ["COMPUTER_VISION_ENDPOINT"]
CV_KEY = os.environ["COMPUTER_VISION_KEY"]
COSMOS_ENDPOINT = os.environ["COSMOS_ENDPOINT"]
COSMOS_KEY = os.environ["COSMOS_KEY"]
EVENTGRID_ENDPOINT = os.environ["EVENTGRID_ENDPOINT"]
EVENTGRID_KEY = os.environ["EVENTGRID_KEY"]

# Clients
cv_client = ComputerVisionClient(CV_ENDPOINT, CognitiveServicesCredentials(CV_KEY))
cosmos_client = CosmosClient(COSMOS_ENDPOINT, COSMOS_KEY)
database = cosmos_client.get_database_client("images")
container = database.get_container_client("analysis")
eg_client = EventGridPublisherClient(EVENTGRID_ENDPOINT, AzureKeyCredential(EVENTGRID_KEY))


def main(blob: func.InputStream):
    logging.info(f"Processing blob: {blob.name}, Size: {blob.length} bytes")

    try:
        # Analyze image with Computer Vision
        analysis = cv_client.analyze_image_in_stream(
            blob,
            visual_features=[
                VisualFeatureTypes.categories,
                VisualFeatureTypes.description,
                VisualFeatureTypes.tags,
                VisualFeatureTypes.objects
            ]
        )

        # Prepare result document
        result = {
            "id": blob.name.replace("/", "_"),
            "partitionKey": "image-analysis",
            "blobName": blob.name,
            "blobSize": blob.length,
            "processedAt": datetime.utcnow().isoformat(),
            "description": analysis.description.captions[0].text if analysis.description.captions else None,
            "tags": [tag.name for tag in analysis.tags],
            "categories": [cat.name for cat in analysis.categories],
            "objects": [{"name": obj.object_property, "confidence": obj.confidence}
                       for obj in analysis.objects]
        }

        # Store in Cosmos DB
        container.upsert_item(result)
        logging.info(f"Stored analysis result for {blob.name}")

        # Send Event Grid notification
        event = {
            "id": result["id"],
            "eventType": "ImageAnalysis.Completed",
            "subject": f"images/{blob.name}",
            "eventTime": datetime.utcnow().isoformat() + "Z",
            "data": {
                "blobName": blob.name,
                "tags": result["tags"][:5],  # Top 5 tags
                "description": result["description"]
            },
            "dataVersion": "1.0"
        }

        eg_client.send([event])
        logging.info(f"Sent Event Grid notification for {blob.name}")

    except Exception as e:
        logging.error(f"Error processing blob {blob.name}: {str(e)}")
        raise
```

## Building a Development Assistant

```python
class AzureCodeAssistant:
    """AI-powered assistant for Azure development."""

    def __init__(self, engine: str = "code-davinci-002"):
        self.engine = engine

    def explain_code(self, code: str, language: str) -> str:
        """Explain what code does."""
        prompt = f"""# Explain this {language} code:
```{language}
{code}
```

# Explanation:"""

        return self._generate(prompt, max_tokens=500, temperature=0.3)

    def find_bugs(self, code: str, language: str) -> str:
        """Find potential bugs in code."""
        prompt = f"""# Find bugs and issues in this {language} code:
```{language}
{code}
```

# Bugs and Issues:"""

        return self._generate(prompt, max_tokens=500, temperature=0.2)

    def optimize(self, code: str, language: str) -> str:
        """Suggest optimizations."""
        prompt = f"""# Optimize this {language} code for performance and readability:
```{language}
{code}
```

# Optimized code:"""

        return self._generate(prompt, max_tokens=1500, temperature=0)

    def convert_language(self, code: str, from_lang: str, to_lang: str) -> str:
        """Convert code between languages."""
        prompt = f"""# Convert this {from_lang} code to {to_lang}:
```{from_lang}
{code}
```

# {to_lang} code:
```{to_lang}"""

        return self._generate(prompt, max_tokens=1500, temperature=0)

    def generate_tests(self, code: str, language: str, framework: str = "pytest") -> str:
        """Generate unit tests for code."""
        prompt = f"""# Generate {framework} tests for this {language} code:
```{language}
{code}
```

# Tests:
```{language}"""

        return self._generate(prompt, max_tokens=1500, temperature=0.2)

    def _generate(self, prompt: str, max_tokens: int, temperature: float) -> str:
        response = openai.Completion.create(
            engine=self.engine,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            stop=["```\n\n", "# End"]
        )
        return response.choices[0].text.strip()


# Usage example
assistant = AzureCodeAssistant()

# Generate tests
code = """
def calculate_cosmos_ru(item_size_kb: float, reads_per_sec: int, writes_per_sec: int) -> int:
    read_rus = reads_per_sec * (item_size_kb / 4) * 1
    write_rus = writes_per_sec * (item_size_kb / 4) * 5
    return int(read_rus + write_rus)
"""

tests = assistant.generate_tests(code, "python", "pytest")
print(tests)
```

## Best Practices for Codex

1. **Be specific**: Include language, framework, and requirements
2. **Provide context**: Add relevant imports and class signatures
3. **Use temperature 0**: For deterministic code generation
4. **Include examples**: Show expected input/output
5. **Review carefully**: Always review and test generated code

## Conclusion

Codex models are powerful tools for accelerating Azure development. From infrastructure as code to SDK implementations, they can generate production-quality code with proper prompting. Integrate them into your development workflow to boost productivity while maintaining oversight.

## Resources

- [Azure OpenAI Codex](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/concepts/models#codex-models)
- [GitHub Copilot](https://github.com/features/copilot)
- [Prompt Engineering for Code](https://platform.openai.com/docs/guides/code)

