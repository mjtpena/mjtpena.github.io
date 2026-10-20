---
title: "BigQuery Mirroring Is GA: Zero-ETL Multicloud Has a Bill Too"
description: "Fabric mirroring for BigQuery is GA, but it moves cost to Google: CDC compute, egress, keyless reseeds and schema ownership decide when to mirror or copy."
author: Michael John Peña
draft: false
date: 2026-10-02
tags:
  - Microsoft Fabric
  - Mirroring
  - Multi-Cloud
  - Google Cloud
  - Cost Optimization
  - Data Integration
---

Plenty of organisations run analytics on both clouds: marketing and product data in BigQuery, finance and operations in Microsoft. Getting BigQuery tables into Fabric has usually meant someone wrote and owned a pipeline, and for the past year the only pipeline-free option was a preview feature. Mirroring for Google BigQuery is now generally available, and it removes that pipeline. It does not remove the bill on the Google side, the networking work, or the question of who owns the tables once they land in OneLake.

## Where mirroring stands after FabCon Barcelona

Mirroring for Google BigQuery became generally available in August 2026, after a public preview that started at FabCon Vienna in September 2025. The [FabCon and SQLCon Barcelona Data Factory recap](https://community.fabric.microsoft.com/blog/fbc_fabricupdatesblogs/fabconsqlcon-barcelona-2026-what%E2%80%99s-new-in-fabric-data-factory/5369551) (28 September to 1 October 2026) featured it next to two newer GA items:

- **Mirroring for Google BigQuery: GA since August.** The Microsoft Learn overview now says production workloads are fully supported.
- **Mirroring for SharePoint Lists: GA.** Useful for the small reference lists that business teams keep in SharePoint and analysts keep exporting by hand.
- **Extended capabilities in mirroring: GA.** These include delta change data feed. They are optional and billed separately from core mirroring.

The rest of this post is about BigQuery, because that is where the cost and ownership questions are hardest.

## How BigQuery mirroring actually moves data

It helps to know the mechanism, because every cost comes from it. According to the [BigQuery mirroring tutorial](https://learn.microsoft.com/en-us/fabric/mirroring/google-bigquery-tutorial), the replication engine:

1. Takes an initial snapshot of each selected table, using BigQuery compute and exporting to a Google Cloud Storage staging bucket (`<project_id_lowercase>_fabric_staging_bucket`, in the same region as the dataset).
2. Copies the staged files into OneLake and converts them to Delta tables, with a read-only SQL analytics endpoint on top.
3. Reads ongoing changes through BigQuery change history (the `CHANGES` function), which only works on tables with `enable_change_history` set to `TRUE`.

Some timing details matter for anyone promising freshness to the business. After the snapshot, the engine waits about 15 minutes before it fetches changes, because BigQuery takes up to 10 minutes to make new changes visible to `CHANGES`. When a table has no changes, the engine backs off and polls as rarely as once an hour. This is near real time for a warehouse, but it is not streaming. If someone needs sub-minute latency on BigQuery data, mirroring is the wrong tool.

## The bill does not disappear, it moves to Google

On the Fabric side, the economics are good. Replication compute is free and does not consume capacity units. Mirrored storage is free up to 1 TB per CU, so an F64 includes 64 TB of mirroring storage. You pay normal rates when you query the data with SQL, Power BI or Spark. Pause the capacity, though, and replication stops, and the mirrored storage is billed as OneLake storage.

The [BigQuery mirroring cost page](https://learn.microsoft.com/en-us/fabric/mirroring/google-bigquery-cost) is clear that Google charges for its share:

- **BigQuery compute** for the initial table loads, any reseeds, and reading row-level changes. On on-demand pricing, queries are billed by bytes scanned, so full-table reads of wide tables add up. On Editions, they use slot time you have already reserved.
- **Change history storage.** Turning on `enable_change_history` makes BigQuery store change metadata, and Google's [change history documentation](https://docs.cloud.google.com/bigquery/docs/change-history) notes this adds storage and compute cost. I'd expect it to grow with tables that see large deletes or heavy churn.
- **Cloud Storage** for the staging bucket and for the storage APIs used during ingestion.
- **Egress.** Data leaving Google Cloud for OneLake may incur egress charges, depending on your Google Cloud billing agreement.

None of this is a reason to avoid mirroring. It is a reason to get the GCP billing owner involved before go-live, not after their first invoice. The most expensive mistake is the default **Mirror all data** option on a large dataset: every table is snapshotted, including tables nobody in Fabric will ever query, and any new table created later gets mirrored automatically. My rule is to select tables explicitly and add more on request.

## Tables without primary keys are the hidden reseed tax

This is the limitation I'd check first. The [limitations page](https://learn.microsoft.com/en-us/fabric/mirroring/google-bigquery-limitations) says that for tables without a primary key, mirroring only supports insert-only changes. If the engine sees an update or a delete, it **reseeds the whole table**. If that keeps happening, the table goes into backoff for a while. Without a key, there is no way to tell which mirrored row an update applies to.

That is harmless for an append-only event table. For a dimension table that a dbt job rewrites with `MERGE` every hour, it means repeated full snapshots, each one billed as BigQuery compute and possibly egress. Your table looks mirrored while you pay batch-copy costs.

BigQuery supports primary keys, but they are declared `NOT ENFORCED`. BigQuery won't stop duplicates, so declaring a key is a promise the producing team has to keep. If two rows share a key, mirroring can't resolve updates to them correctly. Before adding a key, run this audit in BigQuery to find tables that have no primary key or don't have change history enabled:

```sql
-- Replace <project> and <dataset> with your own values.
SELECT
  t.table_name,
  pk.constraint_name IS NOT NULL AS has_primary_key,
  IFNULL(ch.option_value, 'FALSE') AS enable_change_history
FROM `<project>.<dataset>.INFORMATION_SCHEMA.TABLES` AS t
LEFT JOIN `<project>.<dataset>.INFORMATION_SCHEMA.TABLE_CONSTRAINTS` AS pk
  ON pk.table_name = t.table_name
  AND pk.constraint_type = 'PRIMARY KEY'
LEFT JOIN `<project>.<dataset>.INFORMATION_SCHEMA.TABLE_OPTIONS` AS ch
  ON ch.table_name = t.table_name
  AND ch.option_name = 'enable_change_history'
WHERE t.table_type = 'BASE TABLE'
ORDER BY has_primary_key, t.table_name;
```

For tables where the producing team agrees to guarantee uniqueness, the fix takes two statements:

```sql
-- Only declare a key the producer guarantees is unique; BigQuery does not enforce it.
ALTER TABLE `<project>.<dataset>.<table>`
  ADD PRIMARY KEY (<key_column>) NOT ENFORCED;

ALTER TABLE `<project>.<dataset>.<table>`
  SET OPTIONS (enable_change_history = TRUE);
```

Change history only records changes made after it is turned on, and `CHANGES` can only look back as far as the table's time travel window, which is seven days at most. Stopping and restarting mirroring replicates tables from scratch. If the capacity stays paused for longer than the time travel window, the changes it missed can no longer be read through `CHANGES`, so plan for a full reseed and its BigQuery cost.

## Networking and permissions are a security conversation

The connection uses a Google service account with a JSON key, and the permission list in the tutorial's prerequisites is broad. It includes creating datasets, exporting tables, writing and deleting objects in Cloud Storage, `iam.serviceAccounts.signBlob`, and either `bigquery.tables.update` or a pre-set `enable_change_history` option. The docs say BigQuery Admin plus Storage Admin covers it. I would not hand those roles out lightly. Create the staging bucket yourself so the account doesn't need `storage.buckets.create`, and set change history on the tables yourself so it doesn't need `tables.update`.

If network rules restrict access to BigQuery, use a virtual network data gateway, or an on-premises data gateway at version 3000.286.6 or later. The gateway is infrastructure someone has to patch and size, and its compute is one of the factors the mirroring docs list as affecting replication latency.

Row-level and column-level security set up in BigQuery do not come across. The docs state that any granular security must be reconfigured in Fabric. If BigQuery masks PII with policy tags, the mirrored copy won't, until you rebuild those rules. I covered why this boundary deserves deliberate design in [OneLake shortcuts are an authorization boundary](/blog/2026-07-27-onelake-shortcuts-are-an-authorization-boundary-a-security-model-for-fabric/).

## Who owns the schema contract?

Mirroring removes the pipeline, and the pipeline was where schema conversations used to happen. When the BigQuery team renames a column, there is no failed pipeline run to stop it reaching Fabric. The first sign may be a broken semantic model or a notebook that quietly returns nulls.

My position: the producing team owns the table contract, meaning the key, the column names and types, and whether the table is append-only. The Fabric team treats the mirrored database as raw input, never as a curated layer. Put views or a silver layer between the mirror and your reports, so a source change breaks one place you control, not every report built on it. This is the same argument I made in [why table contracts matter before notebooks scale](/blog/2026-04-27-designing-better-lakehouse-flows-in-fabric-why-table-contracts-matter-before-notebooks-scale/). Mirroring makes it more urgent, not less.

## Mirror, shortcut or copy?

Fabric gives you three realistic options for BigQuery data:

| Situation | Better choice |
|---|---|
| Tables with reliable primary keys, frequent updates, and Fabric users who need them fresh within minutes to an hour | **Mirroring** |
| The data already lands in Cloud Storage as Parquet or Delta (for example, BigQuery exports or open-format tables) and you want no second copy | **GCS shortcut**, with shortcut caching to limit repeated egress |
| Daily or weekly freshness is enough, tables are rewritten wholesale, or you need transformation during the load | **Batch copy** with the Data Factory BigQuery connector in a pipeline or Copy job |
| Keyless tables that are updated in place | Batch copy, or add keys first. Mirroring will reseed them repeatedly |
| Sub-minute latency | None of these. Look at an event stream from the producer |

Mirroring wins when three things are true: the tables have keys the producer will keep honest, the change volume is a small fraction of the table size, and someone in Fabric actually needs the freshness. If any of those is missing, a scheduled copy is cheaper to run and easier to reason about. It also fails loudly, which is sometimes exactly what you want.

## Before you switch it on

GA means Microsoft will support it in production. It doesn't mean it's free or that you don't have to own it. Before enabling BigQuery mirroring, I'd get four answers in writing: which tables, chosen explicitly; which of them have primary keys the producing team guarantees are unique; who pays and monitors the GCP-side compute, storage and egress; and who approves schema changes on the source. With those answered, mirroring is the simplest way to bring Google data into OneLake. Without them, you have swapped a pipeline you could see for costs and breakages you can't.
