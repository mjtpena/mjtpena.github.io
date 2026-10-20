---
title: "Hybrid Search in PostgreSQL: What It Costs to Own the Fusion"
description: "Azure AI Search and Cosmos DB fuse keyword and vector results for you; pgvector doesn't. What owning RRF in PostgreSQL involves, and when it pays."
author: Michael John Peña
draft: false
date: 2026-05-04
tags:
  - RAG
  - Hybrid Search
  - PostgreSQL
  - pgvector
  - Cosmos DB
---

Most hybrid search advice quietly assumes a search engine that fuses keyword and vector results for you. Plenty of RAG systems don't have one. Their chunks live in Azure Database for PostgreSQL next to the application data, embeddings sit in a pgvector column, and "add hybrid search" turns into a second ranking system the team has to write, tune and keep correct. That's a different decision from flipping a parameter, and the bar for making it should be different too.

In [Hybrid Search for RAG: Test What the BM25 Leg Rescues](/blog/2026-04-12-what-improved-my-rag-pipeline-deciding-where-hybrid-search-is-worth-the-complexity/) I covered how to measure whether the keyword leg earns its place on Azure AI Search. This post is about the step before that: where the fusion lives decides most of the cost, and if it lives in your own SQL, the bar for adopting hybrid should be higher.

## Where the fusion lives

As of May 2026 there are three common places to run hybrid retrieval on Azure, and they put very different amounts of work on you.

| Store | Keyword ranking | Fusion | What you own |
|---|---|---|---|
| Azure AI Search | BM25 | Built-in [Reciprocal Rank Fusion](https://learn.microsoft.com/azure/search/hybrid-search-ranking), vector weights GA | Analysers, searchable fields, weights |
| Azure Cosmos DB for NoSQL | BM25 via `FullTextScore` | `ORDER BY RANK RRF(...)` with an optional weights array | Full-text and vector policies on the container |
| Azure Database for PostgreSQL | `ts_rank` / `ts_rank_cd` (not BM25) | None; you write it | Everything: both queries, candidate depth, fusion, scoring |

Cosmos DB's full-text and hybrid search [went GA at Microsoft Build on 19 May 2025](https://devblogs.microsoft.com/cosmosdb/new-generally-available-and-preview-search-capabilities-in-azure-cosmos-db-for-nosql/), so if your RAG data is already in a Cosmos DB for NoSQL container, hybrid search is a query change plus a full-text index, not a project. One caveat: the vector embedding policy and full-text policy are part of the container definition, so design them before you load data rather than planning to bolt them on later.

PostgreSQL is the odd one out, and it's also where many line-of-business RAG systems end up, because the documents already live there and nobody wants a second store to keep in sync.

## What you take on in PostgreSQL

**The keyword leg isn't BM25.** PostgreSQL's built-in ranking functions score each document on its own term frequencies, proximity and structure. Neither `ts_rank` nor `ts_rank_cd` uses corpus-wide statistics such as inverse document frequency, so a rare product code and a common word that both match are weighted far more evenly than BM25 would weight them. Rare terms are exactly where the keyword leg is supposed to help. With RRF only the rank order matters, but the order is what this changes.

**Tokenisation is yours to check.** The text search configuration (`english`, `simple` and so on) decides what happens to identifiers, hyphenated codes and acronyms. Before assuming the keyword leg will catch `INV-20391`, run `ts_debug('english', 'INV-20391')` and look at the lexemes it actually produces. Under `english` it splits into `inv` and the signed integer `-20391`, so the query becomes `'inv' <-> '-20391'`. A user who types just `20391` produces the lexeme `20391`, which doesn't match `-20391`. If that's not what users type, you need a different configuration or a dedicated column for identifiers.

**Candidate depth has a hidden cap.** pgvector's HNSW index returns at most `hnsw.ef_search` rows per scan, and the default is 40. Ask the vector leg for 50 candidates without raising it and you'll get 40, with no error. Filters make this worse: a `WHERE tenant_id = ...` applied after an approximate scan can leave you with far fewer rows. pgvector 0.8.0 added iterative index scans (`hnsw.iterative_scan`) to deal with that, and Azure Database for PostgreSQL has supported 0.8.0 since May 2025 (see the [release notes](https://learn.microsoft.com/azure/postgresql/flexible-server/release-notes)), but you have to turn them on.

**The fusion is your code.** Ranks, the `k` constant, weights, ties, and what happens when one leg returns nothing are all decisions in a SQL statement that somebody has to own and test.

**Two indexes to keep healthy.** A GIN index on the `tsvector` and an HNSW index on the embedding. Both grow with every chunk. Bulk re-embedding is usually done by dropping and rebuilding the HNSW index, and that build is memory-hungry: it needs `maintenance_work_mem` (and `max_parallel_maintenance_workers`) sized for it.

None of these show up in a ten-question demo; all of them show up the first time a filter or a product code hits production.

## A fusion query you can own

If you do build it, keep the fusion in one SQL statement so it's reviewable and testable. This schema keeps the `tsvector` as a generated column, so it can't drift from the text. On Azure Database for PostgreSQL, allow-list the `vector` extension in the `azure.extensions` server parameter before running it.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunks (
    id          bigint PRIMARY KEY,
    parent_id   text   NOT NULL,
    content     text   NOT NULL,
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    embedding   vector(1536) NOT NULL
);

CREATE INDEX chunks_tsv_idx ON chunks USING gin (content_tsv);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
```

The script below embeds the question with an Azure OpenAI `text-embedding-3-small` deployment through the v1 API ([GA since August 2025](https://learn.microsoft.com/azure/ai-foundry/openai/api-version-lifecycle), so it uses the standard `OpenAI` client; passing a token provider as `api_key` needs `openai` 1.106.0 or later), runs both legs, and fuses them with RRF. It returns each leg's rank alongside the fused score, which is the column you'll want when you're debugging why a chunk moved.

```python
# hybrid_pg.py
# pip install "psycopg[binary]" pgvector numpy "openai>=1.106" azure-identity
import os

import numpy as np
import psycopg
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import OpenAI
from pgvector.psycopg import register_vector

# No password in here: with Microsoft Entra auth the password is an access token (fetched below);
# with password auth, leave it to PGPASSWORD or ~/.pgpass.
PG_CONNINFO = os.environ["PG_CONNINFO"]  # e.g. "host=<your-server>.postgres.database.azure.com dbname=<db> user=<entra-user-or-group> sslmode=require"
PG_ENTRA_SCOPE = "https://ossrdbms-aad.database.windows.net/.default"
EMBEDDING_DEPLOYMENT = "<your-embedding-deployment>"  # a text-embedding-3-small deployment (1536 dimensions)
CANDIDATES = 50  # rows each leg contributes to fusion
TOP = 5  # chunks sent to the model
RRF_K = 60  # rank-smoothing constant used by Azure AI Search and most RRF write-ups
KEYWORD_WEIGHT = 1.0
VECTOR_WEIGHT = 1.0

credential = DefaultAzureCredential()
token_provider = get_bearer_token_provider(
    credential, "https://cognitiveservices.azure.com/.default"
)
llm = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,
)

HYBRID_SQL = """
WITH keyword AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC, id) AS rank
    FROM (
        SELECT c.id, ts_rank_cd(c.content_tsv, q) AS score
        -- websearch_to_tsquery ANDs every term; swap to OR so partial matches still rank
        FROM chunks c,
             CAST(replace(websearch_to_tsquery('english', %(question)s)::text, ' & ', ' | ') AS tsquery) AS q
        WHERE c.content_tsv @@ q
        ORDER BY score DESC, c.id
        LIMIT %(candidates)s
    ) kw
),
vector AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY distance, id) AS rank
    FROM (
        SELECT c.id, c.embedding <=> %(embedding)s AS distance
        FROM chunks c
        ORDER BY distance
        LIMIT %(candidates)s
    ) vec
)
SELECT id, parent_id, keyword_rank, vector_rank, rrf_score
FROM (
    SELECT
        c.id,
        c.parent_id,
        k.rank AS keyword_rank,
        v.rank AS vector_rank,
        COALESCE(%(kw_weight)s / (%(rrf_k)s + k.rank), 0.0)
          + COALESCE(%(vec_weight)s / (%(rrf_k)s + v.rank), 0.0) AS rrf_score
    FROM keyword k
    FULL OUTER JOIN vector v ON v.id = k.id
    JOIN chunks c ON c.id = COALESCE(k.id, v.id)
) fused
-- with one weight set to 0, drop the other leg's rows instead of letting them pad the top results
WHERE rrf_score > 0
ORDER BY rrf_score DESC, id
LIMIT %(top)s;
"""


def embed(text: str) -> np.ndarray:
    response = llm.embeddings.create(model=EMBEDDING_DEPLOYMENT, input=text)
    return np.array(response.data[0].embedding, dtype=np.float32)


def hybrid_search(conn: psycopg.Connection, question: str) -> list[tuple]:
    with conn.cursor() as cur:
        # HNSW returns at most ef_search rows per scan; the default of 40 would cap CANDIDATES.
        # pgvector rejects values above 1000, so clamp it.
        cur.execute("SELECT set_config('hnsw.ef_search', %s, false)", (str(min(max(CANDIDATES * 2, 100), 1000)),))
        # Filters and RLS policies apply after the HNSW scan; keep scanning until enough rows survive (pgvector 0.8.0+)
        cur.execute("SELECT set_config('hnsw.iterative_scan', 'relaxed_order', false)")
        cur.execute(
            HYBRID_SQL,
            {
                "question": question,
                "embedding": embed(question),
                "candidates": CANDIDATES,
                "top": TOP,
                "rrf_k": RRF_K,
                "kw_weight": KEYWORD_WEIGHT,
                "vec_weight": VECTOR_WEIGHT,
            },
        )
        return cur.fetchall()


if __name__ == "__main__":
    pg_token = credential.get_token(PG_ENTRA_SCOPE).token
    with psycopg.connect(PG_CONNINFO, password=pg_token) as conn:
        register_vector(conn)
        for chunk_id, parent_id, kw_rank, vec_rank, score in hybrid_search(
            conn, "What is the refund window for INV-20391?"
        ):
            print(f"{score:.4f}  kw={kw_rank}  vec={vec_rank}  {parent_id}#{chunk_id}")
```

A few choices in there are deliberate:

- **Each leg is limited inside a subquery before ranks are assigned**, so the window function never sorts the whole table and the HNSW index still serves the vector leg.
- **The keyword leg turns the query into an OR of its terms.** `websearch_to_tsquery` on its own ANDs every non-stop-word term, so the example question only matches chunks containing "refund", "window" and the invoice number, and the leg returns nothing in exactly the case it's meant to rescue. With OR, `ts_rank_cd` still favours chunks that match more terms, which is closer to how BM25 engines behave (Azure AI Search's default `searchMode` is `any`).
- **The `FULL OUTER JOIN` with `COALESCE`** means a question made entirely of stop words, where the keyword leg returns nothing, degrades to vector-only instead of returning an empty list.
- **`WHERE rrf_score > 0` keeps single-leg runs honest.** When one weight is 0, the other leg's rows still come through the join with a score of 0, and they would fill out the top results whenever the remaining leg returns fewer than `TOP` rows.
- **The `id` tie-breakers make the keyword leg and the fusion step repeatable**, which matters the moment you put this behind a regression test. The vector leg is only as repeatable as the index: HNSW is approximate, and `relaxed_order` can return rows slightly out of distance order, so pin your regression test to the fused output on a fixed index rather than to exact vector ranks.

The OR rewrite is a text substitution, and it assumes plain conversational input. If users type websearch syntax, a negated `-foo` becomes `| !'foo'`, which matches nearly every row. If they might, build the OR query from the lexemes themselves (`tsvector_to_array(to_tsvector('english', ...))`), or extract identifiers into their own `tsquery` and keep AND semantics for prose.

Connection details come from an environment variable, and both the database and the model call authenticate with Microsoft Entra ID tokens, so there's no key or password in the code. Entra tokens expire after about an hour, so a long-running service should fetch a fresh one per connection (or use a pool that does).

As on any RRF system, `rrf_score` isn't something you can threshold for abstention. It reflects positions, not similarity. If your grounding gate needs a cut-off, keep it on the vector distance or move it to a reranker, such as [`azure_ai.rank()`](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-azure-ai-semantic-operators) in the `azure_ai` extension (preview, using a Cohere Rerank v3.5 deployment by default or a GPT model you deploy in Microsoft Foundry), which keeps reranking inside the database.

## When I'd build it, and when I wouldn't

I'd build hybrid in PostgreSQL when the labelled questions show the vector leg missing on identifiers, names or internal jargon, the data has to stay in PostgreSQL for transactional or access-control reasons, and someone on the team will own the SQL above the same way they own any other query in production. Row-level security is the strongest reason here: retrieval that runs as the user's role in the same database inherits the permissions you already enforce, which is hard to replicate in a separate search index. RLS policies behave like a post-filter on the HNSW scan, though, so set `hnsw.iterative_scan = relaxed_order` (pgvector 0.8.0+) when retrieval runs under RLS, as `hybrid_search()` does above; otherwise the vector leg can return far fewer than `CANDIDATES` rows.

I wouldn't build it when:

- **The corpus is clean prose and users ask natural-language questions.** Embeddings already handle paraphrase; the keyword leg mostly adds noise and maintenance.
- **You haven't run the comparison.** Without a labelled set showing rescued questions outnumbering diluted ones, you're adding a ranking system on faith. The [three-way test](/blog/2026-04-12-what-improved-my-rag-pipeline-deciding-where-hybrid-search-is-worth-the-complexity/) works the same way against this query: run it with `KEYWORD_WEIGHT = 0`, with `VECTOR_WEIGHT = 0`, and with both; the zero-score filter makes each single-leg run a clean one.
- **The data is already in Cosmos DB for NoSQL.** Use its native RRF rather than exporting to something you then fuse yourself.
- **You need BM25-quality ranking and per-field analysers.** At that point you're rebuilding a search engine in SQL. Reranking alone isn't the reason to leave, since `azure_ai.rank()` covers it in-database (in preview), but BM25 and analysers aren't coming to `ts_rank`. BM25 extensions for PostgreSQL do exist, such as the open-source [`pg_textsearch`](https://www.postgresql.org/about/news/pg_textsearch-v10-3264/) (v1.0 since April 2026), but it isn't available on Azure Database for PostgreSQL flexible server, and Azure HorizonDB is a separate PostgreSQL service still in preview. Azure AI Search, fed through its push API from the application or a logical-replication/CDC pipeline (there's no built-in PostgreSQL indexer), is the cheaper system to own even with the extra store, and its hybrid behaviour is documented and tested by someone else.

## The decision

Hybrid search is rarely the expensive part when the platform fuses for you. In PostgreSQL the fusion, the keyword ranking quality and the candidate limits are all your code, so the evidence bar should be higher: a labelled set that shows the keyword leg rescuing questions vectors miss, and a named owner for the query. If you have both, one reviewed SQL statement with per-leg ranks, covered by a regression test on that labelled set, is enough to run in production. If you don't, stay vector-only and spend the effort on chunking, or move retrieval to a store that does the fusion for you.
