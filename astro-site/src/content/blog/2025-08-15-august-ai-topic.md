---
title: "Semantic Kernel Memory: Building Persistent AI Context"
author: Michael John Peña
draft: false
date: 2025-08-15
tags:
  - Semantic Kernel
  - Memory
  - Vector Database
  - AI
  - .NET

---

I wrote "Semantic Kernel Memory: Building Persistent AI Context" to share practical, production-minded guidance on this topic.

## Configuring Memory with Azure AI Search

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Memory;
using Microsoft.SemanticKernel.Connectors.AzureAISearch;
using Microsoft.SemanticKernel.Connectors.AzureOpenAI;

// Create memory store with Azure AI Search
var memoryStore = new AzureAISearchMemoryStore(
    searchEndpoint: Environment.GetEnvironmentVariable("SEARCH_ENDPOINT")!,
    apiKey: Environment.GetEnvironmentVariable("SEARCH_KEY")!
);

// Create embedding generator
var embeddingGenerator = new AzureOpenAITextEmbeddingGenerationService(
    deploymentName: "text-embedding-ada-002",
    endpoint: Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")!,
    apiKey: Environment.GetEnvironmentVariable("AZURE_OPENAI_KEY")!
);

// Build semantic memory
var memory = new MemoryBuilder()
    .WithMemoryStore(memoryStore)
    .WithTextEmbeddingGeneration(embeddingGenerator)
    .Build();
```

## Storing and Retrieving Memories

```csharp
// Store information in memory
await memory.SaveInformationAsync(
    collection: "user-preferences",
    id: "user-123-prefs",
    text: "User prefers detailed technical explanations with code examples. Works primarily in Python and TypeScript.",
    description: "User communication preferences"
);

// Store conversation context
await memory.SaveInformationAsync(
    collection: "conversation-history",
    id: Guid.NewGuid().ToString(),
    text: "User asked about implementing RAG with Azure AI Search",
    description: "Previous conversation topic"
);

// Retrieve relevant memories
var memories = memory.SearchAsync(
    collection: "user-preferences",
    query: "How should I explain this concept?",
    limit: 3,
    minRelevanceScore: 0.7
);

await foreach (var mem in memories)
{
    Console.WriteLine($"Relevance: {mem.Relevance:P2}");
    Console.WriteLine($"Memory: {mem.Metadata.Text}");
}
```

## Integrating Memory with Chat

Use retrieved memories to enrich the system prompt or provide context for the AI. This enables personalized responses without requiring the user to repeat preferences or context from previous sessions.

Memory transforms stateless AI interactions into continuous, contextual conversations.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
