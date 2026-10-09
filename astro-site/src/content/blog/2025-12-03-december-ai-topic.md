---
title: "Migrating from LangChain to Semantic Kernel: A Practical Guide"
description: "Many teams that started with LangChain in 2024 are now evaluating Semantic Kernel for its tighter Azure integration and production-ready features. Having…"
author: Michael John Peña
draft: false
date: 2025-12-03
tags:
  - Semantic-Kernel
  - LangChain
  - Migration
  - Python
  - AI
---

Many teams that started with LangChain in 2024 are now evaluating Semantic Kernel for its tighter Azure integration and production-ready features. Having migrated several projects this year, here's my practical guide for making the switch.

## Why Migrate?

The primary reasons teams migrate to Semantic Kernel:
- Native .NET support for Microsoft-stack organizations
- Better Azure OpenAI integration
- More predictable API stability
- Enterprise support options through Microsoft

## Key Concept Mappings

| LangChain | Semantic Kernel |
|-----------|-----------------|
| Chain | Plugin + Function |
| Agent | Agent with Plugins |
| Tool | KernelFunction |
| Memory | Memory Store |
| Prompt Template | Prompt Template Config |

## Migration Example: RAG Pipeline

### Before (LangChain)

```python
from langchain.chains import RetrievalQA
from langchain_openai import AzureChatOpenAI
from langchain_community.vectorstores import FAISS

llm = AzureChatOpenAI(deployment_name="gpt-4")
vectorstore = FAISS.load_local("./index", embeddings)
chain = RetrievalQA.from_chain_type(llm=llm, retriever=vectorstore.as_retriever())
result = chain.invoke("What is our refund policy?")
```

### After (Semantic Kernel)

```python
from semantic_kernel import Kernel
from semantic_kernel.connectors.ai.open_ai import AzureChatCompletion
from semantic_kernel.connectors.memory.azure_ai_search import AzureAISearchCollection
from semantic_kernel.functions import kernel_function

kernel = Kernel()
kernel.add_service(AzureChatCompletion(
    deployment_name="gpt-4",
    endpoint="https://your-endpoint.openai.azure.com/",
    api_key="your-key"
))

class RAGPlugin:
    def __init__(self, search_collection):
        self.search = search_collection

    @kernel_function(description="Answer questions using knowledge base")
    async def answer_question(self, question: str) -> str:
        # Retrieve relevant documents
        results = await self.search.search(question, top_k=5)
        context = "\n".join([r.content for r in results])

        # Generate answer with context
        prompt = f"Context: {context}\n\nQuestion: {question}\n\nAnswer:"
        response = await kernel.invoke_prompt(prompt)
        return str(response)

# Register and use plugin
kernel.add_plugin(RAGPlugin(search_collection), "rag")
result = await kernel.invoke("rag", "answer_question", question="What is our refund policy?")
```

## Migration Checklist

1. **Inventory existing chains** - Document all LangChain components
2. **Map to SK equivalents** - Identify Semantic Kernel patterns
3. **Migrate incrementally** - Start with isolated components
4. **Test thoroughly** - Compare outputs between implementations
5. **Update monitoring** - Adjust observability for SK patterns

The migration effort is typically 2-4 weeks for a medium-sized project, with the investment paying off in long-term maintainability and Azure ecosystem integration.
