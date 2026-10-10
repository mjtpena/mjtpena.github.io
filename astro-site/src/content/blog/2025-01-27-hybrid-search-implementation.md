---
title: "Hybrid Search in PostgreSQL: pgvector, Full-Text and RRF in One Query"
description: "How to build hybrid search inside PostgreSQL with pgvector, full-text search and weighted reciprocal rank fusion, and when a dedicated search service is better."
author: Michael John Peña
draft: false
date: 2025-01-27
tags:
  - PostgreSQL
  - Hybrid Search
  - Vector Search
  - RAG
  - Azure
---

Pure vector search is bad at exact tokens. Ask a RAG assistant about `ERR_CONNECTION_REFUSED` or part number `KX-4471` and the embedding happily returns documents about "network problems" or "similar components", while the one page that names the exact string sits at rank 30. Keyword search has the opposite failure: it finds the string but misses the troubleshooting guide that never uses it. Hybrid search runs both and fuses the rankings, and if your data already lives in PostgreSQL you can do it in a single SQL statement without adding another service.

I've written before about [hybrid search in Azure AI Search](/blog/2024-01-27-hybrid-search-optimization/), where the service does the fusion for you. This post is about the other case: your documents and embeddings sit in Azure Database for PostgreSQL flexible server (or any Postgres with pgvector), and you want to know whether rolling your own hybrid query is a sensible idea.

## Where hybrid search actually earns its keep

Hybrid search is not free. You maintain two indexes, run two retrievals per query and tune a fusion step. It pays off when your corpus mixes two kinds of queries:

| Query shape | Example | Who wins alone |
|---|---|---|
| Exact identifiers | Error codes, SKUs, ticket numbers, policy IDs | Keyword |
| Rare domain jargon | Internal product codenames, acronyms the embedding model never saw | Keyword |
| Paraphrased questions | "Why can't my app reach the database?" | Vector |
| Conceptual questions | "How do we handle leave for contractors?" | Vector |

If your users only ask conceptual questions over prose (an HR policy bot, say), vectors alone are often good enough and hybrid adds latency for little gain. If they only search for identifiers, a well-configured full-text index beats an embedding every time. The mixed middle, which is most enterprise knowledge bases, is where hybrid is worth it.

## Why fuse ranks instead of scores

The obvious approach is to normalise the two scores and add them. The problem is that cosine distance and PostgreSQL's `ts_rank` live on unrelated scales with different distributions, and min-max normalisation is sensitive to whatever happens to be the best and worst result for that particular query. A single outlier reshapes every other score.

Reciprocal Rank Fusion (RRF), from [Cormack, Clarke and Büttcher's 2009 SIGIR paper](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf), ignores the raw scores and uses only positions. Each document gets `1 / (k + rank)` from every list it appears in, summed across lists, with `k = 60` as the conventional constant. A document ranked 1st in one list and 3rd in another comfortably beats one that is 1st in only one list. It is the same approach Azure AI Search uses for its own [hybrid ranking](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking), which is a good sign that it holds up in practice.

My rule of thumb: start with plain RRF and `k = 60`, measure, and only then reach for weights. Most of the tuning I see teams do on day one is guesswork that a small evaluation set would have ruled out.

## The schema

The setup on Azure Database for PostgreSQL flexible server is two indexes on one table. The `vector` extension has to be allow-listed in the `azure.extensions` server parameter before `CREATE EXTENSION` works; the [pgvector how-to on Microsoft Learn](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-use-pgvector) covers that step. At the time of writing the managed service offers pgvector 0.7.0, while the upstream project shipped 0.8.0 in October 2024, so check which version your server reports before relying on newer features.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
    id          bigserial PRIMARY KEY,
    title       text NOT NULL,
    content     text NOT NULL,
    embedding   vector(1536) NOT NULL,
    content_tsv tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', content), 'B')
    ) STORED
);

CREATE INDEX documents_embedding_hnsw
    ON documents USING hnsw (embedding vector_cosine_ops);

CREATE INDEX documents_content_tsv_gin
    ON documents USING gin (content_tsv);
```

Two decisions here are worth calling out. The `tsvector` is a generated column, so it can never drift from the text, and the GIN index makes the keyword side cheap. Title terms get weight `A` so a match in the title outranks a match buried in the body. The HNSW index uses cosine operators because that is what `text-embedding-3-small` and most other embedding models are designed for.

One catch undercuts the opening premise if you leave it alone: the `english` configuration does not keep identifiers intact. The default parser splits `ERR_CONNECTION_REFUSED` on the underscores and the stemmer reduces it to `'err' & 'connect' & 'refus'`, so any page that mentions a refused connection matches, and the exact-string precision you wanted from keyword search is gone. If identifiers matter, add a second generated column with the `simple` configuration, which lowercases but does not stem or drop stop words, and match the identifier part of the query against it:

```sql
ALTER TABLE documents
    ADD COLUMN content_simple tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(title, '') || ' ' || content)
    ) STORED;

CREATE INDEX documents_content_simple_gin
    ON documents USING gin (content_simple);

-- Exact identifier match: the tokens must appear adjacent and in order
SELECT id, title
FROM documents
WHERE content_simple @@ phraseto_tsquery('simple', 'ERR_CONNECTION_REFUSED');
```

You can feed that as a third ranked list into the fusion below, or use it to boost rows where it matches. A `pg_trgm` similarity or plain equality check on a dedicated identifier column does the same job when identifiers live in structured fields rather than free text.

## The hybrid query

Each retriever takes its top candidates first (so the vector side can use the HNSW index), then numbers them, and a full outer join merges them so a document found by only one side still scores.

```sql
-- Named parameters are bound by psycopg: embedding, query, candidates,
-- vector_weight, keyword_weight, top_k
WITH vector_candidates AS (
    SELECT id, embedding <=> %(embedding)s AS distance
    FROM documents
    ORDER BY distance
    LIMIT %(candidates)s
),
vector_hits AS (
    SELECT id, row_number() OVER (ORDER BY distance) AS rank
    FROM vector_candidates
),
keyword_candidates AS (
    SELECT id,
           ts_rank_cd(content_tsv, websearch_to_tsquery('english', %(query)s)) AS score
    FROM documents
    WHERE content_tsv @@ websearch_to_tsquery('english', %(query)s)
    ORDER BY score DESC
    LIMIT %(candidates)s
),
keyword_hits AS (
    SELECT id, row_number() OVER (ORDER BY score DESC) AS rank
    FROM keyword_candidates
),
fused AS (
    SELECT coalesce(v.id, k.id) AS id,
           coalesce(%(vector_weight)s  / (60.0 + v.rank), 0) +
           coalesce(%(keyword_weight)s / (60.0 + k.rank), 0) AS rrf_score,
           v.rank AS vector_rank,
           k.rank AS keyword_rank
    FROM vector_hits v
    FULL OUTER JOIN keyword_hits k ON v.id = k.id
)
SELECT d.id, d.title, d.content, f.rrf_score, f.vector_rank, f.keyword_rank
FROM fused f
JOIN documents d ON d.id = f.id
ORDER BY f.rrf_score DESC
LIMIT %(top_k)s;
```

A few details matter more than they look:

- **`websearch_to_tsquery`** accepts what users actually type, including quoted phrases and `-exclusions`, and never throws a syntax error on stray punctuation. `plainto_tsquery` is safer than `to_tsquery` but ignores quotes.
- **Keep the rank columns.** Returning `vector_rank` and `keyword_rank` alongside the fused score is how you debug relevance later. When a result looks wrong, you can see which retriever put it there.
- **Join back to `documents` once**, after fusion, rather than carrying `content` through both CTEs. It keeps the intermediate rows small.

## Calling it from Python

This uses psycopg 3, the pgvector-python adapter and the `openai` 1.x SDK against Azure OpenAI. It is complete as shown apart from your resource names.

```python
import os
from pathlib import Path

import numpy as np
import psycopg
from psycopg.rows import dict_row
from openai import AzureOpenAI
from pgvector.psycopg import register_vector

# The hybrid query above, saved next to this script
HYBRID_SQL = (Path(__file__).parent / "hybrid_search.sql").read_text(encoding="utf-8")

openai_client = AzureOpenAI(
    azure_endpoint="https://<your-openai-resource>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2024-10-21",
)


def embed(text: str) -> np.ndarray:
    response = openai_client.embeddings.create(
        model="<your-embedding-deployment>",  # e.g. a text-embedding-3-small deployment
        input=text,
    )
    return np.array(response.data[0].embedding, dtype=np.float32)


def hybrid_search(
    conn: psycopg.Connection,
    query: str,
    top_k: int = 10,
    candidates: int = 40,
    vector_weight: float = 1.0,
    keyword_weight: float = 1.0,
) -> list[dict]:
    params = {
        "embedding": embed(query),
        "query": query,
        "candidates": candidates,
        "vector_weight": vector_weight,
        "keyword_weight": keyword_weight,
        "top_k": top_k,
    }
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(HYBRID_SQL, params)
        return cur.fetchall()


if __name__ == "__main__":
    dsn = (
        "host=<your-server>.postgres.database.azure.com dbname=<your-database> "
        "user=<your-user> sslmode=require"
    )  # password via the PGPASSWORD environment variable, or use a Microsoft Entra token
    with psycopg.connect(dsn) as conn:
        register_vector(conn)
        for row in hybrid_search(conn, "ERR_CONNECTION_REFUSED after failover"):
            print(f"{row['rrf_score']:.4f}  v={row['vector_rank']}  k={row['keyword_rank']}  {row['title']}")
```

## The traps

### The vector side returns fewer rows than you asked for

With an HNSW index, the number of candidates the index returns is bounded by `hnsw.ef_search`, which defaults to 40. Ask for `LIMIT 100` and you will still get roughly 40 back. If you add a `WHERE tenant_id = ...` filter to the vector CTE, it is applied *after* the index scan, so a selective filter can leave you with a handful of rows or none. The [pgvector README](https://github.com/pgvector/pgvector#filtering) documents this. Raise `hnsw.ef_search` for the session (`SET hnsw.ef_search = 100;`), add a partial index per large tenant, or partition. The iterative index scans in pgvector 0.8.0 address this properly, but only once your server runs that version.

### `ts_rank` is not BM25

PostgreSQL's built-in ranking functions consider term frequency and proximity but not inverse document frequency across the corpus. A common word that slipped past the stop-word list counts as much as a rare one. Because RRF only uses order, this hurts less than it would with score blending, but it is why keyword relevance in Postgres feels weaker than in a dedicated search engine. The [text search controls documentation](https://www.postgresql.org/docs/current/textsearch-controls.html) is candid about what the functions do and don't consider.

### Weights are a blunt instrument

Weighted RRF is easy to add, and it is tempting to let an LLM pick weights per query. I'd resist that. It adds a model call to every search, the weights it picks are not reproducible, and a fixed pair tuned on a labelled set usually gets you most of the benefit. If you genuinely have two query populations, a cheap rule (does the query contain a token that looks like an identifier?) is easier to reason about than a classifier.

## Measuring before tuning

You do not need a framework for this. Fifty to a hundred real queries with the IDs of the documents a subject-matter expert says should come back is enough to compare vector-only, keyword-only and hybrid.

```python
def recall_at_k(results: list[dict], relevant_ids: set[int], k: int) -> float:
    if not relevant_ids:
        return 0.0
    top_ids = {row["id"] for row in results[:k]}
    return len(top_ids & relevant_ids) / len(relevant_ids)


def mean_reciprocal_rank(results: list[dict], relevant_ids: set[int]) -> float:
    for position, row in enumerate(results, start=1):
        if row["id"] in relevant_ids:
            return 1 / position
    return 0.0
```

For the single-retriever baselines, don't just set one weight to zero. Rows found only by the zero-weighted side still come back with a score of 0 and fill the remaining `top_k` slots in arbitrary order, which flatters keyword-only recall whenever it has fewer than ten hits, and the "keyword-only" run still pays for an embedding call. Run the `vector_candidates` and `keyword_candidates` CTEs on their own as the baselines (or add `WHERE f.rrf_score > 0` to the final select), then compare against hybrid with both weights at 1.0. If hybrid doesn't beat the better of the two single retrievers on recall@10, the extra complexity isn't paying for itself on your data, and that is a perfectly good outcome to report.

## Postgres or a search service?

Doing hybrid search in PostgreSQL makes sense when the documents are already there, the corpus is in the hundreds of thousands rather than tens of millions, and you value transactional consistency between the source rows and what gets retrieved. One database to secure, back up and pay for is a real advantage.

I'd move to Azure AI Search when you need BM25 relevance, the semantic ranker, language analysers beyond what Postgres dictionaries offer, or retrieval that scales independently of your operational database. The trade-offs between the Azure options are in [Where Should Your Vectors Live on Azure?](/blog/2025-01-26-vector-databases-azure-comparison/).

Either way, the order of work is the same: build both retrievers, fuse with unweighted RRF, measure against real queries, and only then touch the knobs.
