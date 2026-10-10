---
title: "LLM-Drafted Data Dictionaries: Profile First, Describe Second"
description: "Draft column descriptions for an Azure SQL database with Azure OpenAI, grounded in profiling stats, reviewed by a data owner, then stored as MS_Description."
author: Michael John Peña
draft: false
date: 2025-01-24
tags:
  - Documentation
  - Azure OpenAI
  - Data Governance
  - Azure SQL
  - Python
---

Most data platforms I've seen have the same gap: hundreds of tables, thousands of columns, and descriptions on maybe a tenth of them. Nobody disputes that a data dictionary matters. It just never wins against the next pipeline. LLMs are good at the tedious part of writing descriptions, but a description generated from a column name alone is a guess written in a confident voice, and a catalog full of confident guesses is worse than an empty one.

The pattern I'd use is simple: profile the column first, let the model describe what the evidence shows, have a data owner approve it, and store the result in the database itself so every tool that reads metadata picks it up.

## What already exists

If your data lives in Databricks Unity Catalog, use the built-in feature before writing anything. [AI-generated comments](https://www.databricks.com/blog/announcing-general-availability-databricks-assistant-and-ai-generated-comments) went GA in June 2024, at no extra cost, and they suggest table and column comments from Unity Catalog metadata that an editor accepts or edits. For dbt projects, I covered drafting models and their YAML descriptions in [an earlier post](/blog/2025-01-21-dbt-with-ai-code-generation/).

This post is for the case those don't cover: an Azure SQL Database or SQL Server estate with no catalog-level AI feature, where descriptions should live next to the schema rather than in a wiki that drifts.

## Why MS_Description is the right home

SQL Server has supported extended properties for decades, and `MS_Description` is the convention that SSMS, Azure Data Studio and most ER diagram tools read. You add one with [`sp_addextendedproperty`](https://learn.microsoft.com/sql/relational-databases/system-stored-procedures/sp-addextendedproperty-transact-sql), which works in SQL Server, Azure SQL Database and Azure SQL Managed Instance. The value is capped at 7,500 bytes, which is 3,750 characters of `nvarchar`, far more than a good description needs.

Storing descriptions in the database has a property I care about more than convenience: they move with the schema. A column description in Confluence survives the column being dropped. An extended property doesn't.

| Where descriptions live | Strength | Weakness |
|---|---|---|
| Wiki or spreadsheet | Anyone can edit | Drifts from the schema within months |
| dbt YAML | Versioned with the model code | Only covers dbt-managed models |
| `MS_Description` extended properties | Travels with the schema, read by most tools | Needs `ALTER` permission to write |
| Catalog only (e.g. Purview) | Business glossary and lineage in one place | Separate system to keep in sync |

These aren't exclusive. Many documentation and modelling tools read extended properties, but check your catalog scanner before assuming descriptions flow through: not every one imports `MS_Description`, so confirm whether your Purview scan does before you rely on it to fill the catalog.

## Step one: profile, and respect classifications

The model needs evidence, not just names. For each column I collect the data type, row count, null rate, distinct count and, only when it's safe, a handful of the most frequent values. A column called `status` with values `A`, `C` and `P` is much easier to describe honestly than `status` alone, and the model can say "single-letter code, values A, C, P; meaning not confirmed" rather than inventing a lifecycle.

Sample values are where this goes wrong. Sending the top values of an email or tax file number column to a model is a data handling decision, even with your own Azure OpenAI resource. Azure SQL already has [Data Discovery & Classification](https://learn.microsoft.com/azure/azure-sql/database/data-discovery-and-classification-overview), which stores labels in `sys.sensitivity_classifications`. I use it as the gate: any classified column gets statistics only, never values. If you haven't classified anything yet, do that first; this exercise is a good forcing function.

The gate only works if the profiling identity can see the classifications. Reading `sys.sensitivity_classifications` [requires the `VIEW ANY SENSITIVITY CLASSIFICATION` permission](https://learn.microsoft.com/sql/relational-databases/system-catalog-views/sys-sensitivity-classifications-transact-sql), and without it the view simply returns no rows. A join against an empty view marks every column as unclassified, which is the opposite of what you want, so the script checks the permission and refuses to run without it. Grant the profiling identity `VIEW ANY SENSITIVITY CLASSIFICATION`, plus `VIEW DEFINITION` so it can see existing `MS_Description` values and doesn't redraft them.

```python
# sql_profile.py
import struct

import pyodbc
from azure.identity import DefaultAzureCredential

SQL_COPT_SS_ACCESS_TOKEN = 1256  # pyodbc connection attribute for an Entra ID token
PROFILE_ROWS = 100_000            # profile a bounded sample, not the whole table
SAFE_SAMPLE_TYPES = {"char", "varchar", "nchar", "nvarchar", "tinyint", "smallint", "int", "bit"}
UNPROFILED_TYPES = {"xml", "geography", "geometry", "hierarchyid", "image", "text", "ntext", "sql_variant"}


def connect(server: str, database: str) -> pyodbc.Connection:
    token = DefaultAzureCredential().get_token("https://database.windows.net/.default").token
    raw = token.encode("utf-16-le")
    token_struct = struct.pack(f"<I{len(raw)}s", len(raw), raw)
    conn_str = (
        "Driver={ODBC Driver 18 for SQL Server};"
        f"Server=tcp:{server},1433;Database={database};Encrypt=yes;"
    )
    return pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct})


def q(name: str) -> str:
    """Quote an identifier the same way QUOTENAME does."""
    return "[" + name.replace("]", "]]") + "]"


def require_classification_visibility(conn: pyodbc.Connection) -> None:
    """Fail closed: without this permission sys.sensitivity_classifications returns no rows."""
    can_see = conn.cursor().execute(
        "SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW ANY SENSITIVITY CLASSIFICATION');"
    ).fetchval()
    if not can_see:
        raise PermissionError("Profiling identity cannot see sensitivity classifications; refusing to sample values")


def list_columns(conn: pyodbc.Connection, schema: str, table: str) -> list[dict]:
    require_classification_visibility(conn)
    sql = """
    SELECT c.name, t.name AS type_name, c.is_nullable,
           CAST(ep.value AS nvarchar(3750)) AS existing_description,
           CASE WHEN sc.major_id IS NULL THEN 0 ELSE 1 END AS is_classified
    FROM sys.columns AS c
    JOIN sys.types AS t ON t.user_type_id = c.user_type_id
    LEFT JOIN sys.extended_properties AS ep
      ON ep.class = 1 AND ep.major_id = c.object_id
     AND ep.minor_id = c.column_id AND ep.name = N'MS_Description'
    LEFT JOIN sys.sensitivity_classifications AS sc
      ON sc.class = 1 AND sc.major_id = c.object_id AND sc.minor_id = c.column_id
    WHERE c.object_id = OBJECT_ID(?)
    ORDER BY c.column_id;
    """
    rows = conn.cursor().execute(sql, f"{q(schema)}.{q(table)}").fetchall()
    return [dict(zip([d[0] for d in r.cursor_description], r)) for r in rows]


def profile_column(conn: pyodbc.Connection, schema: str, table: str, col: dict) -> dict:
    if col["type_name"] in UNPROFILED_TYPES:  # COUNT(DISTINCT) isn't supported on these
        return {"column": col["name"], "type": col["type_name"], "nullable": bool(col["is_nullable"])}
    source = f"(SELECT TOP ({PROFILE_ROWS}) {q(col['name'])} AS v FROM {q(schema)}.{q(table)}) AS s"
    cur = conn.cursor()
    stats = cur.execute(
        f"SELECT COUNT_BIG(*), COUNT_BIG(v), COUNT_BIG(DISTINCT v) FROM {source};"
    ).fetchone()
    profile = {
        "column": col["name"],
        "type": col["type_name"],
        "nullable": bool(col["is_nullable"]),
        "rows_profiled": stats[0],
        "null_rate": round(1 - stats[1] / stats[0], 3) if stats[0] else None,
        "distinct_values": stats[2],
        "top_values": [],
    }
    if not col["is_classified"] and col["type_name"] in SAFE_SAMPLE_TYPES and stats[2] <= 50:
        top = cur.execute(
            f"SELECT TOP (5) CAST(v AS nvarchar(100)), COUNT_BIG(*) AS n "
            f"FROM {source} WHERE v IS NOT NULL GROUP BY v ORDER BY n DESC;"
        ).fetchall()
        profile["top_values"] = [row[0] for row in top]
    return profile
```

Two deliberate limits are in there. Top values are only collected for low-cardinality columns (50 distinct values or fewer in the sample), because that's where values explain meaning: codes, flags and categories. High-cardinality text is mostly names, identifiers and free text, which carry risk and explain little. And the profile reads a bounded `TOP` sample, which is fine for describing a column but not for data quality reporting.

## Step two: describe with a fixed shape

I use Azure OpenAI [structured outputs](https://learn.microsoft.com/azure/foundry/openai/how-to/structured-outputs) so every response parses, with the `2024-10-21` GA API version and a `gpt-4o` `2024-08-06` deployment. The schema forces two things a free-text answer won't give you: a confidence level per column, and a list of questions for the data owner. Those questions are the most useful output of the whole process, because they show exactly where the model is guessing.

```python
# describe.py
import json
import os
from typing import Literal

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI
from pydantic import BaseModel


class ColumnDescription(BaseModel):
    column: str
    description: str
    confidence: Literal["high", "medium", "low"]
    questions_for_owner: list[str]


class TableDescription(BaseModel):
    columns: list[ColumnDescription]


SYSTEM_PROMPT = """You write data dictionary entries for a SQL database.
Rules:
- Describe what the evidence shows: name, type, null rate, distinct count, top values.
- One or two plain sentences per column. No marketing language.
- If a meaning is inferred from the name only, say so and set confidence to low.
- Never state business rules, units or currencies the evidence doesn't show.
  Ask about them in questions_for_owner instead.
- Return one entry per column provided, using the exact column names."""

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],  # https://<your-resource-name>.openai.azure.com
    azure_ad_token_provider=get_bearer_token_provider(
        DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
    ),
    api_version="2024-10-21",
)


def describe_table(schema: str, table: str, profiles: list[dict], context: str) -> TableDescription:
    completion = client.beta.chat.completions.parse(
        model="<your-gpt-4o-deployment>",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": (
                f"Table: {schema}.{table}\n"
                f"Known context from the owner: {context or 'none'}\n"
                f"Column profiles:\n{json.dumps(profiles, default=str, indent=2)}"
            )},
        ],
        response_format=TableDescription,
        temperature=0,
    )
    result = completion.choices[0].message.parsed
    if result is None:
        raise RuntimeError(f"Model refused: {completion.choices[0].message.refusal}")
    expected = {p["column"] for p in profiles}
    returned = {c.column for c in result.columns}
    if returned != expected or len(result.columns) != len(profiles):
        raise ValueError(f"Column mismatch: missing {expected - returned}, extra {returned - expected}")
    return result
```

The `context` argument matters more than any prompt tweak. One sentence from the owner, such as "orders from the Australian web store, amounts in AUD including GST", turns a stack of low-confidence guesses into usable descriptions. I'd collect it in a short form before running anything.

Note the column-set check at the end. Structured outputs guarantee the shape, not the content, so the script verifies the model returned exactly the columns it was given, each once. I deliberately don't ask for a table description: the owner can write that one sentence faster than they can review a draft of it, and it's where the context they gave you belongs anyway.

## Step three: a person approves, a script applies

Generated descriptions go to a review file, not straight into the database. I write a CSV with the existing description next to the draft, the confidence and the questions, plus an empty `approved` column. Columns that already have a human-written description are skipped by default; the model shouldn't overwrite someone's work because it phrases things more fluently. This is the glue between the profiling and description modules:

```python
# review.py
import csv

import pyodbc

from describe import describe_table
from sql_profile import connect, list_columns, profile_column

FIELDS = ["schema", "table", "column", "existing_description", "draft_description",
          "confidence", "questions_for_owner", "final_description", "approved"]


def write_review(conn: pyodbc.Connection, schema: str, table: str, context: str,
                 out_csv: str, include_described: bool = False) -> int:
    columns = [c for c in list_columns(conn, schema, table)
               if include_described or c["existing_description"] is None]
    if not columns:
        return 0
    existing = {c["name"]: c["existing_description"] or "" for c in columns}
    profiles = [profile_column(conn, schema, table, c) for c in columns]
    result = describe_table(schema, table, profiles, context)
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        for c in result.columns:
            writer.writerow({
                "schema": schema, "table": table, "column": c.column,
                "existing_description": existing[c.column],
                "draft_description": c.description, "confidence": c.confidence,
                "questions_for_owner": "; ".join(c.questions_for_owner),
                "final_description": "", "approved": "",
            })
    return len(result.columns)


if __name__ == "__main__":
    connection = connect("<your-server>.database.windows.net", "<your-database>")
    count = write_review(connection, "<your-schema>", "<your-table>",
                         "<one sentence of context from the owner>", "review.csv")
    print(f"Wrote {count} draft descriptions to review.csv")
```

The apply step only touches rows marked approved, and it handles both new and existing properties in one batch:

```python
# apply.py
import csv

import pyodbc

from sql_profile import connect

UPSERT_SQL = """
DECLARE @schema sysname = ?, @table sysname = ?, @column sysname = ?, @value nvarchar(3750) = ?;
DECLARE @object_id int = OBJECT_ID(QUOTENAME(@schema) + N'.' + QUOTENAME(@table));
IF EXISTS (
    SELECT 1 FROM sys.extended_properties
    WHERE class = 1 AND major_id = @object_id AND name = N'MS_Description'
      AND minor_id = COLUMNPROPERTY(@object_id, @column, 'ColumnId'))
    EXEC sys.sp_updateextendedproperty @name = N'MS_Description', @value = @value,
        @level0type = N'SCHEMA', @level0name = @schema,
        @level1type = N'TABLE', @level1name = @table,
        @level2type = N'COLUMN', @level2name = @column;
ELSE
    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = @value,
        @level0type = N'SCHEMA', @level0name = @schema,
        @level1type = N'TABLE', @level1name = @table,
        @level2type = N'COLUMN', @level2name = @column;
"""


def apply_reviewed(conn: pyodbc.Connection, review_csv: str) -> int:
    applied = 0
    cur = conn.cursor()
    with open(review_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["approved"].strip().lower() != "y":
                continue
            description = row["final_description"].strip() or row["draft_description"].strip()
            if not description:
                continue
            cur.execute(UPSERT_SQL, row["schema"], row["table"], row["column"], description)
            applied += 1
    conn.commit()
    return applied


if __name__ == "__main__":
    connection = connect("<your-server>.database.windows.net", "<your-database>")
    print(f"Applied {apply_reviewed(connection, 'review.csv')} descriptions")
```

The `final_description` column lets the reviewer edit rather than just accept or reject. In my view the edits are where the real knowledge goes in: the model says "status code, values A, C, P", the owner writes "A = active, C = cancelled, P = pending payment". That edit is the documentation; the model just made it quick to write.

## What this is bad at

- **Business meaning.** Profiling tells you a column is a decimal with two places and no nulls. It can't tell you whether it's before or after discounts. Expect most financial columns to come back as low confidence with a question, and treat that as correct behaviour.
- **Wide, generic tables.** Staging tables with columns named `attr01` to `attr60` produce sixty low-confidence guesses. Fix the naming or document the source system's spec instead.
- **Fluency as false authority.** A well-written wrong description gets trusted more than a missing one. That's why low-confidence drafts should be flagged in the review file and, ideally, never applied without an edit.
- **Identity permissions.** Run end to end under one identity, the pipeline needs read access to the data, metadata visibility (`VIEW DEFINITION` and `VIEW ANY SENSITIVITY CLASSIFICATION`) and `ALTER` on every table it writes to. That's a lot of power for a script that also sends text to a model. I'd use two identities: a read-only profiling identity for `review.py`, and a separate apply identity with `ALTER` on the target schema and no need to read row data, used only for `apply.py` after review. If the profiling side is ever misconfigured or misused, it can't change the schema, and the apply side never touches values.
- **Freshness.** This is a backfill tool. Once the backlog is cleared, new columns should get descriptions in the same pull request that adds them, written by the person who knows what they mean.

## When I'd run it

Run it once to clear the backlog on a database that matters, with an owner available to review each schema in a sitting of an hour or two. Don't run it on a database you're about to migrate or retire, on tables whose owners won't review the output, or on schemas full of sensitive columns you haven't classified yet. And don't measure success by the percentage of columns with descriptions; measure it by how many questions the owners answered. A smaller dictionary of reviewed descriptions is worth more than a complete one nobody checked.
