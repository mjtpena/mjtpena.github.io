---
title: "Semantic Kernel Memory: Building AI with Long-Term Context"
author: Michael John Peña
draft: false
date: 2023-02-19
tags:
  - Semantic Kernel
  - Azure
  - OpenAI
  - Memory
  - RAG
---

## Memory Basics

```python
import semantic_kernel as sk
from semantic_kernel.connectors.ai.open_ai import AzureTextEmbedding
from semantic_kernel.memory.volatile_memory_store import VolatileMemoryStore

# Create kernel with memory
kernel = sk.Kernel()

# Add embedding service
kernel.add_text_embedding_generation_service(
    "embedding",
    AzureTextEmbedding(
        deployment_name="text-embedding-ada-002",
        endpoint="https://your-resource.openai.azure.com/",
        api_key="your-api-key"
    )
)

# Register memory store
kernel.register_memory_store(memory_store=VolatileMemoryStore())
```

## Saving Information

```python
async def populate_memory(kernel: sk.Kernel):
    """Add information to semantic memory."""

    # Save individual facts
    await kernel.memory.save_information_async(
        collection="company_info",
        text="Our company was founded in 2020 and focuses on cloud solutions",
        id="about_company",
        description="Company background"
    )

    await kernel.memory.save_information_async(
        collection="company_info",
        text="We have 150 employees across 3 offices in Seattle, London, and Sydney",
        id="company_size",
        description="Employee information"
    )

    # Save reference information
    await kernel.memory.save_reference_async(
        collection="external_docs",
        text="Azure Functions pricing starts at $0.20 per million executions",
        external_id="azure_functions_pricing",
        external_source_name="Azure Documentation",
        description="Pricing information"
    )

    print("Memory populated")
```

## Searching Memory

```python
async def search_memory(
    kernel: sk.Kernel,
    query: str,
    collection: str = "company_info",
    limit: int = 5,
    min_relevance: float = 0.7
):
    """Search semantic memory."""

    results = await kernel.memory.search_async(
        collection=collection,
        query=query,
        limit=limit,
        min_relevance_score=min_relevance
    )

    for result in results:
        print(f"[{result.relevance:.3f}] {result.text[:100]}...")
        print(f"  ID: {result.id}")

    return results

# Usage
results = await search_memory(kernel, "How many employees do we have?")
```

## Multiple Collections

```python
class OrganizedMemory:
    """Organize memory into logical collections."""

    COLLECTIONS = {
        "policies": "Company policies and procedures",
        "products": "Product information and documentation",
        "customers": "Customer information and history",
        "technical": "Technical documentation and guides"
    }

    def __init__(self, kernel: sk.Kernel):
        self.kernel = kernel

    async def save(
        self,
        collection: str,
        text: str,
        item_id: str,
        metadata: dict = None
    ):
        """Save to a specific collection."""
        if collection not in self.COLLECTIONS:
            raise ValueError(f"Unknown collection: {collection}")

        description = metadata.get("description", "") if metadata else ""

        await self.kernel.memory.save_information_async(
            collection=collection,
            text=text,
            id=item_id,
            description=description
        )

    async def search_all(
        self,
        query: str,
        limit_per_collection: int = 3
    ) -> dict:
        """Search across all collections."""
        all_results = {}

        for collection in self.COLLECTIONS:
            results = await self.kernel.memory.search_async(
                collection=collection,
                query=query,
                limit=limit_per_collection,
                min_relevance_score=0.7
            )
            all_results[collection] = list(results)

        return all_results

    async def search_specific(
        self,
        query: str,
        collections: list,
        limit: int = 5
    ) -> list:
        """Search specific collections."""
        all_results = []

        for collection in collections:
            if collection in self.COLLECTIONS:
                results = await self.kernel.memory.search_async(
                    collection=collection,
                    query=query,
                    limit=limit,
                    min_relevance_score=0.7
                )
                all_results.extend(results)

        # Sort by relevance
        all_results.sort(key=lambda x: x.relevance, reverse=True)
        return all_results[:limit]
```

## Persistent Memory Stores

```python
# Azure Cognitive Search memory store
from semantic_kernel.connectors.memory.azure_cognitive_search import AzureCognitiveSearchMemoryStore

azure_search_store = AzureCognitiveSearchMemoryStore(
    vector_size=1536,
    search_endpoint="https://your-search.search.windows.net",
    admin_key="your-admin-key"
)

kernel.register_memory_store(memory_store=azure_search_store)

# Chroma memory store
from semantic_kernel.connectors.memory.chroma import ChromaMemoryStore

chroma_store = ChromaMemoryStore(persist_directory="./chroma_db")
kernel.register_memory_store(memory_store=chroma_store)

# Pinecone memory store
from semantic_kernel.connectors.memory.pinecone import PineconeMemoryStore

pinecone_store = PineconeMemoryStore(
    api_key="your-pinecone-key",
    environment="us-west1-gcp"
)
kernel.register_memory_store(memory_store=pinecone_store)
```

## Memory with Chat

```python
class MemoryAugmentedChat:
    """Chat with memory retrieval."""

    def __init__(self, kernel: sk.Kernel):
        self.kernel = kernel
        self._create_chat_function()

    def _create_chat_function(self):
        """Create the chat function with memory context."""
        self.chat_function = self.kernel.create_semantic_function(
            prompt_template="""
You are a helpful assistant with access to company information.

Relevant context from memory:
{{$memory_context}}

User question: {{$question}}

Answer based on the context provided. If the context doesn't contain
relevant information, say so and provide general guidance.

Answer:""",
            function_name="memory_chat",
            skill_name="Chat",
            max_tokens=500,
            temperature=0.7
        )

    async def chat(
        self,
        question: str,
        collections: list = None
    ) -> str:
        """Chat with memory-augmented responses."""
        collections = collections or ["company_info"]

        # Retrieve relevant memory
        memory_results = []
        for collection in collections:
            results = await self.kernel.memory.search_async(
                collection=collection,
                query=question,
                limit=3,
                min_relevance_score=0.7
            )
            memory_results.extend(results)

        # Build context
        if memory_results:
            context_text = "\n".join([
                f"- {r.text}" for r in memory_results
            ])
        else:
            context_text = "No relevant information found in memory."

        # Generate response
        sk_context = self.kernel.create_new_context()
        sk_context["question"] = question
        sk_context["memory_context"] = context_text

        result = await self.chat_function.invoke_async(context=sk_context)
        return str(result)

# Usage
chat = MemoryAugmentedChat(kernel)
response = await chat.chat("What is our company's refund policy?", ["policies"])
```

## Memory Management

```python
class MemoryManager:
    """Manage memory lifecycle."""

    def __init__(self, kernel: sk.Kernel):
        self.kernel = kernel

    async def get_collections(self) -> list:
        """List all collections."""
        return await self.kernel.memory.get_collections_async()

    async def delete_collection(self, collection: str):
        """Delete an entire collection."""
        await self.kernel.memory.delete_collection_async(collection)

    async def delete_item(self, collection: str, item_id: str):
        """Delete a specific item."""
        await self.kernel.memory.remove_async(collection, item_id)

    async def get_item(self, collection: str, item_id: str):
        """Get a specific item by ID."""
        return await self.kernel.memory.get_async(collection, item_id)

    async def update_item(
        self,
        collection: str,
        item_id: str,
        new_text: str,
        description: str = ""
    ):
        """Update an existing item (delete and re-add)."""
        await self.delete_item(collection, item_id)
        await self.kernel.memory.save_information_async(
            collection=collection,
            text=new_text,
            id=item_id,
            description=description
        )

    async def get_collection_stats(self, collection: str) -> dict:
        """Get statistics for a collection."""
        # Note: Implementation depends on memory store
        items = []
        # Some stores support listing all items
        return {
            "collection": collection,
            "item_count": len(items)
        }
```

## Best Practices

1. **Organize into collections**: Separate by topic/domain
2. **Use meaningful IDs**: Enable updates and deletions
3. **Set appropriate relevance thresholds**: Too low = noise, too high = missed results
4. **Choose persistent stores for production**: Volatile is for development
5. **Monitor memory size**: Large memories can slow down
6. **Regularly prune old data**: Keep memory fresh

## Resources

- [SK Memory Documentation](https://learn.microsoft.com/semantic-kernel/memories/)
- [Memory Connectors](https://learn.microsoft.com/semantic-kernel/memories/memory-connectors)
- [RAG with Semantic Kernel](https://learn.microsoft.com/semantic-kernel/memories/semantic-memory)
