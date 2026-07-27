---
title: "GPT-3 Models on Azure: Understanding text-davinci-002 and Codex"
author: Michael John Peña
draft: false
date: 2022-11-09
tags:
  - Azure
  - OpenAI
  - GPT-3
  - AI
  - Machine Learning

---

I wrote "GPT-3 Models on Azure: Understanding text-davinci-002 and Codex" to share practical, production-minded guidance on this topic.

## Understanding the GPT-3 Model Family

Azure OpenAI Service offers several GPT-3 models, each optimized for different use cases and cost profiles:

### The Davinci Family (Most Capable)

**text-davinci-002** is the most capable GPT-3 model, best for:
- Complex reasoning tasks
- Creative content generation
- Code generation and explanation
- Nuanced text understanding

### Curie, Babbage, and Ada

- **text-curie-001**: Good balance of capability and cost, suitable for translation and classification
- **text-babbage-001**: Faster, good for straightforward tasks
- **text-ada-001**: Fastest and lowest cost, best for simple parsing and classification

## Model Comparison in Practice

```python
import openai

def compare_models(prompt: str):
    """Compare outputs across GPT-3 model generations."""

    models = ["text-davinci-002", "text-curie-001", "text-ada-001"]
    results = {}

    for model in models:
        response = openai.Completion.create(
            engine=model,
            prompt=prompt,
            max_tokens=200,
            temperature=0.7
        )
        results[model] = response.choices[0].text.strip()

    return results

# Test prompt
prompt = """Explain the difference between Azure Blob Storage tiers
(Hot, Cool, and Archive) and when to use each one. Be concise."""

results = compare_models(prompt)
for model, response in results.items():
    print(f"\n{model}:\n{response}")
```

## Practical Capabilities with text-davinci-002

### Code Generation

```python
# text-davinci-002 handles complex code requests well

prompt = """Write a C# class that implements the repository pattern
for Azure Cosmos DB with the following requirements:
1. Generic type support
2. Async operations
3. Partition key handling
4. Error handling with custom exceptions
5. Support for both point reads and queries"""

response = openai.Completion.create(
    engine="text-davinci-002",
    prompt=prompt,
    max_tokens=1500,
    temperature=0
)

print(response.choices[0].text)
```

**Output:**
```csharp
using Azure.Cosmos;
using System.Linq.Expressions;

public class CosmosDbRepository<T> : IRepository<T> where T : class, IEntity
{
    private readonly Container _container;
    private readonly ILogger<CosmosDbRepository<T>> _logger;

    public CosmosDbRepository(CosmosClient client, string databaseName,
        string containerName, ILogger<CosmosDbRepository<T>> logger)
    {
        _container = client.GetContainer(databaseName, containerName);
        _logger = logger;
    }

    public async Task<T?> GetByIdAsync(string id, string partitionKey,
        CancellationToken ct = default)
    {
        try
        {
            var response = await _container.ReadItemAsync<T>(
                id, new PartitionKey(partitionKey), cancellationToken: ct);
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
        catch (CosmosException ex)
        {
            _logger.LogError(ex, "Error reading item {Id}", id);
            throw new RepositoryException($"Failed to read item {id}", ex);
        }
    }

    public async Task<IEnumerable<T>> QueryAsync(
        Expression<Func<T, bool>> predicate,
        string? partitionKey = null,
        CancellationToken ct = default)
    {
        var queryable = _container.GetItemLinqQueryable<T>(
            requestOptions: partitionKey != null
                ? new QueryRequestOptions { PartitionKey = new PartitionKey(partitionKey) }
                : null);

        var query = queryable.Where(predicate).ToFeedIterator();
        var results = new List<T>();

        while (query.HasMoreResults)
        {
            var response = await query.ReadNextAsync(ct);
            results.AddRange(response);
        }

        return results;
    }

    public async Task<T> CreateAsync(T entity, CancellationToken ct = default)
    {
        try
        {
            var response = await _container.CreateItemAsync(
                entity, new PartitionKey(entity.PartitionKey), cancellationToken: ct);
            return response.Resource;
        }
        catch (CosmosException ex)
        {
            _logger.LogError(ex, "Error creating item");
            throw new RepositoryException("Failed to create item", ex);
        }
    }

    public async Task<T> UpdateAsync(T entity, CancellationToken ct = default)
    {
        try
        {
            var response = await _container.ReplaceItemAsync(
                entity, entity.Id, new PartitionKey(entity.PartitionKey),
                cancellationToken: ct);
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            throw new EntityNotFoundException($"Entity {entity.Id} not found");
        }
        catch (CosmosException ex)
        {
            _logger.LogError(ex, "Error updating item {Id}", entity.Id);
            throw new RepositoryException($"Failed to update item {entity.Id}", ex);
        }
    }

    public async Task DeleteAsync(string id, string partitionKey,
        CancellationToken ct = default)
    {
        try
        {
            await _container.DeleteItemAsync<T>(
                id, new PartitionKey(partitionKey), cancellationToken: ct);
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            // Already deleted, idempotent operation
        }
        catch (CosmosException ex)
        {
            _logger.LogError(ex, "Error deleting item {Id}", id);
            throw new RepositoryException($"Failed to delete item {id}", ex);
        }
    }
}

public interface IEntity
{
    string Id { get; }
    string PartitionKey { get; }
}

public class RepositoryException : Exception
{
    public RepositoryException(string message, Exception? inner = null)
        : base(message, inner) { }
}

public class EntityNotFoundException : Exception
{
    public EntityNotFoundException(string message) : base(message) { }
}
```

### Architecture Decision Support

```python
prompt = """I have an Azure architecture decision to make:

Scenario: E-commerce platform with 10,000 daily active users,
peak traffic of 1,000 concurrent users during sales events.
Current: Single Azure SQL database with 500GB data.
Problem: Slow queries during peak times, especially for product search.

Options:
A) Scale up Azure SQL to Business Critical tier
B) Add Azure Cognitive Search for product search
C) Migrate to Cosmos DB
D) Implement Redis Cache

Analyze each option with pros/cons and give a recommendation."""

response = openai.Completion.create(
    engine="text-davinci-002",
    prompt=prompt,
    max_tokens=1000,
    temperature=0.3
)
```

### Structured Output Generation

```python
# The model follows specific formatting instructions

prompt = """Generate a comparison table for Azure storage services.

Format requirements:
- Markdown table
- Columns: Service, Best For, Max Size, Pricing Model, Latency
- Include: Blob Storage, Files, Queue, Table, Disk
- Keep descriptions brief (under 20 words each)"""

response = openai.Completion.create(
    engine="text-davinci-002",
    prompt=prompt,
    max_tokens=500,
    temperature=0
)
```

## Codex Models for Code Generation

The Codex family is specifically optimized for code:

```python
# Using Codex for code generation
response = openai.Completion.create(
    engine="code-davinci-002",
    prompt="""# Python function that:
# 1. Connects to Azure Blob Storage
# 2. Lists all containers
# 3. Downloads all blobs from a specific container
# 4. Uses async operations

import asyncio
from azure.storage.blob.aio import BlobServiceClient
""",
    max_tokens=800,
    temperature=0,
    stop=["# End"]
)
```

## Parameter Tuning for Different Use Cases

### Creative Writing

```python
# Higher temperature for variety
response = openai.Completion.create(
    engine="text-davinci-002",
    prompt="Write a creative tagline for a cloud migration service:",
    max_tokens=50,
    temperature=0.9,
    top_p=0.95,
    presence_penalty=0.6
)
```

### Factual Responses

```python
# Lower temperature for accuracy
response = openai.Completion.create(
    engine="text-davinci-002",
    prompt="What are the SLA guarantees for Azure Cosmos DB?",
    max_tokens=200,
    temperature=0.1,
    top_p=1,
    presence_penalty=0
)
```

### Code Generation

```python
# Temperature 0 for deterministic code
response = openai.Completion.create(
    engine="code-davinci-002",
    prompt="Write a Python function to validate an Azure connection string:",
    max_tokens=300,
    temperature=0,
    stop=["\n\n", "```"]
)
```

## Building a Prompt Library

```python
class AzurePromptLibrary:
    """Reusable prompts optimized for GPT-3."""

    ARCHITECTURE_REVIEW = """Review this Azure architecture for:
1. Cost optimization opportunities
2. Security vulnerabilities
3. Scalability concerns
4. Best practice violations

Architecture:
{architecture}

Provide specific, actionable recommendations."""

    CODE_EXPLANATION = """Explain this code clearly and concisely:
```{language}
{code}
```
Focus on:
- What it does
- Key patterns used
- Potential issues
- Suggested improvements"""

    SQL_OPTIMIZATION = """Analyze this SQL query for performance:
```sql
{query}
```
Consider:
- Index usage
- Join efficiency
- Where clause optimization
- Execution plan hints

Provide the optimized query with explanations."""

    ERROR_DIAGNOSIS = """Diagnose this error:
Error: {error}
Context: {context}

Provide:
1. Root cause
2. Solution steps
3. Prevention measures"""

# Usage
def get_architecture_review(architecture_description: str) -> str:
    prompt = AzurePromptLibrary.ARCHITECTURE_REVIEW.format(
        architecture=architecture_description
    )

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=1000,
        temperature=0.3
    )

    return response.choices[0].text.strip()
```

## Error Handling Best Practices

```python
import openai
from tenacity import retry, stop_after_attempt, wait_exponential

class AzureOpenAIClient:
    def __init__(self, endpoint: str, api_key: str):
        openai.api_type = "azure"
        openai.api_base = endpoint
        openai.api_key = api_key
        openai.api_version = "2022-06-01-preview"

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=60)
    )
    def complete(self, prompt: str, **kwargs) -> str:
        try:
            response = openai.Completion.create(
                engine="text-davinci-002",
                prompt=prompt,
                **kwargs
            )
            return response.choices[0].text.strip()

        except openai.error.RateLimitError:
            # Log and retry
            raise

        except openai.error.InvalidRequestError as e:
            if "content_filter" in str(e):
                return "[Content filtered]"
            raise

        except openai.error.APIError as e:
            # Log error
            raise
```

## Cost Tracking

```python
import tiktoken

class TokenTracker:
    def __init__(self, model: str = "text-davinci-002"):
        self.encoding = tiktoken.encoding_for_model(model)
        self.total_tokens = 0
        self.cost_per_1k = 0.02  # davinci pricing

    def count_tokens(self, text: str) -> int:
        return len(self.encoding.encode(text))

    def track_request(self, prompt: str, completion: str):
        prompt_tokens = self.count_tokens(prompt)
        completion_tokens = self.count_tokens(completion)
        total = prompt_tokens + completion_tokens
        self.total_tokens += total
        return {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total,
            "estimated_cost": (total / 1000) * self.cost_per_1k
        }

    def get_total_cost(self) -> float:
        return (self.total_tokens / 1000) * self.cost_per_1k
```

## Choosing the Right Model

| Use Case | Recommended Model | Temperature |
|----------|------------------|-------------|
| Complex reasoning | text-davinci-002 | 0.3-0.7 |
| Code generation | code-davinci-002 | 0 |
| Classification | text-curie-001 | 0 |
| Simple parsing | text-ada-001 | 0 |
| Creative content | text-davinci-002 | 0.8-1.0 |
| Translation | text-curie-001 | 0.3 |

## What's Next for Azure OpenAI

Microsoft and OpenAI continue to improve the models. We can expect:
- New model versions with improved capabilities
- Better instruction-following models
- Expanded availability and increased quotas
- More integration with Azure services

The pace of innovation in this space is remarkable. Stay tuned for updates.

## Conclusion

GPT-3 models on Azure provide powerful capabilities for text and code generation. Understanding the differences between models helps you choose the right tool for each task while optimizing costs. When building applications with Azure OpenAI, invest time in prompt engineering and implement proper error handling to get the best results.

## Resources

- [Azure OpenAI Models](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/concepts/models)
- [Best Practices for Prompt Engineering](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/concepts/prompt-engineering)
- [OpenAI Tokenizer](https://platform.openai.com/tokenizer)

