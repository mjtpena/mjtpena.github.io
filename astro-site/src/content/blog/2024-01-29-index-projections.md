---
title: "Azure AI Search Index Projections: Keys, Deletes and Chunk Order"
description: "The edge cases of index projections in Azure AI Search: what the chunk index schema needs, how keys change on re-index, deletes, and keeping chunk order."
author: Michael John Peña
draft: false
date: 2024-01-29
tags:
  - Azure AI Search
  - Index Projections
  - Chunking
  - RAG
  - Vector Search
---

Index projections are the piece that makes indexer-based chunking usable for RAG in Azure AI Search: the Split skill breaks a document into chunks, and the projection writes each chunk to the index as its own search document with a pointer back to its parent. The basic configuration is short and the portal wizard will write it for you. The parts that hurt later are the ones the wizard doesn't explain: what the schema has to look like, what happens to chunk keys when a file changes, why deleted files leave chunks behind, and how to get chunks back in order.

I covered where projections sit among the Ignite releases in [the January stock-take](/blog/2024-01-23-azure-ai-search-updates/) and how they combine with embedding in [the integrated vectorization post](/blog/2024-01-24-integrated-vectorization/). This post is the edge cases.

## Status and where it lives

Index projections arrived in public preview in November 2023, alongside integrated vectorization. You can use them through the `2023-10-01-Preview` REST API, the portal's **Import and vectorize data** wizard, and the beta SDK packages. The GA `2023-11-01` API doesn't include them, so everything below pins the preview version and uses REST.

Don't confuse them with knowledge store projections, which I wrote about [back in 2022](/blog/2022-08-27-cognitive-search-projections/). Those write enriched output to Azure Storage tables, objects and files. Index projections write into a search index, and they exist to solve one problem: one source document becoming many search documents.

The second thing to get right is location. An index projection is defined on the **skillset** in an `indexProjections` property, not in the indexer's parameters. It has an array of `selectors`, one per target index, and an optional `parameters.projectionMode`.

## The schema has rules the error messages don't explain well

The [index projections documentation](https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections) sets three requirements on the target index, and I'd build the schema around them before writing any skillset:

| Field | Requirement | Who populates it |
|---|---|---|
| Document key (`chunk_id`) | `Edm.String`, searchable, `keyword` analyzer | The service generates it for each projected chunk |
| Parent key (`parent_id`) | `Edm.String`, filterable, not the document key | The service fills it with the parent document's key |
| Everything else | Any type | Only what you list in the selector's `mappings` |

Two things in that table trip people up. First, you don't map the key or the parent key. The service generates both, so adding mappings for them is at best redundant. Second, the opposite is true for every other field: projections don't do the implicit name matching that indexer field mappings do. If a field isn't in `mappings`, it's empty on every chunk. That includes parent-level metadata like the file name, which you have to map explicitly from the parent's path.

Here is the index for the examples in this post, created with `PUT /indexes/docs-chunks?api-version=2023-10-01-Preview`:

```json
{
  "name": "docs-chunks",
  "fields": [
    { "name": "chunk_id", "type": "Edm.String", "key": true, "searchable": true, "filterable": true, "analyzer": "keyword" },
    { "name": "parent_id", "type": "Edm.String", "filterable": true },
    { "name": "source_file", "type": "Edm.String", "searchable": true, "filterable": true },
    { "name": "chunk", "type": "Edm.String", "searchable": true },
    { "name": "chunk_ordinal", "type": "Edm.Int32", "filterable": true, "sortable": true },
    {
      "name": "chunk_vector",
      "type": "Collection(Edm.Single)",
      "searchable": true,
      "dimensions": 1536,
      "vectorSearchProfile": "default-profile"
    }
  ],
  "vectorSearch": {
    "algorithms": [ { "name": "hnsw-default", "kind": "hnsw", "hnswParameters": { "metric": "cosine" } } ],
    "profiles": [ { "name": "default-profile", "algorithm": "hnsw-default" } ]
  }
}
```

I always project a readable `source_file` alongside `parent_id`. The parent key is whatever key the indexer computed for the source document, which for Blob Storage is an encoded form of the storage path. That's fine for joins in code and useless in a citation or a filter a person types.

## Projection mode: skip the parent documents

`projectionMode` has two values. `includeIndexingParentDocuments` is the default, and it writes the parent document to the index as well as its chunks. The parent has the parent-level fields filled and the chunk fields empty, so in a single chunk index you end up with documents of two different shapes, and the parents have no vector. In a RAG index they're noise that keyword search will happily return.

Set `skipIndexingParentDocuments` when the indexer and the projection target the same index, which is the normal RAG setup. Keep the default only when the indexer targets a separate parent index and the selector writes chunks to a different child index. That two-index design has a use, a parent index you can look up for document-level metadata, but Azure AI Search has no joins, so your application does the stitching. I'd only choose it if the parent metadata is large enough that repeating it on every chunk is a real storage cost.

## Keys change when the source changes

This is the edge case that breaks designs. The projected key for each chunk is generated from a hash, the parent's key and the enrichment path, roughly `<hash>_<parent key>_pages_<n>` with the stock Split skill. The documentation's content lifecycle section is explicit about what happens on update: when a source document changes, the hash changes, and when a document shrinks to fewer chunks, the surplus chunk documents are deleted and the remaining ones get new keys even if their text didn't change.

So `chunk_id` is not a stable identifier. Don't store it anywhere outside the index:

- **Citations and feedback.** If your chat app logs which chunks it cited so users can give thumbs up or down, log `parent_id` plus something durable (the chunk ordinal, or a hash of the chunk text you compute yourself), not the projected key.
- **Evaluation sets.** A golden set of "question to expected chunk ID" goes stale the first time someone edits a source file. Express expected results as a document plus a passage.
- **Manual corrections.** You can push edits into projected documents with the Documents API, but the next indexer run that picks up the source document overwrites them. Fix the source or the skillset, not the index.

## Deletes need a policy from day one

Chunk-level deletes are handled for you: shorten a file and the extra chunks go away on the next run. Whole-document deletes aren't. If a file disappears from the container, the indexer only removes its chunks if the data source has a `dataDeletionDetectionPolicy`. Without one, the chunks stay in the index and keep turning up in answers, which is the worst kind of RAG bug because the answer looks well sourced.

For Blob Storage the options are native blob soft delete or a soft-delete metadata property, both covered in [change and delete detection for Azure Storage](https://learn.microsoft.com/en-us/azure/search/search-how-to-index-azure-blob-changed-deleted). The catch is in that page: the policy has to be in place before the first indexer run. Documents deleted before you added it stay orphaned, and resetting the indexer doesn't clean them up. If you've already shipped without one, you either delete orphans yourself by filtering on `parent_id`, or you rebuild into a new index. I'd add the policy to the data source definition in the same pull request as the skillset, because it's easy to forget once the pipeline appears to work.

## Getting chunks back in order

The stock Split skill in the `2023-10-01-Preview` API returns one output, `textItems`, which is an array of strings. There's no ordinal or offset output, so nothing in the projected document tells you which chunk came before which.

The ordinal is visible inside the generated key, but I wouldn't parse it. The key format is shown by example in the docs, not promised as a contract, and string sorting puts `_pages_10` before `_pages_2` anyway.

If you need neighbouring chunks, for example to expand a hit with the paragraphs either side before sending it to the model, chunk in a [custom Web API skill](https://learn.microsoft.com/en-us/azure/search/cognitive-search-custom-skill-web-api) that returns objects instead of strings. This is also where structure-aware logic lives, like the heading-based approach in [my chunking post](/blog/2024-01-07-advanced-chunking-strategies/), because the Split skill only counts characters. A minimal Azure Function using the Python v2 programming model:

```python
import json

import azure.functions as func

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

MAX_CHARS = 2000
OVERLAP_CHARS = 300


def split_text(text: str) -> list[str]:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > MAX_CHARS:
            chunks.append(current)
            current = current[-OVERLAP_CHARS:]
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        while len(candidate) > MAX_CHARS:
            chunks.append(candidate[:MAX_CHARS])
            candidate = candidate[MAX_CHARS - OVERLAP_CHARS:]
        current = candidate
    if current:
        chunks.append(current)
    return chunks


@app.route(route="chunk", methods=["POST"])
def chunk(req: func.HttpRequest) -> func.HttpResponse:
    results = []
    for record in req.get_json()["values"]:
        text = record["data"].get("text") or ""
        chunks = [
            {"text": chunk_text, "ordinal": i}
            for i, chunk_text in enumerate(split_text(text))
        ]
        results.append({
            "recordId": record["recordId"],
            "data": {"chunks": chunks},
            "errors": [],
            "warnings": [],
        })
    return func.HttpResponse(
        json.dumps({"values": results}), mimetype="application/json"
    )
```

The skillset calls it, embeds each chunk's text, and projects all three values. Note that `sourceContext` and the embedding skill's context both point at `/document/chunks/*`, and the parent-level file name comes from the parent path:

```json
{
  "name": "docs-chunking",
  "skills": [
    {
      "@odata.type": "#Microsoft.Skills.Custom.WebApiSkill",
      "name": "chunker",
      "context": "/document",
      "uri": "https://<your-function-app>.azurewebsites.net/api/chunk?code=<your-function-key>",
      "httpMethod": "POST",
      "timeout": "PT90S",
      "batchSize": 10,
      "inputs": [ { "name": "text", "source": "/document/content" } ],
      "outputs": [ { "name": "chunks", "targetName": "chunks" } ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill",
      "name": "embed",
      "context": "/document/chunks/*",
      "resourceUri": "https://<your-openai-resource>.openai.azure.com",
      "deploymentId": "<your-embedding-deployment>",
      "apiKey": "<your-openai-key>",
      "inputs": [ { "name": "text", "source": "/document/chunks/*/text" } ],
      "outputs": [ { "name": "embedding", "targetName": "vector" } ]
    }
  ],
  "indexProjections": {
    "selectors": [
      {
        "targetIndexName": "docs-chunks",
        "parentKeyFieldName": "parent_id",
        "sourceContext": "/document/chunks/*",
        "mappings": [
          { "name": "chunk", "source": "/document/chunks/*/text" },
          { "name": "chunk_ordinal", "source": "/document/chunks/*/ordinal" },
          { "name": "chunk_vector", "source": "/document/chunks/*/vector" },
          { "name": "source_file", "source": "/document/metadata_storage_name" }
        ]
      }
    ],
    "parameters": { "projectionMode": "skipIndexingParentDocuments" }
  }
}
```

With `chunk_ordinal` in the index, expanding a hit is one filtered query against the same index:

```python
import os

import requests

SEARCH_ENDPOINT = "https://<your-search-service>.search.windows.net"
API_VERSION = "2023-10-01-Preview"


def expand_hit(parent_id: str, ordinal: int, window: int = 1) -> str:
    escaped_parent = parent_id.replace("'", "''")
    body = {
        "search": "*",
        "filter": (
            f"parent_id eq '{escaped_parent}' "
            f"and chunk_ordinal ge {ordinal - window} "
            f"and chunk_ordinal le {ordinal + window}"
        ),
        "orderby": "chunk_ordinal asc",
        "select": "chunk,chunk_ordinal",
        "top": 2 * window + 1,
    }
    response = requests.post(
        f"{SEARCH_ENDPOINT}/indexes/docs-chunks/docs/search?api-version={API_VERSION}",
        headers={"Content-Type": "application/json", "api-key": os.environ["SEARCH_QUERY_KEY"]},
        json=body,
        timeout=30,
    )
    response.raise_for_status()
    return "\n\n".join(doc["chunk"] for doc in response.json()["value"])


if __name__ == "__main__":
    print(expand_hit("<parent-id-from-a-search-hit>", ordinal=4))
```

Because chunks overlap, the joined text repeats the overlap at each boundary. For a prompt that's a few hundred wasted characters, and I'd accept it rather than try to de-duplicate text that the chunker may have cut mid-sentence.

The cost of this approach is a function app you now own: deployment, scaling, a key in the skill URI, and the 230-second maximum timeout on Web API skills for very large documents. If you don't need neighbours or structure-aware splitting, stay with the Split skill and skip the ordinal entirely.

## When I'd reach for projections, and when I wouldn't

Use index projections when your content already sits somewhere an indexer can read, you want chunking and embedding to follow source changes automatically, and the workload can live with a preview API on the indexing path. Set `skipIndexingParentDocuments`, project a readable source field, and put a deletion policy on the data source before the first run.

Skip them when documents arrive by push or need preprocessing an indexer can't call, or when something outside the index depends on stable chunk identifiers. In those cases, chunking in your own pipeline and uploading chunks with keys you control is more work up front, but every key, ordinal and delete is yours to reason about. When a projection-based index misbehaves, check the edge cases above before blaming the feature.
