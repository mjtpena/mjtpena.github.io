---
title: "Azure OpenAI Service Updates at Microsoft Ignite 2022"
author: Michael John Peña
draft: false
date: 2022-11-08
tags:
  - Azure
  - OpenAI
  - AI
  - GPT-3
  - Microsoft Ignite

---

I wrote "Azure OpenAI Service Updates at Microsoft Ignite 2022" to share practical, production-minded guidance on this topic.

## What is Azure OpenAI Service?

Azure OpenAI Service provides REST API access to OpenAI's powerful language models including GPT-3, Codex, and DALL-E. The key differentiator from using OpenAI directly:

- Enterprise security and compliance
- Private networking support
- Regional data residency
- Azure AD integration
- SLA guarantees

## Ignite 2022 Announcements

Microsoft announced expanded access and new capabilities for Azure OpenAI Service at Ignite:

### Broader Availability

Azure OpenAI Service is moving toward broader preview access, with more customers being able to apply and get approved. The application process is becoming more streamlined for legitimate enterprise use cases.

### GPT-3 Model Updates

The latest GPT-3 models show significant improvements:

```python
import openai

openai.api_type = "azure"
openai.api_base = "https://your-resource.openai.azure.com/"
openai.api_version = "2022-06-01-preview"
openai.api_key = os.getenv("AZURE_OPENAI_KEY")

response = openai.Completion.create(
    engine="text-davinci-002",  # GPT-3 Davinci
    prompt="Write a Python function that connects to Azure Cosmos DB and retrieves documents by partition key:",
    max_tokens=500,
    temperature=0.7
)

print(response.choices[0].text)
```

**Output:**
```python
from azure.cosmos import CosmosClient, PartitionKey

def get_documents_by_partition(
    endpoint: str,
    key: str,
    database_name: str,
    container_name: str,
    partition_key_value: str
) -> list:
    """
    Retrieves all documents from a Cosmos DB container
    that match the specified partition key value.
    """
    client = CosmosClient(endpoint, credential=key)
    database = client.get_database_client(database_name)
    container = database.get_container_client(container_name)

    query = "SELECT * FROM c WHERE c.partitionKey = @pk"
    parameters = [{"name": "@pk", "value": partition_key_value}]

    items = list(container.query_items(
        query=query,
        parameters=parameters,
        enable_cross_partition_query=False
    ))

    return items
```

### Codex Models

Codex models continue to improve for code understanding and generation:

```python
# Using Codex for code generation
response = openai.Completion.create(
    engine="code-davinci-002",
    prompt="""
# Azure Function that:
# 1. Triggers on HTTP request
# 2. Reads data from Azure Table Storage
# 3. Returns filtered results as JSON
# Language: Python

import azure.functions as func
""",
    max_tokens=800,
    temperature=0,
    stop=["# End"]
)
```

### DALL-E 2

Image generation capabilities are now in preview on Azure:

```python
response = openai.Image.create(
    prompt="A modern cloud architecture diagram with Azure services, isometric style, blue and purple colors",
    n=1,
    size="1024x1024"
)

image_url = response['data'][0]['url']
```

## Enterprise Features

### Private Endpoints

```bicep
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2021-05-01' = {
  name: 'pe-openai'
  location: location
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'openai-connection'
        properties: {
          privateLinkServiceId: openAIAccount.id
          groupIds: [
            'account'
          ]
        }
      }
    ]
  }
}
```

### Azure AD Authentication

```csharp
using Azure.AI.OpenAI;
using Azure.Identity;

var endpoint = new Uri("https://your-resource.openai.azure.com/");
var credential = new DefaultAzureCredential();

var client = new OpenAIClient(endpoint, credential);

var completionsOptions = new CompletionsOptions
{
    Prompts = { "Explain Azure Private Link in simple terms:" },
    MaxTokens = 200,
    Temperature = 0.7f
};

var response = await client.GetCompletionsAsync("text-davinci-002", completionsOptions);
```

### Content Filtering

Azure OpenAI includes built-in content filtering:

```python
try:
    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=user_input,
        max_tokens=100
    )
except openai.error.InvalidRequestError as e:
    if "content_filter" in str(e):
        # Content was filtered
        log_filtered_request(user_input)
        return "I cannot process that request."
    raise
```

## Practical Use Cases

### Document Summarization

```python
def summarize_document(document_text: str, max_length: int = 200) -> str:
    """Summarize a long document using Azure OpenAI."""

    prompt = f"""Summarize the following document in {max_length} words or less.
Focus on key points and actionable insights.

Document:
{document_text}

Summary:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=max_length * 2,  # Tokens != words
        temperature=0.3,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0
    )

    return response.choices[0].text.strip()
```

### SQL Query Generation

```python
def generate_sql_query(
    schema_description: str,
    natural_language_query: str
) -> str:
    """Convert natural language to SQL using Azure OpenAI."""

    prompt = f"""Given the following database schema:
{schema_description}

Write a SQL query for: {natural_language_query}

SQL Query:"""

    response = openai.Completion.create(
        engine="code-davinci-002",
        prompt=prompt,
        max_tokens=500,
        temperature=0,
        stop=["```", "\n\n"]
    )

    return response.choices[0].text.strip()

# Example usage
schema = """
Tables:
- customers (customer_id, name, email, created_at)
- orders (order_id, customer_id, total, status, order_date)
- order_items (item_id, order_id, product_id, quantity, price)
- products (product_id, name, category, price)
"""

query = generate_sql_query(
    schema,
    "Find the top 10 customers by total order value in the last 30 days"
)
print(query)
```

### Code Review Assistant

```python
def review_code(code: str, language: str) -> dict:
    """Get code review suggestions using Azure OpenAI."""

    prompt = f"""Review the following {language} code. Identify:
1. Potential bugs
2. Security issues
3. Performance improvements
4. Code style suggestions

Code:
```{language}
{code}
```

Review:"""

    response = openai.Completion.create(
        engine="code-davinci-002",
        prompt=prompt,
        max_tokens=1000,
        temperature=0.2
    )

    return {
        "review": response.choices[0].text.strip(),
        "tokens_used": response.usage.total_tokens
    }
```

## Cost Optimization

### Token Management

```python
import tiktoken

def count_tokens(text: str, model: str = "text-davinci-002") -> int:
    """Count tokens before making API calls."""
    encoding = tiktoken.encoding_for_model(model)
    return len(encoding.encode(text))

def truncate_to_token_limit(text: str, max_tokens: int, model: str) -> str:
    """Truncate text to fit within token limits."""
    encoding = tiktoken.encoding_for_model(model)
    tokens = encoding.encode(text)

    if len(tokens) <= max_tokens:
        return text

    return encoding.decode(tokens[:max_tokens])
```

### Caching Responses

```python
import hashlib
from azure.cosmos import CosmosClient

class OpenAICache:
    def __init__(self, cosmos_client: CosmosClient, database: str, container: str):
        self.container = cosmos_client.get_database_client(database).get_container_client(container)

    def get_cache_key(self, prompt: str, params: dict) -> str:
        content = f"{prompt}:{sorted(params.items())}"
        return hashlib.sha256(content.encode()).hexdigest()

    def get_cached_response(self, prompt: str, params: dict) -> str | None:
        key = self.get_cache_key(prompt, params)
        try:
            item = self.container.read_item(item=key, partition_key=key)
            return item['response']
        except:
            return None

    def cache_response(self, prompt: str, params: dict, response: str):
        key = self.get_cache_key(prompt, params)
        self.container.upsert_item({
            'id': key,
            'partitionKey': key,
            'prompt': prompt,
            'response': response,
            'created_at': datetime.utcnow().isoformat()
        })
```

## What's Coming

Based on Ignite announcements, we can expect:

1. **New model updates** - Improved GPT-3 variants with better performance
2. **Fine-tuning** - Custom models trained on your data
3. **More regions** - Expanded availability globally
4. **Deeper Azure integration** - Native connections to Azure services
5. **Conversational AI capabilities** - OpenAI is working on chat-optimized models

## Conclusion

Azure OpenAI Service is maturing rapidly. The combination of OpenAI's powerful models with Azure's enterprise features makes it an attractive option for organizations wanting to leverage AI capabilities while maintaining security and compliance requirements. The updates announced at Ignite 2022 show Microsoft's commitment to making these capabilities more accessible.

## Resources

- [Azure OpenAI Service Documentation](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/)
- [Azure OpenAI Studio](https://oai.azure.com/)
- [Pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)
- [Responsible AI Guidelines](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/concepts/responsible-ai)

