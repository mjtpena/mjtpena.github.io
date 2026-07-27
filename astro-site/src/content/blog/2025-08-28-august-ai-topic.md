---
title: "Embedding Models: Choosing Between OpenAI, Azure, and Open Source"
author: Michael John Peña
draft: false
date: 2025-08-28
tags:
  - Embeddings
  - Vector Search
  - OpenAI
  - RAG
  - Machine Learning

---

I wrote "Embedding Models: Choosing Between OpenAI, Azure, and Open Source" to share practical, production-minded guidance on this topic.

## Azure OpenAI Embeddings

The text-embedding-ada-002 and newer text-embedding-3 models provide high-quality embeddings with minimal setup.

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-08-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

def get_embeddings(texts: list[str], model: str = "text-embedding-3-small") -> list[list[float]]:
    """Get embeddings for a list of texts."""
    response = client.embeddings.create(
        model=model,
        input=texts,
        dimensions=1536  # Can reduce for text-embedding-3 models
    )

    return [item.embedding for item in response.data]

# Usage
texts = ["How to implement RAG", "Building search applications"]
embeddings = get_embeddings(texts)
```

## Open Source Alternatives

Sentence Transformers provide local embedding generation without API calls.

```python
from sentence_transformers import SentenceTransformer

# Load a high-quality open source model
model = SentenceTransformer('BAAI/bge-large-en-v1.5')

def get_local_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate embeddings locally."""
    embeddings = model.encode(texts, normalize_embeddings=True)
    return embeddings.tolist()

# For multilingual support
multilingual_model = SentenceTransformer('sentence-transformers/paraphrase-multilingual-mpnet-base-v2')
```

## Comparison Table

| Model | Dimensions | Cost | Latency | Quality |
|-------|-----------|------|---------|---------|
| text-embedding-3-small | 512-1536 | Low | Low | Good |
| text-embedding-3-large | 256-3072 | Medium | Low | Excellent |
| BGE-large-en | 1024 | Free | Medium | Excellent |
| E5-large-v2 | 1024 | Free | Medium | Very Good |

## Selection Criteria

Use Azure OpenAI embeddings when you need simplicity, consistent quality, and can afford API costs. Choose open source when you need to control costs at scale, require offline operation, or have specific domain requirements that benefit from fine-tuning.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
