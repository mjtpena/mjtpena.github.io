---
title: "Azure AI Search Index Operations: Schema Changes, Rebuilds and Aliases"
description: "Which Azure AI Search index changes work in place, which force a rebuild, and how to swap versioned indexes, load documents and check health safely."
author: Michael John Peña
draft: false
date: 2024-01-28
tags:
  - Azure AI Search
  - Vector Search
  - Operations
  - DevOps
  - Python
---

The first version of a search index is easy. The second is where teams get hurt: someone makes a field filterable, the update call fails, and the quickest fix anyone can find is to delete the index and reindex in production. Azure AI Search is strict about which schema changes it accepts in place, and once a RAG app or a customer-facing search page depends on an index, every change needs a plan for when that strictness applies.

This post covers the operational side: knowing which changes need a rebuild, running versioned indexes side by side, loading and deleting documents at volume, and the health checks I'd put in a deployment pipeline. Everything here targets the GA `2023-11-01` REST API and `azure-search-documents` 11.4.0 for Python, unless I flag it as preview. For the current split between GA and preview features, see [my post-Ignite stock-take](/blog/2024-01-23-azure-ai-search-updates/).

## Know which changes force a rebuild

An index's physical structures (inverted indexes, vector graphs, filter and sort structures) are built when documents are ingested. Anything that would change those structures can't be applied to existing data, so the service rejects the update. Microsoft documents the rules in [Drop and rebuild an index](https://learn.microsoft.com/en-us/azure/search/search-howto-reindex). In summary:

| Change | In place? |
|---|---|
| Add a new field | Yes. Existing documents have null in it until you repopulate |
| Set `retrievable` on an existing field | Yes |
| Change `searchAnalyzer` on a field that has an `indexAnalyzer` | Yes |
| Add, change or remove scoring profiles, semantic configurations, CORS settings, synonym map assignments | Yes |
| Add a new custom analyzer definition | Only with `allowIndexDowntime=true`, which takes the index offline for a few seconds |
| Add an existing field to a suggester | No, rebuild |
| Change a field's type, name, `analyzer`, or its `searchable`, `filterable`, `sortable`, `facetable` attributes | No, rebuild |
| Delete a field | No. You can hide it with `select` and `searchFields` until the next rebuild |
| Change vector dimensions or swap the embedding model | No, rebuild and re-embed |

The last row is the one RAG teams underestimate. Moving to a different embedding model doesn't count as a schema tweak. It means a full re-embed of the corpus, and you pay the embedding cost and the indexing time again. Budget for it from the start.

My rule of thumb is that additive changes go straight through the pipeline. Anything in the "No" rows becomes a new index version, built and validated alongside the live one.

## Versioned indexes, with or without aliases

The pattern is blue-green deployment for search: build `products-v3` while `products-v2` serves traffic, validate it, switch readers over, then delete `v2` once you're confident you won't roll back.

The switch is the awkward part. Azure AI Search has [index aliases](https://learn.microsoft.com/en-us/azure/search/search-how-to-alias), which let clients query a stable name that points at one index. You can repoint an alias without redeploying the app. Three caveats as of January 2024:

- Aliases are **preview**. They only exist on preview REST API versions (currently `2023-10-01-Preview`), and the GA Python SDK 11.4.0 explicitly removed the alias operations that the betas had ([its changelog](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/search/azure-search-documents/CHANGELOG.md#1140-2023-10-13) says they "are not available in this stable release"). If you want aliases from Python today, you call REST.
- An alias works for queries, document operations, and getting or updating the index definition. It doesn't work for deleting an index, for the Analyze Text API, or as an indexer's `targetIndexName`, so indexers and statistics calls still use the real index name. You can't delete an index while an alias still points at it.
- A repointed alias can take up to 10 seconds to propagate. Wait at least that long before deleting the old index, as the alias doc advises.

Here's the switch, using the preview REST API directly. The code samples in this post use modern type hints, so they need Python 3.10+ (the SDK itself supports 3.7+):

```python
import os

import requests

SERVICE = os.environ["SEARCH_SERVICE_NAME"]  # e.g. "<your-search-service>"
ADMIN_KEY = os.environ["SEARCH_ADMIN_KEY"]
API_VERSION = "2023-10-01-Preview"  # aliases are preview-only
BASE = f"https://{SERVICE}.search.windows.net"
HEADERS = {"api-key": ADMIN_KEY, "Content-Type": "application/json"}


def point_alias(alias_name: str, index_name: str) -> None:
    """Create the alias if it doesn't exist, otherwise repoint it."""
    body = {"name": alias_name, "indexes": [index_name]}
    resp = requests.put(
        f"{BASE}/aliases/{alias_name}",
        params={"api-version": API_VERSION},
        headers=HEADERS,
        json=body,
        timeout=30,
    )
    resp.raise_for_status()


def current_target(alias_name: str) -> str | None:
    resp = requests.get(
        f"{BASE}/aliases/{alias_name}",
        params={"api-version": API_VERSION},
        headers=HEADERS,
        timeout=30,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()["indexes"][0]


if __name__ == "__main__":
    previous = current_target("products")
    point_alias("products", "products-v3")
    print(f"products: {previous} -> products-v3")
```

Should you take a preview dependency for this? I'm comfortable with it on the deployment side, because the blast radius is small: if the alias API changes, the swap script breaks, not the query path. I'm less comfortable having production clients query through a preview-only alias name, since that ties every read to a preview feature with no SLA.

The GA alternative is unglamorous and works well: keep the live index name in app configuration (App Configuration, Key Vault or an app setting) and change that value as the switch. You lose the instant swap and need a config refresh or restart, but every call stays on the GA API. For most internal apps I'd pick this. I'd use aliases when many clients query the index directly and coordinating a config change across all of them is the real problem.

Either way, remember that two full indexes exist during the cut-over. Both count against your tier's index limit, storage and vector quota, as shown on [the service limits page](https://learn.microsoft.com/en-us/azure/search/search-limits-quotas-capacity). On a nearly full partition, a blue-green rebuild might not fit, and you want to discover that before the night of the release.

## Loading documents at volume

The push API accepts up to 1,000 documents or 16 MB per batch, whichever comes first, and the response reports success per document. Individual documents can fail while the request as a whole succeeds. That second point is where most homegrown loaders go wrong: they check the HTTP status and never look at the per-document results.

`SearchIndexingBufferedSender` in the Python SDK handles batching (it flushes every 512 actions by default and splits a batch in half if the payload is too large), retries documents that fail with 409, 422 or 503 (`max_retries_per_action` defaults to 3, per the [11.4.0 source](https://github.com/Azure/azure-sdk-for-python/blob/azure-search-documents_11.4.0/sdk/search/azure-search-documents/azure/search/documents/_search_indexing_buffered_sender_base.py)), and flushes on a timer. What it won't do is tell you about failures unless you ask:

```python
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchIndexingBufferedSender

ENDPOINT = os.environ["SEARCH_ENDPOINT"]  # https://<your-search-service>.search.windows.net
CREDENTIAL = AzureKeyCredential(os.environ["SEARCH_ADMIN_KEY"])


def load_documents(index_name: str, documents: list[dict]) -> list[str]:
    """Upload documents and return the keys that failed after retries."""
    failed_keys: list[str] = []

    def on_error(action) -> None:
        # action.additional_properties holds the document body
        failed_keys.append(action.additional_properties.get("id", "<unknown>"))

    with SearchIndexingBufferedSender(
        endpoint=ENDPOINT,
        index_name=index_name,
        credential=CREDENTIAL,
        on_error=on_error,
    ) as sender:
        sender.merge_or_upload_documents(documents=documents)
    # leaving the context manager flushes everything still queued

    return failed_keys


if __name__ == "__main__":
    docs = [{"id": str(i), "title": f"Sample document {i}"} for i in range(5000)]
    failures = load_documents("products-v3", docs)
    print(f"{len(docs) - len(failures)} loaded, {len(failures)} failed")
```

Replace `"id"` with your key field. I default to `merge_or_upload` rather than `upload` because it makes reruns safe for partial loads without wiping fields another process populated. When you deliberately want each document fully replaced, use `upload`.

If an indexer feeds the index instead of a push pipeline, the indexer owns retries and change tracking. Don't run a push loader against the same documents at the same time, because the last writer wins and neither process knows about the other.

## Deleting by filter

There is no delete-by-query operation. Deletion is by key, so removing "everything older than X" means querying for keys and deleting them in pages:

```python
import os
import time

from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient


def delete_by_filter(
    client: SearchClient, key_field: str, odata_filter: str, max_passes: int = 1000
) -> int:
    """Delete every document matching an OData filter. Returns the number deleted."""
    deleted = 0
    for _ in range(max_passes):
        results = client.search(
            search_text="*", filter=odata_filter, select=[key_field], top=1000
        )
        keys = [{key_field: r[key_field]} for r in results]
        if not keys:
            return deleted

        outcome = client.delete_documents(documents=keys)
        failed = [r.key for r in outcome if not r.succeeded]
        if failed:
            raise RuntimeError(f"{len(failed)} deletes failed, e.g. {failed[:5]}")

        deleted += len(keys)
        time.sleep(2)  # indexing is near real time; let deletes become visible

    raise RuntimeError(f"Stopped after {max_passes} passes; is something re-adding documents?")


if __name__ == "__main__":
    search_client = SearchClient(
        endpoint=os.environ["SEARCH_ENDPOINT"],
        index_name="products-v3",
        credential=AzureKeyCredential(os.environ["SEARCH_ADMIN_KEY"]),
    )
    n = delete_by_filter(search_client, "id", "lastModified lt 2023-01-01T00:00:00Z")
    print(f"Deleted {n} documents")
```

Re-query from the top on each pass instead of paging with `skip`. The result set shrinks as you delete, so `skip` would jump past documents. The short pause matters because a delete isn't searchable instantly, and without it you'll fetch keys you've already deleted. That repeat is harmless but wasteful. Pause any indexer that writes to the index first; otherwise it can keep re-adding matching documents, which is why the loop has a `max_passes` guard.

The filtered field has to be `filterable`. If it isn't, that's a schema change from the "No" rows, so it's worth planning retention fields before the first build.

## Health checks worth automating

Two calls answer most "is search healthy?" questions. Note that in 11.4.0, `get_index_statistics` returns a plain dict, not a model object:

```python
import os

from azure.core.credentials import AzureKeyCredential
from azure.search.documents.indexes import SearchIndexClient, SearchIndexerClient

ENDPOINT = os.environ["SEARCH_ENDPOINT"]
CREDENTIAL = AzureKeyCredential(os.environ["SEARCH_ADMIN_KEY"])


def index_health(index_name: str) -> dict:
    stats = SearchIndexClient(ENDPOINT, CREDENTIAL).get_index_statistics(index_name)
    return {
        "documents": stats["document_count"],
        "storage_mb": round(stats["storage_size"] / 1024**2, 1),
        "vector_mb": round(stats["vector_index_size"] / 1024**2, 1),
    }


def indexer_health(indexer_name: str) -> dict:
    status = SearchIndexerClient(ENDPOINT, CREDENTIAL).get_indexer_status(indexer_name)
    last = status.last_result
    if last is None:
        return {"status": "never run"}
    return {
        "status": last.status,
        "started": last.start_time.isoformat() if last.start_time else None,
        "processed": last.item_count,
        "failed": last.failed_item_count,
        "first_errors": [e.error_message for e in last.errors[:3]],
    }


if __name__ == "__main__":
    print(index_health("products-v3"))
    print(indexer_health("products-indexer"))
```

In a deployment pipeline, I gate the cut-over on three checks against the new index. The document count must be within an expected tolerance of the old one, the indexer's last run must have zero failed items (or a known, accepted number), and a handful of saved "golden" queries must return the documents they're supposed to. Document count alone is a weak signal: an index can contain every document and still return nonsense if an analyzer or field mapping is wrong. The golden queries catch that.

Statistics are not real time. Counts and storage can lag ingestion by several minutes, so poll with a timeout rather than asserting immediately after a load. For ongoing monitoring, use [diagnostic settings and Azure Monitor](https://learn.microsoft.com/en-us/azure/search/monitor-azure-cognitive-search) to alert on throttling and indexer failures instead of scheduling scripts.

## Keep definitions in source control

Index, indexer, skillset and data source definitions are infrastructure. I keep them as JSON in the repo, deploy them with the REST API pinned to a specific `api-version`, and derive the versioned index name from the commit or a version number in the file. The pipeline then follows the same shape every time: create the new index, load or run the indexer, run the health checks above, switch the alias or config value, and keep the old index around for a defined rollback window.

Avoid letting the portal be the source of truth. The portal is great for experimenting, and the **Import data** wizards produce useful starting JSON, but an index someone edited by hand can't be rebuilt reliably when you need a new version.

## When this is overkill

Not every index needs blue-green. If the index is small enough to rebuild in a few minutes, has no external SLA, and the source of truth is easy to re-ingest, a scheduled maintenance window with drop-and-recreate is simpler and cheaper. The same applies on the Free and Basic tiers, where the index and storage limits make running two copies hard anyway.

The full pattern pays off when rebuilds take hours, when embeddings are expensive to regenerate, or when search downtime means users notice. That describes most production RAG workloads.

## The short version

- Learn the in-place versus rebuild rules before the first production release, and design filterable and retention fields up front.
- Treat anything that needs a rebuild as a new index version, built and validated alongside the live one.
- Index aliases make the swap clean but are preview-only and REST-only from Python as of January 2024. A config-driven index name is the GA alternative, and it's usually good enough.
- Always inspect per-document results when loading or deleting. A successful HTTP response doesn't mean every document made it.
- Gate cut-overs on counts, indexer failures and golden queries, not on counts alone.
