---
title: "PostgreSQL with pgvector: Open Source Vector Search"
description: "pgvector enables AI-ready applications using familiar PostgreSQL infrastructure."
author: Michael John Peña
draft: false
date: 2025-04-17
tags:
  - PostgreSQL
  - pgvector
  - Vector
  - Database
  - Open Source
---

## pgvector Implementation

```python
import psycopg2
from psycopg2.extras import execute_values
import numpy as np
from typing import List, Tuple

class PgVectorStore:
    def __init__(self, connection_string: str):
        self.conn = psycopg2.connect(connection_string)
        self.setup_extension()

    def setup_extension(self):
        """Enable pgvector extension."""
        with self.conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            self.conn.commit()

    def create_table(self, table_name: str, dimensions: int = 1536):
        """Create table with vector column."""
        with self.conn.cursor() as cur:
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    id SERIAL PRIMARY KEY,
                    content TEXT NOT NULL,
                    embedding vector({dimensions}),
                    metadata JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Create HNSW index for fast similarity search
            cur.execute(f"""
                CREATE INDEX IF NOT EXISTS {table_name}_embedding_idx
                ON {table_name}
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64)
            """)

            self.conn.commit()

    def insert_documents(self, table_name: str, documents: List[Tuple[str, List[float], dict]]):
        """Bulk insert documents with embeddings."""
        with self.conn.cursor() as cur:
            execute_values(
                cur,
                f"""
                INSERT INTO {table_name} (content, embedding, metadata)
                VALUES %s
                """,
                [(doc[0], doc[1], json.dumps(doc[2])) for doc in documents],
                template="(%s, %s::vector, %s::jsonb)"
            )
            self.conn.commit()

    def similarity_search(
        self,
        table_name: str,
        query_embedding: List[float],
        top_k: int = 10,
        filter_metadata: dict = None
    ) -> List[dict]:
        """Perform similarity search."""
        with self.conn.cursor() as cur:
            query = f"""
                SELECT
                    id,
                    content,
                    metadata,
                    1 - (embedding <=> %s::vector) AS similarity
                FROM {table_name}
            """

            params = [query_embedding]

            if filter_metadata:
                conditions = []
                for key, value in filter_metadata.items():
                    conditions.append(f"metadata->>'{key}' = %s")
                    params.append(value)
                query += " WHERE " + " AND ".join(conditions)

            query += f"""
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """
            params.extend([query_embedding, top_k])

            cur.execute(query, params)
            results = cur.fetchall()

            return [
                {
                    "id": r[0],
                    "content": r[1],
                    "metadata": r[2],
                    "similarity": r[3]
                }
                for r in results
            ]

    def hybrid_search(
        self,
        table_name: str,
        text_query: str,
        query_embedding: List[float],
        top_k: int = 10
    ) -> List[dict]:
        """Combine full-text and vector search."""
        with self.conn.cursor() as cur:
            cur.execute(f"""
                WITH vector_results AS (
                    SELECT id, content, metadata,
                           1 - (embedding <=> %s::vector) AS vector_score
                    FROM {table_name}
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                ),
                text_results AS (
                    SELECT id, content, metadata,
                           ts_rank(to_tsvector('english', content),
                                  plainto_tsquery('english', %s)) AS text_score
                    FROM {table_name}
                    WHERE to_tsvector('english', content) @@
                          plainto_tsquery('english', %s)
                    LIMIT %s
                )
                SELECT COALESCE(v.id, t.id) AS id,
                       COALESCE(v.content, t.content) AS content,
                       COALESCE(v.vector_score, 0) + COALESCE(t.text_score, 0) AS score
                FROM vector_results v
                FULL OUTER JOIN text_results t ON v.id = t.id
                ORDER BY score DESC
                LIMIT %s
            """, [query_embedding, query_embedding, top_k * 2,
                  text_query, text_query, top_k * 2, top_k])

            return [{"id": r[0], "content": r[1], "score": r[2]} for r in cur.fetchall()]
```

pgvector enables AI-ready applications using familiar PostgreSQL infrastructure.
