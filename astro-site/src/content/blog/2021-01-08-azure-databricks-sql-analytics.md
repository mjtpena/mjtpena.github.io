---
title: "Databricks SQL Analytics in Preview: What to Test Before You Commit"
description: "SQL Analytics on Azure Databricks is in public preview. Here is what it is, how to pilot it properly, and when Synapse or Power BI alone is the better fit."
author: Michael John Peña
draft: false
date: 2021-01-08
tags:
  - Azure
  - Databricks
  - SQL
  - Delta Lake
  - Business Intelligence
---

Most lakehouse projects I see stall at the same point: the data engineers are happy in notebooks, the Delta tables are clean, and the analysts still can't get at any of it without filing a ticket. They want to write SQL, point Power BI at something with a hostname, and not think about Spark clusters. Databricks SQL Analytics is aimed squarely at that gap, and because it's still in preview, the question for January 2021 isn't "should we adopt it?" but "what should a pilot prove before we do?"

## What SQL Analytics is, as of today

Databricks [announced SQL Analytics on 12 November 2020](https://www.databricks.com/company/newsroom/press-releases/databricks-launches-sql-analytics-to-enable-cloud-data-warehousing-on-data-lakes), and it became available in public preview on Azure Databricks on 18 November (it's listed in the [November 2020 Azure Databricks release notes](https://learn.microsoft.com/en-us/azure/databricks/release-notes/product/2020/november)). It's a separate experience inside your workspace, with its own UI aimed at SQL users rather than notebook users. The pieces:

- **SQL endpoints.** Compute tuned for SQL workloads. Under the hood they're Spark clusters, but you pick a T-shirt size, a minimum and maximum number of clusters for concurrency, and an auto-stop timeout. Endpoints also expose the JDBC/ODBC connection details that BI tools need.
- **Query editor.** A browser-based SQL editor with a schema browser, autocomplete and result visualisations.
- **Dashboards and alerts.** Saved queries feed visualisations, dashboards can refresh on a schedule, and alerts fire when a scheduled query's result crosses a threshold. This part comes from the [Redash acquisition Databricks announced in June 2020](https://www.databricks.com/blog/2020/06/24/welcoming-redash-to-databricks.html), and it shows: if you've used Redash, you'll recognise the `{{ parameter }}` syntax.
- **Query history.** Who ran what, on which endpoint, how long it took and whether it failed. For a shared endpoint this is your first troubleshooting tool.

The performance story leans on the Photon-powered Delta Engine, which Microsoft [put into preview on Azure Databricks in September 2020](https://techcommunity.microsoft.com/blog/azure-databricks/turbocharge-azure-databricks-with-photon-powered-delta-engine/1694929). Photon is a vectorised execution engine written in C++, and SQL Analytics endpoints run it by default. Two previews stacked on top of each other is worth remembering when you read benchmark claims.

One practical gate: SQL Analytics needs a Premium tier workspace, because it relies on table access control. If your workspace is Standard, that's a pricing conversation before it's a technical one.

The second gate is per user. During the preview, a workspace admin has to grant each user (or group) the **SQL Analytics access** entitlement before the SQL Analytics experience shows up for them. Plan that into pilot onboarding, otherwise your first analyst session is spent on admin tickets.

## Where it fits, and where it doesn't

The honest framing is that SQL Analytics is not trying to replace Power BI. Its dashboards are fine for operational views, quick checks and alerting, but they don't come close to Power BI's modelling, row-level security in a semantic model, or distribution to business users. What it replaces is the awkward middle: the shared interactive cluster analysts were connecting Power BI to, the notebook someone wrote to "just run this query every morning", and the one engineer who knows the JDBC URL.

Here is how I'd compare the options an Azure data team actually has right now:

| Need | SQL Analytics (preview) | Synapse serverless SQL pool (GA) | Interactive Databricks cluster |
|---|---|---|---|
| Query Delta tables with SQL | Native, with Delta Engine | No Delta support yet; reading the raw Parquet ignores the transaction log and returns stale/duplicate rows | Native |
| BI tool connectivity | JDBC/ODBC via endpoint | T-SQL endpoint, very familiar to Power BI users | JDBC/ODBC, but shared with notebook work |
| Concurrency handling | Scale out with more clusters | Managed by the service | Manual: one cluster for everyone |
| Pricing model | Compute running time (DBUs plus VMs) | Per TB processed | Compute running time |
| Maturity | Preview | GA since December 2020 | GA |

If your organisation already went all in on [Azure Synapse Analytics](/blog/2020-12-05-azure-synapse-analytics-ga/) and your data sits in plain Parquet (not Delta), serverless SQL is the lower-friction answer, and I wouldn't add a second engine just for the novelty. If your lake is Delta, your engineers already live in Databricks, and analysts are currently hammering an all-purpose cluster, SQL Analytics is worth a serious pilot.

## Getting the data ready

SQL Analytics queries tables registered in the metastore, not arbitrary notebook variables, so the first job is making sure your Delta tables are registered and permissioned. If you followed the patterns in my [Delta Lake introduction](/blog/2020-11-16-databricks-delta-lake-intro/), this is a small step. Run this from a notebook on a cluster with table access control enabled (or from the SQL Analytics editor itself). Registering a table over an `abfss://` path is a file-level operation, so on a table-ACL cluster it has to be run by an admin or by a user granted `SELECT` and `MODIFY` on `ANY FILE`. The cluster or endpoint running it also needs storage access configured: Spark config with service principal credentials on a cluster, or the data access configuration for endpoints.

```sql
-- Run as a workspace admin, or as a user granted SELECT and MODIFY ON ANY FILE.
-- Register an existing Delta folder as a table analysts can find
CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.sales
USING DELTA
LOCATION 'abfss://<container>@<storage-account>.dfs.core.windows.net/curated/sales';

-- Give the analyst group read access and nothing else
GRANT USAGE ON DATABASE analytics TO `analysts`;
GRANT SELECT ON TABLE analytics.sales TO `analysts`;
```

Two things to get right here. First, how the endpoint reaches storage: the endpoints use a workspace-level [data access configuration](https://learn.microsoft.com/en-us/azure/databricks/admin/sql/data-access-configuration) (typically a service principal with access to your ADLS Gen2 account), not the identity of the person running the query. That means the GRANT statements are your real security boundary for analysts, so treat them with the same care you'd give database permissions in SQL Server. Second, grant to groups, not individuals. Granting to groups means a team change is one membership update, not a dozen REVOKE statements.

## A query worth testing with

Pick queries that look like what your analysts actually run, not the vendor demo. Something with a join, an aggregation over a meaningful date range and a filter they'll want to change:

```sql
SELECT
    DATE_TRUNC('month', s.order_date) AS order_month,
    p.product_category,
    SUM(s.revenue)                    AS total_revenue,
    COUNT(DISTINCT s.customer_id)     AS unique_customers
FROM analytics.sales AS s
JOIN analytics.products AS p
    ON s.product_id = p.product_id
WHERE s.order_date BETWEEN '{{ start_date }}' AND '{{ end_date }}'
  AND p.product_category = '{{ category }}'
GROUP BY 1, 2
ORDER BY 1, 2;
```

The `{{ }}` placeholders become input widgets in the editor and on any dashboard the query feeds. That's the feature analysts notice first, and it removes a surprising number of "can you rerun this for March?" requests.

## What a pilot should prove

Preview means features, limits and pricing can change before GA, so I wouldn't put a board report on it yet. I would run a four to six week pilot with a handful of real analysts and real data, and judge it on these questions:

1. **Is concurrency actually better?** Put your busiest Monday-morning queries through one endpoint with a maximum of one cluster, then raise the maximum. Watch the query history for queueing. This is the main reason to move off a shared interactive cluster, so measure it.
2. **What does it cost per day?** Endpoints bill while running, in DBU-hours on the SQL Compute SKU plus the underlying VMs. At preview pricing SQL Compute is $0.22 per DBU-hour, well under the Premium all-purpose compute rate your shared cluster pays; check the [Azure Databricks pricing page](https://azure.microsoft.com/en-us/pricing/details/databricks/) for your region and the DBUs per hour of each endpoint size. Set auto-stop low (10 to 20 minutes) for ad hoc endpoints and compare a week of spend against what the shared cluster was costing you. Scheduled dashboard refreshes will wake an endpoint, so map out refresh schedules before you're surprised.
3. **Does Power BI behave?** Connect through Power BI Desktop's Azure Databricks connector (or the Spark connector), using the endpoint's server hostname and HTTP path from its connection details. Analysts authenticate with a Databricks personal access token: the username is literally `token` and the password is the token value.

   ```text
   Server hostname: adb-<workspace-id>.<random-number>.azuredatabricks.net
   HTTP path:       /sql/1.0/endpoints/<endpoint-id>
   Port:            443
   ```

   Test both Import and DirectQuery. DirectQuery against a cold endpoint means the first visual waits for the endpoint to start, and your users will notice. DirectQuery in the Power BI Service also runs through a single stored credential in the gateway or dataset settings, so every report viewer queries as that one identity and your per-user table ACLs don't apply there. If Import mode with a scheduled refresh is good enough, that's the simpler pattern.

4. **Does the security model hold up?** Have someone outside the analyst group try to query the table. Confirm the GRANTs and the data access configuration do what you think they do before anyone loads sensitive data.
5. **Are the dashboards good enough for their intended audience?** For an engineering team's operational view, probably yes. For executives, keep using Power BI.

## When I'd wait

Don't adopt SQL Analytics now if your team is mostly T-SQL developers who'll expect stored procedures, temp tables and SQL Server tooling; the SQL dialect is Spark SQL, and that difference matters more than demos suggest. Wait if you're on a Standard tier workspace with no appetite to upgrade, or if your data isn't in Delta yet. Fix the lake first; a SQL front end on top of an unreliable lake just exposes the problems to more people.

## The decision

SQL Analytics is the most credible attempt so far at letting analysts work directly against a Delta lake without a separate warehouse copy. The architecture is sound: dedicated SQL compute, proper BI connectivity, table-level permissions, and a basic but useful dashboarding layer. It is also two months into public preview. My recommendation is to pilot it against your shared interactive cluster, measure concurrency and cost honestly, keep Power BI as the presentation layer, and make the production call when it reaches general availability.
