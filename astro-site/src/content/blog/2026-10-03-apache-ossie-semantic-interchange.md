---
title: "Apache Ossie and the Portable Semantic Layer: What It Fixes and What It Doesn't"
description: "Microsoft backed Apache Ossie at FabCon with a Power BI converter. It makes metric names portable, not DAX semantics, security rules or performance."
author: Michael John Peña
draft: false
date: 2026-10-03
tags:
  - Power BI
  - Semantic Models
  - Semantic Layer
  - Snowflake
  - Data Architecture
---

Most organisations of any size now define the same metric in three or four places: a Power BI semantic model, a Snowflake or Databricks view, a dbt project and, increasingly, a prompt or ontology that an agent reads. Each copy drifts on its own schedule, and "revenue" quietly means four different things. Apache Ossie is the industry's attempt to give those definitions one portable format, and this week Microsoft put its weight behind it. It is a real step forward, but it solves a narrower problem than the announcements suggest, and the gap matters if you are deciding where your metrics should live.

## What was actually announced

Open Semantic Interchange started as a Snowflake-led coalition and [entered the Apache Incubator as Apache Ossie](https://ossie.apache.org/updates/ossie-enters-apache-incubator/) in July 2026. The specification and its mission carried over under the new name. Contributors include Snowflake, Salesforce, Databricks, dbt Labs, GoodData, Dremio and others.

At FabCon Europe in Barcelona (28 September to 1 October), Microsoft made two commitments. The Power BI team's [post on the product's next chapter](https://community.fabric.microsoft.com/blog/fbc_pbiupdatesblog/power-bi%E2%80%99s-next-chapter-the-evolution-of-business-intelligence/5369131) says Microsoft is committing to Apache Ossie and intends to help establish DAX as an Ossie-recognised query language. Snowflake's [engineering blog](https://www.snowflake.com/en/blog/engineering/apache-ossie-microsoft-ecosystem-support/) describes the first deliverable: a Power BI converter that lets you explore bidirectional conversion between Power BI semantic models and other Ossie-compatible models, such as Snowflake Semantic Views, with Ossie as the intermediate format.

Read the status carefully. The specification on `main` is `0.2.0.dev0`, an unreleased draft whose schema can still change; the last released version is 0.1.1 (11 December 2025, published under the OSI name). The [Microsoft converter](https://github.com/apache/ossie/tree/main/converters/microsoft) landed in the Apache repository in mid-September. "DAX as an Ossie query language" is a stated intention, not a shipped capability. None of this is GA in the sense a Fabric or Power BI feature would be.

## What the format carries

An Ossie document is one semantic model in YAML or JSON: datasets (logical tables with a source and keys), fields (row-level attributes), metrics (model-level aggregates), relationships, plus `ai_context` for instructions and synonyms aimed at agents, and `custom_extensions` for vendor-specific payloads. The interesting part is how expressions work. Each field or metric holds a list of dialect-tagged expressions:

```yaml
version: "0.2.0.dev0"
name: sales_model
datasets:
  - name: orders
    source: <your-database>.<your-schema>.orders
    primary_key: [order_id]
    fields:
      - name: order_id
        expression:
          dialects:
            - dialect: ANSI_SQL
              expression: order_id
      - name: amount
        expression:
          dialects:
            - dialect: ANSI_SQL
              expression: amount
metrics:
  - name: total_revenue
    expression:
      dialects:
        - dialect: ANSI_SQL
          expression: SUM(orders.amount)
        - dialect: DAX
          expression: SUM ( orders[amount] )
```

That metric has two expressions, and nothing in the format proves they return the same number. The spec registers a long list of dialects (`ANSI_SQL`, `SNOWFLAKE`, `DATABRICKS`, `BIGQUERY`, `MDX`, `TABLEAU`, `MAQL`, `DAX` and more), but it defines semantics only for its own `OSSIE_SQL_2026` dialect, added on 21 September. Every other dialect is an opaque string that a consumer may ignore. The example uses `ANSI_SQL` rather than `OSSIE_SQL_2026` only because that is what the Microsoft converter emits and parses today; it is not the more portable choice. Registering DAX means a model can declare a DAX expression. It does not mean an Ossie consumer can execute or check one.

## Where lock-in actually goes down

Inventory and naming move cleanly. Tables, columns, keys, many-to-one and one-to-one relationships, metric names, descriptions and agent-facing context all have first-class homes in the spec. That is the boring metadata that eats the most time in a migration and causes the most "which revenue is this?" arguments. If your catalogue, your BI tool and your agent can all read the same list of metrics with the same descriptions and synonyms, you have removed a real source of drift.

The converter also behaves honestly, which I value more than any feature claim. It runs offline against a `model.bim` (TMSL) or a single TMDL document (TMDL needs the optional Microsoft TOM assemblies; note that a PBIP project stores TMDL as a folder of files, not one document), reports every loss, and `--strict` makes it exit non-zero when anything could not be converted faithfully. There is no published package yet: you clone the repository, run `uv sync` in `converters/microsoft` (add `--extra tom` and run `scripts/restore_tom.py` for TMDL), then call it through `uv run`:

```bash
uv run ossie-microsoft import -i model.bim -o model.yaml --strict
uv run ossie-microsoft export -i model.yaml -o model.bim --strict
```

The README's design principle is worth quoting: "A missing measure is a bug a modeler notices; a plausible wrong one is not." That is the right instinct, and it tells you exactly where the limits are.

## Where it doesn't: calculation semantics

Power BI measures travel to Ossie as DAX text. Going the other way, the converter translates only a single aggregate over one unqualified column (`SUM`, `MIN`, `MAX`, `COUNT`, `AVG`, `COUNT(DISTINCT)`, `COUNT(*)` and a few statistical functions) from SQL into DAX. Arithmetic between aggregates, `CASE`, window functions, filtered aggregates and percentiles are reported and skipped. Even the translations it does make carry known differences: SQL `COUNT` returns 0 on an empty set where DAX returns BLANK.

This is not a converter bug that a few more pull requests will close. DAX measures are evaluated in filter context: `CALCULATE`, context transition, `ALL` and `REMOVEFILTERS`, time intelligence over a marked date table, calculation groups that rewrite measures at query time. A SQL metric is an aggregate over rows after a `WHERE` and `GROUP BY`. "Year-to-date revenue excluding returns, respecting the slicer on region but not on product" has no single portable expression. You can store both versions side by side in Ossie, but the format cannot tell you they agree. The canonical meaning of a non-trivial metric still lives in one engine's language.

## Where it doesn't: security and performance

The converter's own documentation lists what is "preserved but not modelled": row-level security roles, perspectives, hierarchies, calculation groups, translations, incremental refresh policies, KPIs and detail rows definitions. They go into a `POWER_BI` entry in `custom_extensions` so a round trip back to Power BI restores them, but they are invisible to Snowflake or any other consumer. Many-to-many, inactive and composite relationships have no equivalent at all.

Security is the one that should worry you. If a model moves from Power BI to Snowflake Semantic Views via Ossie, its RLS roles do not come with it in any form Snowflake can enforce. You re-implement them as Snowflake row access policies, by hand, and test that the two produce the same visible rows for the same user. I covered why the semantic model is now an access-control surface in its own right in [Fabric IQ and semantic model governance](/blog/2026-10-01-fabric-iq-copilot-semantic-model-governance/), and a portable format that drops those rules silently would be a liability. Ossie at least does not do it silently, but "reported" is not "enforced".

Performance behaviour does not transfer either. Storage mode (Import, Direct Lake, DirectQuery), aggregations, partitioning and refresh policy are what make a Power BI model fast, and they are deliberately outside the spec. The same is true of clustering or warehouse sizing on the Snowflake side. Choices like [converting individual Direct Lake tables to Import](/blog/2026-09-01-direct-lake-tables-to-import-hybrid-models/) are per-engine engineering, and a converted model starts from zero on all of it.

| Concern | Carried by Ossie today | What you still own |
|---|---|---|
| Tables, columns, keys, relationships | Yes (many-to-one, one-to-one) | Many-to-many, inactive, composite |
| Metric names, descriptions, agent context | Yes | Keeping them current |
| Simple aggregates | Yes, with narrow SQL-to-DAX translation | Empty-set and BLANK differences |
| Filter-context and time-intelligence logic | As opaque per-dialect text | Equivalence testing across engines |
| RLS and OLS (inside roles), perspectives | Vendor stash only | Re-implementing per platform |
| Storage mode, aggregations, refresh | No | Per-engine tuning |

## Deciding where the canonical definition lives

The useful question is not "should we adopt Ossie?" but "which engine owns the meaning of each metric, and which ones only consume it?". My rule of thumb:

- **Put the canonical definition where the complex logic runs.** If a metric depends on filter context, calculation groups or time intelligence, its source of truth is the Power BI semantic model, and the DAX expression is the one that counts. Record which dialect is authoritative yourself, for example in the metric description or a `custom_extensions` entry, because the spec has no field for it. If a metric is a straightforward aggregate that SQL consumers, notebooks and agents all hit, define it close to the data (a Snowflake Semantic View, a dbt metric, or Fabric's semantic views, which Microsoft showed as an early look at FabCon and which are not yet in preview) and let Power BI consume it.
- **Put security where enforcement happens for the most consumers.** RLS defined only in a Power BI model protects Power BI queries and nothing else. If Snowflake SQL users, agents and BI all read the same data, enforce at the warehouse and treat model-level roles as a second layer, not the only one.
- **Use Ossie as the catalogue and contract, not the compiler.** Generate an Ossie document from each platform in CI, diff metric names and descriptions, and fail the build when one platform adds or renames a metric the others do not know about. That captures most of the drift value today without trusting cross-dialect translation.
- **Test equivalence, don't assume it.** Where a metric exists in two dialects, run both against the same slice of data and compare. Run the converter with `--strict` and treat any reported loss as a ticket, not a warning.

## When to wait

If your estate is all Power BI on Fabric, Ossie buys you little right now beyond agent-facing metadata; PBIP and TMDL in source control already give you a versioned, diffable definition. If you are mid-migration between platforms, the converter is worth a spike for inventory and naming, but plan to rewrite every non-trivial measure and every security rule. If you run Power BI and Snowflake side by side, which is where this announcement is aimed, start using Ossie as a shared metric register and revisit deeper conversion once the spec reaches a 0.2 release and DAX recognition is more than an intention.

A portable semantic layer is worth having. Just be clear that what moves today is the metadata. Calculation semantics, security and performance stay with each engine, and someone on your team still has to own them.
