---
title: "PostgreSQL in Microsoft Fabric: What to Expect"
author: "Michael John Peña"
draft: false
date: 2024-10-24
tags: ["PostgreSQL", "Microsoft Fabric", "Azure", "Database", "Preview"]

---

I wrote "PostgreSQL in Microsoft Fabric: What to Expect" to share practical, production-minded guidance on this topic.

## PostgreSQL in Fabric Overview

```python
"""
PostgreSQL in Fabric (Announced for future release):
- Managed PostgreSQL in Fabric workspace
- Automatic mirroring to OneLake
- Integration with Fabric analytics
- Unified governance
- Familiar PostgreSQL experience
"""

# Expected capabilities based on announcements
EXPECTED_FEATURES = {
    "engine": "PostgreSQL 16+",
    "extensions": [
        "PostGIS",
        "pgvector",
        "pg_stat_statements",
        "uuid-ossp",
        "hstore"
    ],
    "fabric_integration": [
        "OneLake mirroring",
        "Shortcut support",
        "Unified security",
        "Copilot integration"
    ]
}
```

## Preparing for PostgreSQL in Fabric

```python
# Current: Azure Database for PostgreSQL
# Future: PostgreSQL in Fabric

import psycopg2
from azure.identity import DefaultAzureCredential

class PostgreSQLConnection:
    """Connection helper for PostgreSQL"""

    def __init__(self, host: str, database: str, use_aad: bool = True):
        self.host = host
        self.database = database
        self.use_aad = use_aad
        self.credential = DefaultAzureCredential() if use_aad else None

    def get_connection(self, user: str = None, password: str = None):
        """Get PostgreSQL connection"""

        if self.use_aad:
            # AAD authentication (expected in Fabric)
            token = self.credential.get_token(
                "https://ossrdbms-aad.database.windows.net/.default"
            )
            return psycopg2.connect(
                host=self.host,
                database=self.database,
                user="aad_user@tenant",
                password=token.token,
                sslmode="require"
            )
        else:
            return psycopg2.connect(
                host=self.host,
                database=self.database,
                user=user,
                password=password
            )

    def execute(self, query: str, params: tuple = None):
        """Execute query and return results"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(query, params)

            if cursor.description:
                columns = [col[0] for col in cursor.description]
                results = [dict(zip(columns, row)) for row in cursor.fetchall()]
                return results

            conn.commit()
            return cursor.rowcount

        finally:
            cursor.close()
            conn.close()
```

## PostgreSQL Patterns for Fabric

```sql
-- Schema design optimized for Fabric mirroring
CREATE SCHEMA analytics;

-- Use native PostgreSQL types that map well to Delta
CREATE TABLE analytics.events (
    event_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(50) NOT NULL,
    user_id UUID,
    properties JSONB,
    -- Mirroring-friendly timestamp
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for OLTP performance
CREATE INDEX idx_events_user ON analytics.events(user_id);
CREATE INDEX idx_events_time ON analytics.events(event_time);
CREATE INDEX idx_events_type ON analytics.events(event_type);

-- JSONB index for property queries
CREATE INDEX idx_events_properties ON analytics.events USING GIN (properties);

-- Trigger for updated_at (important for change tracking)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_update_timestamp
    BEFORE UPDATE ON analytics.events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

## Vector Search with pgvector

```sql
-- pgvector for AI/ML workloads
-- Expected to be supported in Fabric PostgreSQL

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings.documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(1536),  -- OpenAI embedding dimension
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create vector index
CREATE INDEX ON embeddings.documents
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Similarity search function
CREATE OR REPLACE FUNCTION search_similar_documents(
    query_embedding vector(1536),
    match_count INT DEFAULT 10
)
RETURNS TABLE (
    id INT,
    content TEXT,
    similarity FLOAT
)
LANGUAGE SQL STABLE AS $$
    SELECT
        id,
        content,
        1 - (embedding <=> query_embedding) as similarity
    FROM embeddings.documents
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$;
```

## Python Integration with pgvector

```python
import psycopg2
from pgvector.psycopg2 import register_vector
import numpy as np
from openai import OpenAI

class VectorStore:
    """Vector store using PostgreSQL pgvector"""

    def __init__(self, db_conn):
        self.conn = db_conn
        register_vector(self.conn)
        self.openai = OpenAI()

    def embed_text(self, text: str) -> list:
        """Get embedding for text"""
        response = self.openai.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding

    def add_document(self, content: str, metadata: dict = None):
        """Add document to vector store"""
        embedding = self.embed_text(content)

        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO embeddings.documents (content, embedding, metadata)
            VALUES (%s, %s, %s)
            RETURNING id
        """, (content, embedding, metadata))

        self.conn.commit()
        return cursor.fetchone()[0]

    def search(self, query: str, limit: int = 10) -> list:
        """Search for similar documents"""
        query_embedding = self.embed_text(query)

        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT id, content, 1 - (embedding <=> %s) as similarity
            FROM embeddings.documents
            ORDER BY embedding <=> %s
            LIMIT %s
        """, (query_embedding, query_embedding, limit))

        columns = ['id', 'content', 'similarity']
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
```

## Migration Planning

```python
class FabricPostgreSQLMigration:
    """Plan migration to Fabric PostgreSQL"""

    def __init__(self):
        self.compatibility_checks = []
        self.recommendations = []

    def assess_database(self, conn) -> dict:
        """Assess database for Fabric compatibility"""

        cursor = conn.cursor()

        # Check extensions
        cursor.execute("SELECT extname FROM pg_extension")
        extensions = [row[0] for row in cursor.fetchall()]

        # Check table sizes
        cursor.execute("""
            SELECT schemaname, tablename,
                   pg_total_relation_size(schemaname || '.' || tablename) as size
            FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY size DESC
            LIMIT 20
        """)
        large_tables = cursor.fetchall()

        # Check for unsupported features (speculation)
        # These may change when Fabric PostgreSQL is released

        assessment = {
            "extensions": extensions,
            "large_tables": large_tables,
            "compatibility": "likely_compatible",
            "recommendations": []
        }

        # Add recommendations
        if "timescaledb" in extensions:
            assessment["recommendations"].append(
                "TimescaleDB may require migration to native partitioning"
            )

        if any(size > 100 * 1024 * 1024 * 1024 for _, _, size in large_tables):
            assessment["recommendations"].append(
                "Large tables may benefit from partitioning before migration"
            )

        return assessment

    def generate_migration_plan(self, assessment: dict) -> list:
        """Generate migration steps"""
        steps = [
            {
                "step": 1,
                "action": "Audit and document current database",
                "details": "Export schema, extensions, and configurations"
            },
            {
                "step": 2,
                "action": "Review Fabric PostgreSQL feature support",
                "details": "Verify all required extensions and features"
            },
            {
                "step": 3,
                "action": "Create Fabric workspace and database",
                "details": "Set up Fabric environment"
            },
            {
                "step": 4,
                "action": "Migrate schema",
                "details": "Create tables, indexes, functions"
            },
            {
                "step": 5,
                "action": "Migrate data",
                "details": "Use pg_dump/pg_restore or streaming replication"
            },
            {
                "step": 6,
                "action": "Verify mirroring",
                "details": "Confirm data appears in OneLake"
            },
            {
                "step": 7,
                "action": "Update application connections",
                "details": "Point applications to Fabric endpoint"
            },
            {
                "step": 8,
                "action": "Validate and cutover",
                "details": "Run validation queries and switch traffic"
            }
        ]

        return steps
```

## Expected OneLake Integration

```python
# Expected: PostgreSQL data mirrored to OneLake
# Similar to SQL Database in Fabric

# In PySpark (expected pattern)
"""
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# Read mirrored PostgreSQL data
events_df = spark.read.format("delta").load(
    "abfss://workspace@onelake.dfs.fabric.microsoft.com/"
    "PostgresDB.Database/Tables/analytics/events"
)

# JSONB columns expected to be stored as JSON strings
# May need parsing in Spark
from pyspark.sql.functions import from_json, schema_of_json

# Parse JSONB properties
events_with_props = events_df.withColumn(
    "parsed_properties",
    from_json("properties", schema_of_json(sample_json))
)
"""
```

PostgreSQL in Fabric will bring familiar PostgreSQL capabilities to the unified data platform. Start preparing now by designing schemas that work well with automatic mirroring.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
