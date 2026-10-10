---
title: "OneLake Table Contracts: Owners, Schemas and Failure Modes Up Front"
description: "Why OneLake governance has to be designed before scale: table contracts, schema-enabled lakehouses, explicit owners and deliberate failure modes in Fabric."
author: Michael John Peña
draft: false
date: 2026-03-04
tags:
  - Microsoft Fabric
  - OneLake
  - Governance
  - Data Quality
  - Data Engineering
---

OneLake makes it cheap to land data, and that is exactly why it gets messy under delivery pressure. Every sprint adds a lakehouse, a shortcut, or a "temporary" table, and soon nobody can say which `customer` table is authoritative, who owns it, or what happens when its upstream feed breaks. Governance retrofitted at that point means renaming tables that reports already bind to, re-granting access item by item, and repointing semantic models while people depend on them.

Before a table in OneLake is consumed by anyone outside the team that built it, it needs a contract. Not a 20-page data catalogue entry. A short, explicit agreement covering inputs, outputs, owner, and what happens when it fails.

## Most "data problems" are boundary problems

Picture a Direct Lake semantic model bound to `raw.customer` because that table appeared first in the SQL analytics endpoint. Nothing in the notebook is broken, yet the report shows duplicate customers and nobody can say why. Most "which table should I use?" questions look like that: three copies of the same table at different freshness, a model reading from the first table someone found, or a shortcut chain where nobody knows which side owns the data.

Another transformation fix won't solve that. Making the wrong path hard to take by accident will, and in Fabric that comes down to four decisions to make before the platform grows:

1. **Where a table lives** (workspace, lakehouse, schema).
2. **Who owns it** (a named team, recorded with the data rather than in someone's head).
3. **What shape and quality it promises** (columns, keys, constraints).
4. **How it fails** (block the load, drop bad rows, or publish with a warning).

## Use schemas as the first boundary

Lakehouse schemas reached general availability in December 2025, and lakehouses created in the portal are schema-enabled by default (through the REST API you still pass `enableSchemas: true`). If you still create flat lakehouses with every table under `dbo`, stop. Schemas give you a namespace that maps to intent, and some newer features below require them. One catch: a schema-enabled lakehouse can't yet be shared directly through item sharing, so consumers outside the workspace reach `published` through shortcuts or a workspace role. The [lakehouse schemas documentation](https://learn.microsoft.com/fabric/data-engineering/lakehouse-schemas) covers the mechanics, including schema shortcuts and current limitations.

The layout I'd start with:

| Schema | Purpose | Intended audience |
|---|---|---|
| `raw` | Landed data, no promises | Owning engineering team only |
| `conformed` | Cleaned, typed, deduplicated | Engineering and analytics engineers |
| `published` | Contracted tables for consumption | Anyone with a business reason |
| `sandbox` | Exploration, disposable | The author |

Within one lakehouse these audiences are a convention, not a control. Workspace roles grant the whole lakehouse, not individual schemas. Schema-level GRANT/DENY on the SQL analytics endpoint only affects SQL queries, not anyone with ReadAll or a Spark notebook, so it's a convenience, not the boundary. If `raw` really must be restricted today, put it in its own lakehouse or workspace (OneLake security comes up below).

So the control is organisational. The labels matter less than the rule behind them: **only `published` is a product**. Everything else can change without notice. The answer to "which table should I use?" becomes "the one in `published`, and if it isn't there, ask the owner".

A medallion layout (bronze, silver, gold) works just as well if your organisation already speaks that language. What doesn't work is mixing both, or letting each team invent its own.

## Write the contract into the table

A contract that lives only in a wiki drifts. Delta Lake already gives you two places to put it directly on the table: constraints for the shape, and table properties for the metadata. This Spark SQL runs in a Fabric notebook attached to a schema-enabled lakehouse, in a Spark SQL cell (or a cell starting with `%%sql`, since the notebook default is PySpark):

```sql
CREATE SCHEMA IF NOT EXISTS published;

CREATE TABLE IF NOT EXISTS published.customer (
    customer_id     STRING    NOT NULL,
    customer_name   STRING    NOT NULL,
    country_code    STRING,
    segment         STRING,
    updated_at      TIMESTAMP NOT NULL
)
USING DELTA
COMMENT 'Authoritative customer list for reporting. One row per active customer.'
TBLPROPERTIES (
    'contract.owner'        = '<owning-team-name>',
    'contract.contact'      = '<team-distribution-list>',
    'contract.version'      = '1.0',
    'contract.freshness'    = 'daily by 06:00 Australia/Sydney',
    'contract.upstream'     = 'conformed.crm_account',
    'contract.on_failure'   = 'block'
);

ALTER TABLE published.customer DROP CONSTRAINT IF EXISTS valid_country;

ALTER TABLE published.customer
    ADD CONSTRAINT valid_country CHECK (country_code IS NULL OR length(country_code) = 2);
```

The drop-then-add pair keeps the script safe to re-run, because `ADD CONSTRAINT` fails if a constraint with that name already exists. `ADD CONSTRAINT` also validates every existing row first, and fails if any of them violate the check, so clean the table before you add a constraint to it. From then on, `NOT NULL` and `CHECK` constraints are enforced by Delta on every write: a write that violates them fails rather than landing quietly.

The `contract.*` properties are plain metadata, and anyone can read them with `SHOW TBLPROPERTIES published.customer`. That is enough for a nightly check. This assumes the notebook's default lakehouse is the schema-enabled one that holds `published`, because schema names only resolve in code when it is (or when no default is set). This PySpark cell, in the same notebook, lists every table in `published` and flags any without an owner:

```python
required = ["contract.owner", "contract.contact", "contract.on_failure"]
gaps = []

for table in spark.catalog.listTables("published"):
    if table.isTemporary:
        continue  # skip session temp views; they have no table properties
    props = {
        row["key"]: row["value"]
        for row in spark.sql(f"SHOW TBLPROPERTIES published.`{table.name}`").collect()
    }
    missing = [key for key in required if not props.get(key)]
    if missing:
        gaps.append((table.name, ", ".join(missing)))

if gaps:
    spark.createDataFrame(gaps, "table_name STRING, missing STRING").show(truncate=False)
    raise ValueError(f"{len(gaps)} published table(s) break the contract")
```

Schedule it after the nightly loads; failing the run is deliberate, because a failed run raises an alert and a report nobody reads does not.

There is one trade-off. Adding a `CHECK` constraint upgrades the table's Delta writer protocol (writer version 3, or the `checkConstraints` table feature), and every writer must then honour it. Before constraining a table already in use, check that each process writing to it (Spark notebooks, pipelines, Dataflow Gen2) supports that protocol, or a working load will start failing.

Versioning is what makes the contract worth having between teams. Additive changes, such as a new nullable column, bump the minor version (`1.0` to `1.1`) and need no migration. A rename, a type change or a change of grain is breaking: publish a new table such as `published.customer_v2`, have the owner send a notice with a stated overlap period, and run both side by side. Remove the old table only after lineage shows that its consumers have moved.

This costs almost nothing and doesn't wait for a catalogue rollout. When you adopt Microsoft Purview or the OneLake catalog, the same loop can export the `contract.*` values for mapping onto catalog owners and descriptions.

## Decide the failure mode deliberately

The mistake I see most often is nobody deciding in advance what *should* happen. There are three honest options:

- **Block.** The load fails and the published table keeps yesterday's data. Correct for finance, regulatory and anything that feeds a decision with money attached. The cost is staleness, so the owner needs an alert.
- **Drop and count.** Bad rows are excluded, good rows publish, and the number of rejects is recorded. Reasonable for high-volume event data where a few malformed rows shouldn't hold up everything else.
- **Publish and flag.** Everything lands with a quality column or a status table. Only acceptable when consumers have agreed to filter on it, which in practice they often don't.

Delta constraints only give you the first option. For the second, materialized lake views (in preview since mid-2025) are worth a look. They let you declare a view over lakehouse tables with constraints and an explicit violation action, and Fabric manages the refresh and lineage. They require a schema-enabled lakehouse, which is another reason to adopt schemas now. The example below is a fragment that assumes `raw.order_line` already exists with `order_id`, `line_number`, `product_id`, `quantity` and `unit_price` columns:

```sql
CREATE MATERIALIZED LAKE VIEW IF NOT EXISTS conformed.order_line_clean
(
    CONSTRAINT order_id_present CHECK (order_id IS NOT NULL) ON MISMATCH DROP,
    CONSTRAINT positive_quantity CHECK (quantity > 0) ON MISMATCH DROP
)
AS
SELECT
    order_id,
    line_number,
    product_id,
    CAST(quantity AS INT)              AS quantity,
    CAST(unit_price AS DECIMAL(18, 2)) AS unit_price
FROM raw.order_line;
```

`FAIL` is the default violation action, and `DROP` removes offending rows while recording how many were dropped. The [data quality documentation for materialized lake views](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/data-quality) explains the precedence rules and the built-in report. Constraints can't be altered after creation and can't use functions or pattern matching, so keep checks simple and expect to recreate the view when the contract changes. Because this is still preview, I'd use it in `conformed` today and keep the contracted `published` tables on patterns you fully control until it reaches GA.

## Make ownership visible outside the notebook

Table properties help engineers; business users need ownership surfaced where they discover data. Three Fabric features do that:

- **Domains** group workspaces by business area, so a domain admin owns a slice of the estate rather than a central team owning everything. See [domains in Fabric](https://learn.microsoft.com/fabric/governance/domains).
- **Endorsement** (Promoted, Certified, Master data) signals which items are safe to build on. My rule: only items backed by a `published` contract can be Certified, and certification is something a named reviewer grants, not the author.
- **The OneLake catalog** gives people one place to search and gives admins and data owners a [Govern view](https://learn.microsoft.com/fabric/governance/onelake-catalog-govern) of their estate (in preview as of March 2026). If your contracted tables are well named, described and endorsed, the catalog does the discovery work for you.

On access, stay conservative for now. Workspace roles (and shortcuts for consumers outside the workspace) cover most estates. [OneLake security](https://learn.microsoft.com/fabric/onelake/security/get-started-security), which defines roles at the table and folder level that apply across engines, is still in preview. It will make the schema audiences above enforceable inside one lakehouse, but until it's GA, separate lakehouses or workspaces are the real boundary. If you are crossing workspaces with shortcuts, remember that the shortcut doesn't change who owns the data. I covered the mechanics in [OneLake shortcuts](/blog/2023-06-03-onelake-shortcuts/).

## Runbooks are part of the contract

A contract that says "block on failure" is useless if the person on call doesn't know what to do when it blocks. For every `published` table, I want a runbook of half a page at most:

- How to tell it has failed (which alert, which Monitor hub view).
- How to tell whether the problem is upstream or in the transformation.
- Whether it is safe to re-run, and how.
- Who to tell, and what consumers will see in the meantime.

Keep it next to the code in the repository, not in a separate wiki. If it needs more than half a page, the pipeline is probably too complicated.

## When not to bother

This is overhead, and not every table deserves it. Skip formal contracts for sandbox work, one-off analyses, proof-of-concept workspaces that will be deleted, and teams of two or three where the producer and consumer sit together. A contract earns its keep at the boundary between teams, where the person who breaks the table isn't the person who gets the angry email.

Also resist the urge to design all of this centrally before anyone ships. If you already run a [data mesh style setup in Fabric](/blog/2024-06-15-data-mesh-fabric/), the contract template is a platform standard and the content belongs to each domain. A central team that writes every contract becomes the bottleneck the lakehouse was meant to remove.

## The decision to make this week

If your OneLake estate is still small, make four decisions now and write them down: the schema layout, the rule that only `published` tables are products, the minimum contract properties every published table carries, and the default failure mode per data class. Each is a short conversation today and a migration project in a year.

If the estate is already large, don't try to fix everything. Pick the ten tables that the most reports depend on, give them owners and contracts, certify them, and let the rest follow. Start with the tables behind your Certified semantic models.
