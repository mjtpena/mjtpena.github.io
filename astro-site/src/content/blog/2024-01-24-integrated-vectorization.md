---
title: "Integrated Vectorization in Azure AI Search: What It Does and Doesn't Do"
description: "What integrated vectorization in Azure AI Search actually removes from a RAG pipeline, what it leaves behind, and when I'd still embed in my own code."
author: Michael John Peña
draft: false
date: 2024-01-24
tags:
  - Azure AI Search
  - Vector Search
  - Embeddings
  - RAG
  - Azure OpenAI
---

Most RAG pipelines on Azure still carry a chunk of code whose only job is to call an embedding model and copy the vectors somewhere: once per chunk at indexing time, and once per question at query time. Integrated vectorization, in public preview in Azure AI Search since Ignite in November 2023, moves both of those calls into the search service. That's a real simplification, but it's easy to misread how far it goes, and the misreading leads to designs that don't work.

[Yesterday's stock-take](/blog/2024-01-23-azure-ai-search-updates/) covered where the feature sits next to everything else that shipped at Ignite, including the index and skillset JSON. This post is about the edges: what the service now does for you, what you still own, and where I'd keep my own embedding code.

## What it actually replaces

Integrated vectorization is two separate features that happen to share a name.

| Stage | Before | With integrated vectorization | Mechanism |
|---|---|---|---|
| Indexing | Your code chunks, calls Azure OpenAI, pushes vectors | An indexer runs a skillset that chunks and embeds | Split skill + Azure OpenAI Embedding skill + index projections |
| Querying | Your code embeds the question, sends a vector | You send text, the service embeds it | A vectorizer on the index's vector profile |

Both need the `2023-10-01-Preview` API version, whether you call REST directly, use an SDK beta that targets it, or use the portal's preview **Import and vectorize data** wizard, as the [What's new page](https://learn.microsoft.com/en-us/azure/search/whats-new) lists for November 2023. Vector search itself went GA at Ignite in the `2023-11-01` REST API version, but the GA Python SDK (`azure-search-documents` 11.4.0) [deliberately leaves out](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/search/azure-search-documents/CHANGELOG.md) `AzureOpenAIEmbeddingSkill`, `AzureOpenAIParameters` and `AzureOpenAIVectorizer`. From Python today, that means either pinning the 11.4.0b11 beta, with its pre-GA class names, or calling REST. I use REST below.

### The misconception: uploads don't get vectorised

The claim I hear most often is "turn on integrated vectorization and you can just upload documents". You can't. A vectorizer is a query-time object. If you push documents with the Documents API (`upload_documents` in the SDK, or `/docs/index` over REST), the service stores exactly what you send. Leave out the vector field and the document simply has no vector, so vector queries won't find it.

Indexing-time vectorization only happens inside an indexer pipeline, which means a supported data source (Blob Storage, ADLS Gen2, Azure SQL, Cosmos DB and the other indexer sources) and a skillset. If your architecture is push-based, because documents arrive through an API, come from a system without an indexer, or need preprocessing you control, you keep your embedding code for indexing. You can still get the query-time half by adding a vectorizer.

## Wiring the indexing side

Given an index with a vector profile and vectorizer and a skillset with Split, Azure OpenAI Embedding and index projections (the full JSON is in [the stock-take](/blog/2024-01-23-azure-ai-search-updates/), and projections get their own post next week), you need a data source and an indexer to run it.

```python
import os
import requests

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
API_VERSION = "2023-10-01-Preview"
HEADERS = {
    "Content-Type": "application/json",
    "api-key": os.environ["SEARCH_ADMIN_KEY"],
}


def put(resource: str, name: str, body: dict) -> None:
    url = f"{SEARCH_ENDPOINT}/{resource}/{name}?api-version={API_VERSION}"
    response = requests.put(url, headers=HEADERS, json=body, timeout=30)
    response.raise_for_status()


put("datasources", "docs-blob", {
    "name": "docs-blob",
    "type": "azureblob",
    "credentials": {
        "connectionString": (
            "ResourceId=/subscriptions/<your-subscription-id>/resourceGroups/<your-resource-group>"
            "/providers/Microsoft.Storage/storageAccounts/<your-storage-account>;"
        )
    },
    "container": {"name": "<your-container>"},
})

put("indexers", "docs-indexer", {
    "name": "docs-indexer",
    "dataSourceName": "docs-blob",
    "skillsetName": "docs-chunking",
    "targetIndexName": "docs-chunks",
    "schedule": {"interval": "PT2H"},
    "parameters": {
        "maxFailedItems": 0,
        "configuration": {"dataToExtract": "contentAndMetadata", "parsingMode": "default"},
    },
})
```

The data source uses a managed-identity connection string (`ResourceId=...;`) rather than an account key, so the search service's identity needs the Storage Blob Data Reader role on the account. The indexer's `targetIndexName` must be the same index the projections write to. The blob indexer tracks changes by last-modified time, so an edited file is reprocessed on the next run. Note what that means for cost: every chunk of that file is embedded again, not just the paragraph that changed.

I keep `maxFailedItems` at its default of 0 and set it explicitly so nobody raises it without a conversation. The Azure OpenAI Embedding skill calls your deployment under its tokens-per-minute quota, a large first load will hit that quota, and the resulting throttling can surface as item failures. I would rather the run fail loudly and get re-run than quietly complete with documents missing from the index. Size the deployment's quota for the initial backfill, not for steady state, and lower it afterwards if you need the capacity elsewhere.

### Authentication

Both the skill and the vectorizer accept either an `apiKey` or an `authIdentity`, which is a user-assigned managed identity on the search service; with neither, the service's system-assigned identity is used. I'd use a managed identity with the Cognitive Services OpenAI User role on the Azure OpenAI resource. API keys in a skillset definition end up in every export, every pull request and every deployment pipeline that touches it.

## The query side

With a vectorizer on the profile, a query sends text with `"kind": "text"` instead of a vector:

```python
import os
import requests

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
API_VERSION = "2023-10-01-Preview"


def search_chunks(question: str, top: int = 5) -> list[dict]:
    body = {
        "search": question,
        "vectorQueries": [
            {"kind": "text", "text": question, "fields": "chunk_vector", "k": 50}
        ],
        "queryType": "semantic",
        "semanticConfiguration": "default",
        "select": "chunk_id,parent_id,title,chunk",
        "top": top,
    }
    response = requests.post(
        f"{SEARCH_ENDPOINT}/indexes/docs-chunks/docs/search?api-version={API_VERSION}",
        headers={
            "Content-Type": "application/json",
            "api-key": os.environ["SEARCH_QUERY_KEY"],
        },
        json=body,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["value"]


if __name__ == "__main__":
    for hit in search_chunks("How do I rotate the storage account keys?"):
        print(hit["@search.rerankerScore"], hit["title"])
```

This is hybrid search with semantic ranking in one call, with no OpenAI client in the application. That's the part of integrated vectorization I like most. The query service no longer needs an Azure OpenAI endpoint, a key, retry logic for embedding calls, or a dependency on the `openai` package. One less credential in the app tier matters more to me than the few lines of code it saves.

The trade-off is that this query only works on a preview API version. The stock-take argued for GA-only query paths in production, and integrated query vectorization is the clearest case of that tension. My compromise: use the vectorizer for internal tools and prototypes, and keep a direct embedding call against the GA `2023-11-01` API for customer-facing queries until this goes GA.

## Keep the skill and vectorizer on the same deployment

The skillset and the vectorizer each name an Azure OpenAI deployment, and nothing in the service checks that they match. If someone repoints the vectorizer at a different deployment, or redeploys the embedding model under a new name in one place but not the other, queries are embedded in one vector space and the index holds another. Nothing errors. Results just get worse, and with hybrid search the keyword half hides how much worse.

The fix is cheap: put the deployment name in one variable in your infrastructure code, and add a check to the release pipeline.

```python
import os
import sys
import requests

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
API_VERSION = "2023-10-01-Preview"
HEADERS = {"api-key": os.environ["SEARCH_ADMIN_KEY"]}


def get(resource: str, name: str) -> dict:
    url = f"{SEARCH_ENDPOINT}/{resource}/{name}?api-version={API_VERSION}"
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    return response.json()


def norm(uri: str) -> str:
    # Avoid false alarms from a trailing slash or a difference in case.
    return uri.rstrip("/").lower()


index = get("indexes", "docs-chunks")
skillset = get("skillsets", "docs-chunking")

index_targets = {
    (norm(v["azureOpenAIParameters"]["resourceUri"]), v["azureOpenAIParameters"]["deploymentId"])
    for v in index["vectorSearch"]["vectorizers"]
    if v["kind"] == "azureOpenAI"
}
skill_targets = {
    (norm(s["resourceUri"]), s["deploymentId"])
    for s in skillset["skills"]
    if s["@odata.type"] == "#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill"
}

if index_targets != skill_targets:
    print(f"Embedding drift: vectorizer={index_targets} skill={skill_targets}")
    sys.exit(1)
print("Vectorizer and embedding skill use the same deployment.")
```

The same logic applies to a model change. Moving from `text-embedding-ada-002` to anything else is a full re-index, because old and new vectors aren't comparable. Integrated vectorization doesn't change that; it just makes the re-index a matter of resetting and re-running an indexer instead of re-running your own batch job.

## What you still own

Integrated vectorization removes plumbing, not decisions. You still choose:

- **Chunk size and overlap.** The Split skill's `maximumPageLength` and `pageOverlapLength` are in characters, and the right values depend on your documents and questions. The portal's preview **Import and vectorize data** wizard picks defaults for you, which is fine for a first pass and not a tuning decision. I covered structure-aware chunking in [an earlier post](/blog/2024-01-07-advanced-chunking-strategies/), and that kind of logic doesn't fit in a Split skill.
- **Embedding cost.** The service calls your Azure OpenAI deployment and you pay for those tokens at the normal [Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/). The arithmetic is unchanged: total characters indexed, plus overlap, plus every re-embedded document, plus one embedding per query. The one built-in lever is incremental enrichment, still in preview: set the indexer's `cache` property to a storage account and the service keeps skill outputs, so a skillset edit or reset can reuse enrichments for documents that haven't changed instead of re-running every skill. It doesn't help with edited files, which are still re-chunked and re-embedded in full, and it adds a storage account to manage. I'd turn it on only once the corpus is large enough that a full re-embed hurts.
- **Capacity.** Vectors still count against your tier's vector index size limit. 1,536 floats per chunk for ada-002 adds up quickly when overlap makes chunks repeat content.

The other option is a custom vectorizer. The preview API also accepts `"kind": "customWebApi"` vectorizers, which call an endpoint you host, so a non-OpenAI embedding model can still get query-time vectorization. That brings back a service you have to run, so I'd only use it when the model choice is genuinely required.

## When I'd use it, and when I wouldn't

I'd use integrated vectorization for document-heavy RAG where the content already sits in Blob Storage or a database an indexer can read, the team is small, and a failed indexer run means stale answers for a few hours rather than an outage. It removes a whole service and a credential, and the defaults are reasonable.

I wouldn't use it when documents arrive by push, when chunking needs to understand document structure, when the workload needs an SLA that a preview API can't give, or when embedding costs need tight control over exactly what gets re-embedded. In those cases, my own pipeline pushing to the GA API is still the better design, and I'd add only the query-time vectorizer once it reaches GA.

The [integrated vectorization concept page](https://learn.microsoft.com/en-us/azure/search/vector-search-integrated-vectorization) is the reference to keep open. Pin `2023-10-01-Preview` explicitly in every call, and expect property names to move before GA, the way they did between `2023-07-01-Preview` and now.
