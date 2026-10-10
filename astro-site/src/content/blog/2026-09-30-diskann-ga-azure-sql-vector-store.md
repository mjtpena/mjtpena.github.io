---
title: "DiskANN in Azure SQL Is GA: Do You Still Need a Separate Vector Store?"
description: "DiskANN vector indexes are now GA in Azure SQL and Fabric SQL. When embeddings belong next to your rows, and when Azure AI Search still wins."
author: Michael John Peña
draft: false
date: 2026-09-30
tags:
  - Azure
  - SQL
  - Vector Search
  - RAG
  - Azure AI Search
  - Architecture
---

Most RAG systems over business data have the same awkward shape: the facts live in a SQL database, the embeddings live in a vector store, and a pipeline sits in between trying to keep them in step. That pipeline is where stale answers, orphaned chunks and accidental data exposure come from. With DiskANN vector indexes now generally available in Azure SQL, the question I'd ask on every new design is whether that second store needs to exist at all.

## What went GA

Microsoft [announced this week at SQLCon Barcelona](https://www.microsoft.com/en-us/sql-server/blog/2026/09/28/sqlcon-barcelona-2026-advancing-sql-with-greater-control-scale-and-intelligence/) that DiskANN vector indexes and vector search are generally available in Azure SQL Database, SQL database in Microsoft Fabric, and Azure SQL Managed Instance on the **Always-up-to-date** update policy. SQL Server 2025 and Managed Instance on the **SQL Server 2025** update policy still treat vector indexes and `VECTOR_SEARCH` as preview, behind the `PREVIEW_FEATURES` database scoped configuration. If you run Managed Instance, check which update policy you're on before you plan around this.

The GA version of the index (version 3, per [CREATE VECTOR INDEX](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-vector-index-transact-sql?view=azuresqldb-current)) fixes the three things that made the preview hard to use for anything live:

- **Full DML.** Earlier indexes made the table read-only unless you opted into stale results with `ALLOW_STALE_VECTOR_INDEX`. Now `INSERT`, `UPDATE`, `DELETE` and `MERGE` work. Changes are visible to vector search after commit, and a background task folds them into the DiskANN graph asynchronously.
- **Iterative filtering.** `WHERE` predicates are applied during the graph search, not after it. The old behaviour returned the top N neighbours and then filtered them, so a selective filter could leave you with three rows or none. Now the engine keeps searching until it finds N qualifying rows or runs out.
- **An optimiser that chooses.** With `SELECT TOP (N) WITH APPROXIMATE`, the optimiser decides between the DiskANN index and an exact kNN scan based on the query. A tight filter that leaves a few thousand candidates can just be scanned exactly, which is both faster and perfectly accurate.

There's a migration catch. Indexes built during the preview stay on the earlier format until you drop and recreate them, and the version 3 index rejects the old `TOP_N` parameter with error 42274. The earlier format is deprecated, so do the rebuild now, in a maintenance window, because approximate search on that table is unavailable until the new index finishes building.

## The case for keeping vectors next to the rows

The argument for a separate vector database used to be capability: SQL couldn't do approximate search at scale, or could only do it on frozen tables. That's no longer true for Azure SQL Database, SQL database in Fabric and Managed Instance on the Always-up-to-date policy, so the argument has to be made on architecture. For RAG over operational data, I think the architecture argument now points the other way.

### You delete a sync pipeline

When a product description, a policy clause or a support case changes, the embedding needs to change with it. With an external store, that means change data capture or a scheduled job, a queue, an embedding call, an upsert, and a reconciliation process for when any of those fail. Each step has its own retry semantics and its own way of drifting.

With the embedding in a column on the same table, the update and the re-embedding can happen in the same transaction or the same stored procedure. Deletes are the bigger win. A deleted row's embedding is gone when the row is gone. When a bot keeps quoting a policy that was withdrawn months ago, an orphaned chunk in a vector index nobody reconciled is the first place I'd look.

### You delete a security boundary

Every copy of your data is another place you have to secure, audit and include in your retention policy. A separate vector store usually holds chunk text as well as embeddings, so it's a full copy of sensitive content with its own identity model, its own network rules and its own access logs. Getting document-level security right in that copy is a project in itself.

When the vectors stay in Azure SQL, they inherit what the database already has: Entra authentication, `GRANT`s on the table, private endpoints, auditing, TDE, backup and point-in-time restore. Filtering by tenant or classification is a `WHERE` clause, and iterative filtering means that clause no longer costs you recall. If you rely on row-level security, test that your security predicates behave the way you expect with `VECTOR_SEARCH` before you depend on them; I'd want that in an automated test either way.

### Joins come for free

Retrieval for operational RAG is rarely "nearest chunks, full stop". It's "nearest chunks from active contracts for this customer, plus the contract's renewal date". In SQL that's one query. Against a separate store, it's a vector call, then a SQL call, then a merge in application code.

## What it looks like

A minimal table and index. The table needs a clustered primary key on an `int` column, and the index can't be created until there are at least 100 rows with non-`NULL` vectors.

```sql
CREATE TABLE dbo.PolicyChunks
(
    chunk_id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PolicyChunks PRIMARY KEY CLUSTERED,
    policy_id       INT            NOT NULL,
    tenant_id       INT            NOT NULL,
    is_current      BIT            NOT NULL,
    chunk_text      NVARCHAR(MAX)  NOT NULL,
    embedding       VECTOR(1536)   NULL
);

-- B-tree index on the columns you filter by; iterative filtering can use it.
CREATE NONCLUSTERED INDEX IX_PolicyChunks_Tenant
    ON dbo.PolicyChunks (tenant_id, is_current);

-- Run after loading at least 100 rows with embeddings.
CREATE VECTOR INDEX VIX_PolicyChunks_Embedding
    ON dbo.PolicyChunks (embedding)
    WITH (METRIC = 'cosine', TYPE = 'DiskANN');
```

The retrieval query, with the query embedding passed in from your application as a JSON array string (this is a fragment: `@query_embedding` and `@tenant_id` are parameters):

```sql
DECLARE @qv VECTOR(1536) = CAST(@query_embedding AS VECTOR(1536));

SELECT TOP (8) WITH APPROXIMATE
    c.chunk_id,
    c.policy_id,
    c.chunk_text,
    r.distance
FROM VECTOR_SEARCH(
        TABLE      = dbo.PolicyChunks AS c,
        COLUMN     = embedding,
        SIMILAR_TO = @qv,
        METRIC     = 'cosine'
     ) AS r
WHERE c.tenant_id = @tenant_id
  AND c.is_current = 1
ORDER BY r.distance;
```

Two rules from the [VECTOR_SEARCH reference](https://learn.microsoft.com/en-us/sql/t-sql/functions/vector-search-transact-sql?view=azuresqldb-current) catch people out. `ORDER BY` must be on the distance column only, ascending. Anything else, such as `GROUP BY`, window functions or a secondary sort, goes in an outer query around this one. And `VECTOR_SEARCH` can't be used inside a view. If you want to force the index even when the optimiser would pick a scan, there's a `WITH (FORCE_ANN_ONLY)` table hint, but I'd only use it after a measured reason.

Because maintenance is asynchronous, monitor it. [sys.dm_db_vector_indexes](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-db-vector-indexes-transact-sql?view=azuresqldb-current) reports how far behind the graph is:

```sql
SELECT
    OBJECT_SCHEMA_NAME(v.object_id)   AS schema_name,
    OBJECT_NAME(v.object_id)          AS table_name,
    i.name                            AS vector_index_name,
    v.graph_catchup_pending_percent,
    v.last_background_task_execution_time,
    v.last_background_task_succeeded,
    v.last_background_task_error_message
FROM sys.dm_db_vector_indexes AS v
INNER JOIN sys.indexes AS i
    ON i.object_id = v.object_id
   AND i.index_id  = v.index_id
WHERE v.graph_catchup_pending_percent > 15
   OR v.last_background_task_succeeded = 0;
```

Recent rows are still searchable while catch-up runs, but they can't benefit fully from graph navigation, so recall and latency can dip under a big backlog. A number that rises during a batch load and returns to zero is normal. A number that never comes down, or a failed task, deserves an alert, which is what the filter above is for; the 15% threshold comes from the docs' own example, so tune it to your load pattern. If you re-embed the whole table with a new model, drop and recreate the index after the load: the docs warn that a graph built for the old embedding distribution can degrade recall and ranking even though queries still return valid results.

## Where Azure AI Search still wins

None of this makes [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/search-what-is-azure-search) redundant. It makes it a choice you should justify. These are the cases where I'd still pick it.

| Need | Azure SQL with DiskANN | Azure AI Search |
|---|---|---|
| Hybrid keyword and vector ranking | Build it yourself: full-text search plus vector search, fused with your own RRF query | Built in, with RRF fusion of BM25 and vector results in one request |
| Semantic reranking | Not built in; call a reranker from the app or via `sp_invoke_external_rest_endpoint` | Semantic ranker is a query option |
| Many sources in one index | Only what's in that database | Indexers and skillsets pull from Blob, Cosmos DB, Azure SQL, SharePoint (preview) and more |
| Freshness and transactional consistency | Same table, same transaction | Depends on your indexer schedule or push pipeline |
| Security model | Database permissions, filters as `WHERE` clauses | Separate service with its own access model and security trimming design |

**Hybrid ranking.** If your users search for part numbers, error codes, product names or legal clause references, pure vector search will miss exact matches that keyword search finds instantly. You can do hybrid in SQL with `FREETEXTTABLE` and a hand-written Reciprocal Rank Fusion, and [Microsoft has published that pattern](https://github.com/Azure-Samples/azure-sql-db-vector-search/tree/main/DiskANN/Wikipedia). In SQL database in Fabric, full-text search is still a preview feature, so check that before you plan hybrid there. But you own the fusion logic, the tuning, and the full-text configuration. AI Search gives you a tuned version in one call.

**Semantic reranking.** For document-heavy corpora where the top 50 candidates are all plausible, a reranker often matters more than the retrieval method. Azure SQL doesn't have one, so you'd be adding a model call and its latency yourself, whether from the app or from T-SQL with `sp_invoke_external_rest_endpoint`.

**Multi-source indexing.** If the knowledge base is PDFs in Blob Storage, pages in SharePoint and a product table, the vectors don't have rows to live next to. That's a search problem, not a database problem, and an indexer pipeline with chunking and enrichment is the right tool.

## What it costs you

The trade for deleting the pipeline is that vector search and DiskANN catch-up now compete with your transactional workload for CPU, memory and log. A spike in RAG traffic, or a bulk re-embed, lands on the same database that processes orders. Size the database for both workloads, and on Hyperscale or Business Critical consider sending retrieval traffic to a read replica with `ApplicationIntent=ReadOnly` so a busy assistant can't slow the checkout. If you can't isolate the load and the OLTP side is already near its limits, that alone is a fair reason to keep retrieval in a separate service.

## How I'd decide

Start from where the source of truth lives. If the content you retrieve is rows in Azure SQL, or SQL database in Fabric, and it changes through your application, keep the embeddings in the same table and use DiskANN. You remove a pipeline, a copy of sensitive data and a class of consistency bugs, and the cost is learning a few query rules. My [comparison of vector databases](/blog/2026-01-11-vector-databases-comparison/) earlier this year already leaned towards pgvector when the relational data was in PostgreSQL; the same logic now applies to Azure SQL.

Reach for Azure AI Search when relevance needs hybrid keyword matching or reranking you don't want to build, or when the corpus spans sources a single database will never hold. And if you're already in SQL but suspect you need hybrid, measure first: whether hybrid is worth the complexity is a question for your evaluation set, not your architecture diagram. My earlier [comparison of vector options on Azure](/blog/2025-01-26-vector-databases-azure-comparison/) covers the wider field if neither fits.

The one thing I wouldn't do is keep a separate vector store out of habit. As of this GA, that's a pipeline you're choosing to run, and it should earn its place.
