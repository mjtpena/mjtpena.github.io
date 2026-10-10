---
title: "Fabric Warehouse Tables or Lakehouse Shortcuts: Where Each Table Lives"
description: "A placement rule for Fabric: when data belongs in a Warehouse table you own, and when reading a lakehouse shortcut through the SQL analytics endpoint is enough."
author: Michael John Peña
draft: false
date: 2026-04-19
tags:
  - Microsoft Fabric
  - Data Warehouse
  - Lakehouse
  - OneLake
  - T-SQL
---

A common failure mode in Fabric estates is a Warehouse that is half real tables and half three-part-name queries into lakehouse shortcuts, and nobody can say why a given table sits on one side or the other. That ambiguity is what makes these warehouses unreliable: a report breaks because an upstream team changed a Delta table it never knew a warehouse depended on, or a dashboard shows yesterday's numbers because the endpoint's metadata sync had silently failed for that table. What fixes it is a placement rule that makes the warehouse boring.

If you want the broader Lakehouse-versus-Warehouse comparison, I covered that in [Lakehouse vs Warehouse in Fabric](/blog/2023-12-18-lakehouse-vs-warehouse/). This post is narrower: you already have a Warehouse, and you need to decide, table by table, whether to own a copy or read through a shortcut.

## The two options are not equivalent

They look similar from a query window because Fabric lets a Warehouse query a lakehouse's SQL analytics endpoint with three-part names in the same workspace. Underneath, they behave very differently.

A **Warehouse table** is owned by the Warehouse. You write to it with T-SQL, it participates in multi-statement transactions, it supports [time travel](https://learn.microsoft.com/fabric/data-warehouse/time-travel) with `OPTION (FOR TIMESTAMP AS OF ...)` over a 30-day retention window, and you can take [warehouse snapshots](https://learn.microsoft.com/fabric/data-warehouse/warehouse-snapshot), now generally available, to give report consumers a stable, read-only point in time.

A **lakehouse shortcut** read through the SQL analytics endpoint is someone else's Delta table. The endpoint is read-only, its schema is whatever the producer last wrote, and its view of the table depends on metadata sync. Sync is automatic, but it is not instantaneous, which is why Microsoft shipped a [Refresh SQL endpoint metadata REST API](https://learn.microsoft.com/rest/api/fabric/sqlendpoint/items/refresh-sql-endpoint-metadata) (generally available) so pipelines can force it.

| Concern | Warehouse table | Shortcut via SQL analytics endpoint |
|---|---|---|
| Who controls schema | The warehouse team | The producing team |
| Write path | T-SQL (`INSERT`, `MERGE`, `COPY INTO`, CTAS) | None from SQL; Spark or the producer only |
| Transactions across tables | Yes | No |
| Point-in-time reads | Time travel and warehouse snapshots | No T-SQL time travel; producer's Delta history via Spark only |
| Freshness | Exactly when your load commits | When the endpoint's metadata sync catches up |
| Storage cost | A second copy | No copy |
| Blast radius of upstream change | Contained at your load step | Hits every query once the endpoint syncs the change |

On point-in-time reads for shortcuts: the producer's Delta history is reachable from Spark (`DESCRIBE HISTORY`, `VERSION AS OF`), but only as far back as the retention the producer keeps, and they can vacuum it away without asking you.

The last row is the one people underestimate. A shortcut is a live dependency. That's its whole value, and it's also why I treat it the way I described in [OneLake shortcuts are dependencies](/blog/2026-04-06-onelake-shortcuts-in-practice-why-governance-has-to-be-designed-before-scale/).

## My placement rule

I put a table in the Warehouse when **any** of these is true:

1. **A business number is published from it.** If finance, a regulator, or an executive dashboard reads it, I want a load step I control, a transaction boundary, and the ability to answer "what did this say on Tuesday?" without asking another team.
2. **It needs to change in step with other tables.** A fact and the dimensions it references should land together. Only the Warehouse gives you `BEGIN TRANSACTION ... COMMIT` across them.
3. **Its schema is part of my contract, not the producer's.** Conformed dimensions, surrogate keys, and declared grain (the subject of [deciding fact table grain first](/blog/2026-03-06-fabric-warehouse-tradeoffs-choosing-model-grain-before-performance-tuning/)) belong to the warehouse team.
4. **It's queried hard and often.** Repeatedly joining large shortcut tables through cross-database queries works, but you're paying to re-read someone else's file layout every time, and you can't tune it.

I leave a table as a shortcut when **all** of these are true:

1. It's reference or exploratory data where "latest" is the right answer and a few minutes' lag is fine.
2. The producer is a team with a stable schema and a change process I can see.
3. Nothing published depends on it directly; at most it feeds a Warehouse load, and that load is the checkpoint.

In practice, that means the shortcut is usually the *source* of a warehouse load rather than the thing reports query. Shortcuts are an excellent ingestion surface. They are a poor serving surface for anything with a sign-off attached.

## The pattern: shortcut in, owned table out

The reliable shape is three steps: make sure the endpoint has the latest Delta commit, merge from the shortcut into a Warehouse table inside a transaction, and record what you loaded.

### Whose identity reads the shortcut

Before any of the steps, know which identity the read is checked against, because it surprises people. Through the SQL analytics endpoint in its default delegated identity mode, access to the shortcut target is checked against the lakehouse owner's identity, not the identity running the load ([OneLake shortcuts](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts); the default mode and the alternative are described in [SQL analytics endpoint access modes](https://learn.microsoft.com/fabric/onelake/security/sql-analytics-endpoint-onelake-security)). If that owner loses access to the target workspace, every query over the shortcut fails, and the error can look like a missing table. If you've switched the endpoint to user identity mode under OneLake security, the load identity itself needs read access on the target. I go through the governance side in the OneLake shortcut post linked above.

### Step 1: force a metadata refresh before you read

If a pipeline writes to a lakehouse with Spark and then immediately reads it through the SQL analytics endpoint, you can race the sync. Call the refresh API first. The script below assumes the Azure CLI is signed in with an identity that has Contributor or higher on the workspace.

```bash
#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ID="<your-workspace-id>"
SQL_ENDPOINT_ID="<your-sql-analytics-endpoint-id>"

TOKEN=$(az account get-access-token \
  --resource https://api.fabric.microsoft.com \
  --query accessToken -o tsv)

HTTP_STATUS=$(curl -sS -X POST \
  "https://api.fabric.microsoft.com/v1/workspaces/${WORKSPACE_ID}/sqlEndpoints/${SQL_ENDPOINT_ID}/refreshMetadata" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -D refresh-headers.txt -o refresh-result.json \
  -w '%{http_code}')

header() {
  grep -i "^$1:" refresh-headers.txt | head -n1 | cut -d' ' -f2- | tr -d '\r'
}

case "${HTTP_STATUS}" in
  200)
    echo "Metadata refresh completed synchronously" ;;
  202)
    OPERATION_URL=$(header Location)
    STATE=""
    for attempt in $(seq 1 60); do
      WAIT=$(header Retry-After || true)
      sleep "${WAIT:-5}"
      POLL_STATUS=$(curl -sS "${OPERATION_URL}" -H "Authorization: Bearer ${TOKEN}" \
        -D refresh-headers.txt -o operation-state.json -w '%{http_code}')
      if [ "${POLL_STATUS}" != "200" ]; then
        echo "Polling the operation failed with HTTP ${POLL_STATUS}" >&2
        cat operation-state.json >&2
        exit 1
      fi
      STATE=$(jq -r '.status' operation-state.json)
      case "${STATE}" in
        Succeeded) break ;;
        NotStarted|Running) echo "Attempt ${attempt}: ${STATE}" ;;
        *) echo "Metadata refresh operation ended in state ${STATE}" >&2
           cat operation-state.json >&2
           exit 1 ;;
      esac
    done
    if [ "${STATE}" != "Succeeded" ]; then
      echo "Timed out waiting for the metadata refresh (last state: ${STATE})" >&2
      exit 1
    fi
    RESULT_STATUS=$(curl -sS "${OPERATION_URL}/result" -H "Authorization: Bearer ${TOKEN}" \
      -o refresh-result.json -w '%{http_code}')
    if [ "${RESULT_STATUS}" != "200" ]; then
      echo "Fetching the refresh result failed with HTTP ${RESULT_STATUS}" >&2
      cat refresh-result.json >&2
      exit 1
    fi ;;
  *)
    echo "Metadata refresh failed with HTTP ${HTTP_STATUS}" >&2
    cat refresh-result.json >&2
    exit 1 ;;
esac

jq -e '.value | type == "array"' refresh-result.json > /dev/null || {
  echo "Unexpected refresh result" >&2
  cat refresh-result.json >&2
  exit 1
}

if jq -e '.value[] | select(.status == "Failure")' refresh-result.json > /dev/null; then
  echo "One or more tables failed to sync:" >&2
  jq -r '.value[] | select(.status == "Failure") | "\(.tableName): \(.error.message // "no message")"' \
    refresh-result.json >&2
  exit 1
fi

echo "All tables synced; safe to load"
```

The call is a long-running operation: a `200` means it finished and the body lists each table's sync status; a `202` means it's still running, so the script polls the `Location` URL (waiting as long as `Retry-After` asks) for up to 60 attempts, keeps waiting only while the state is `NotStarted` or `Running`, and fails on any other state or on a timeout, then fetches the per-table result and checks that it really is a list of tables. Any HTTP status other than the expected one, on the first call, on a poll, or on the result fetch, stops the pipeline, so an expired token or a `404` can't pass silently or spin forever. The final `jq -e` check matters most: a refresh can succeed as an operation while individual tables report `Failure`, and a load that reads a stale table and succeeds anyway is the worst outcome, because nothing alerts. In a Fabric pipeline, a Web activity with asynchronous handling or an Until loop can do the same polling; the per-table check still belongs in front of the load.

### Step 2: merge into the owned table, atomically

[`MERGE`](https://learn.microsoft.com/sql/t-sql/statements/merge-transact-sql?view=fabric) is now [generally available in Fabric Data Warehouse](https://learn.microsoft.com/fabric/data-warehouse/tsql-surface-area), which removes the old delete-then-insert dance. Wrapping it with the audit write in one transaction means the dimension and the record of loading it can't disagree.

This is a fragment: it assumes `dbo.dim_customer` (with `customer_id`, `customer_name`, `segment`, and a nullable `updated_at`) and `dbo.load_audit` already exist in the warehouse.

```sql
BEGIN TRANSACTION;

MERGE dbo.dim_customer AS tgt
USING (
    SELECT customer_id, customer_name, segment, updated_at
    FROM (
        SELECT customer_id, customer_name, segment, updated_at,
               ROW_NUMBER() OVER (
                   PARTITION BY customer_id
                   ORDER BY updated_at DESC
               ) AS rn
        FROM sales_lakehouse.dbo.customer
        WHERE updated_at >= DATEADD(day, -2, SYSUTCDATETIME())
    ) AS d
    WHERE rn = 1
) AS src
    ON tgt.customer_id = src.customer_id
WHEN MATCHED AND (tgt.updated_at IS NULL OR src.updated_at > tgt.updated_at) THEN
    UPDATE SET
        tgt.customer_name = src.customer_name,
        tgt.segment       = src.segment,
        tgt.updated_at    = src.updated_at
WHEN NOT MATCHED BY TARGET THEN
    INSERT (customer_id, customer_name, segment, updated_at)
    VALUES (src.customer_id, src.customer_name, src.segment, src.updated_at);

INSERT INTO dbo.load_audit (table_name, loaded_at_utc, source_max_updated_at)
SELECT 'dim_customer', SYSUTCDATETIME(), MAX(updated_at)
FROM sales_lakehouse.dbo.customer;

COMMIT TRANSACTION;
```

Here `sales_lakehouse.dbo.customer` is a shortcut table in a lakehouse in the same workspace as the warehouse. The two-day window is deliberately wider than the load frequency so a late or replayed batch is still picked up; the `updated_at` comparison stops older rows overwriting newer ones, and the `IS NULL` check means a row loaded before the column was populated still gets updated.

Two things to note. First, `MERGE` fails if more than one source row matches the same target row, and duplicate keys that don't match yet are inserted twice without warning. Producers do emit duplicates (replays, late corrections), so the `USING` subquery keeps only the latest row per `customer_id` with `ROW_NUMBER()`; if two rows tie on `updated_at`, add a tiebreaker column to the `ORDER BY` so the choice is deterministic. Second, if the producer renames or drops a column, this statement fails loudly at load time. That's the point: the breakage happens in a pipeline run you're watching, not in a report a stakeholder is reading.

### Step 3: answer "what did it say then?" from the warehouse

Once the table is owned, the audit question is a query rather than a meeting:

```sql
SELECT segment, COUNT(*) AS customers
FROM dbo.dim_customer
GROUP BY segment
OPTION (FOR TIMESTAMP AS OF '2026-04-14T22:00:00.000');
```

The timestamp is UTC. For a fixed reporting cut-off (month-end, a board pack), I'd go one step further and create a warehouse snapshot so report authors can point at a stable item instead of remembering a timestamp.

## When copying is the wrong call

The Warehouse-first rule has real costs, and I don't apply it blindly.

- **Large, append-only telemetry.** Copying billions of event rows into a warehouse to serve a handful of aggregate reports is waste. Aggregate in the lakehouse with Spark, then load the aggregate.
- **Data science consumers.** Teams working in notebooks want the Delta table, not a T-SQL copy. Warehouse tables are stored as Delta in OneLake too, so notebook users can read the owned copy read-only through a shortcut. What matters is who owns the write path. If the data scientists need to write and reshape it, give them the lakehouse table and keep the Warehouse for the BI side.
- **Short-lived analysis.** If a question will be answered this week and never asked again, a cross-database query over a shortcut is fine. Don't build a load you'll have to maintain.
- **Cross-workspace reach.** Three-part names only work within a workspace, so reaching another workspace already means creating a shortcut in a local lakehouse. In the endpoint's default delegated mode, that lakehouse's owner needs access to the target workspace, so a change of lakehouse owner can quietly break the source. That's acceptable as a source; it's another reason not to let reports read it directly.

There's also a cost argument people raise: a second copy doubles storage. Storage is rarely the line item that hurts on a Fabric capacity; compute on badly shaped queries is. A well-modelled warehouse table that's read a thousand times a day usually costs less overall than re-scanning a producer's layout a thousand times.

## Where the table lives

If someone signs off on a number, the table behind it lives in the Warehouse, loaded from a shortcut by a step you own. Everything else can stay a shortcut until it earns a copy. That rule won't win any architecture debates, but it makes ownership obvious, and obvious ownership is most of what "reliable" means in a shared Fabric estate.
