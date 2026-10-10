---
title: "Azure SQL Elastic Pools: When Pooling Saves Money and When It Doesn't"
description: "How to size an Azure SQL Database elastic pool for database-per-tenant SaaS, measure tenant load first, and spot the workloads where pooling costs more."
author: Michael John Peña
draft: false
date: 2020-08-10
tags:
  - Azure
  - SQL
  - Database
  - Cost Optimization
  - Multi-Tenant
---

Database-per-tenant SaaS hits the same wall as the customer count grows: the bill for a hundred half-idle Standard tier databases is hard to justify. Elastic pools are the right tool for that shape. You pool the compute, and the noisy tenants borrow from the quiet ones. The maths usually works out, but only if you've measured your tenant load distribution first, so this post covers the measurement as much as the setup.

## What a pool actually buys you

An [elastic pool](https://learn.microsoft.com/azure/azure-sql/database/elastic-pool-overview) is a fixed amount of compute and storage on a logical server that a set of databases share. You pay for the pool, not for each database. Every database keeps its own isolation boundary (its own users, backups, point-in-time restore, and connection string), and they all draw from the same bucket of resources.

Pools come in both purchasing models:

- **DTU model**: Basic, Standard, and Premium pools, sized in eDTUs (elastic Database Transaction Units). An eDTU is the same blended measure of CPU, memory, and IO as a DTU on a single database. The difference is that the eDTUs are shared.
- **vCore model**: General Purpose and Business Critical pools, sized in vCores, with Azure Hybrid Benefit available if you already own SQL Server licences.

The pricing detail that drives every sizing decision differs between the two. In the DTU model, **the eDTU unit price in a pool is 1.5 times the DTU unit price of a single database**. In the vCore model, pool vCores cost the same as single-database vCores, so a vCore pool wins as soon as the combined peak needs fewer vCores than the databases would separately. A DTU pool only saves money if sharing lets you buy far fewer units than the single databases would need in total.

### DTU or vCore pool?

| Factor | DTU pool (Basic, Standard, Premium) | vCore pool (General Purpose, Business Critical) |
|---|---|---|
| Unit price vs single database | 1.5x per eDTU | Same per vCore |
| Azure Hybrid Benefit | Not available | Available if you own SQL Server licences with Software Assurance |
| Storage | Bundled with the eDTU size; more storage often means buying more eDTUs | Sized and billed separately from compute |
| Smallest pool | 50 eDTU (Basic) | 2 vCores (General Purpose, Gen5) |
| Max databases per pool | 100 to 500 (Basic, Standard); 50 to 100 (Premium) | 100 to 500 (General Purpose); 50 to 100 (Business Critical) |

The [DTU pool limits](https://learn.microsoft.com/azure/azure-sql/database/resource-limits-dtu-elastic-pools) often decide the size before compute does. A 100 eDTU Standard pool holds at most 200 databases and includes 100 GB of storage (extendable to 750 GB), so a few hundred tenants or a few large databases can push you up a tier even when the CPU is idle.

My rule for choosing between them: small pools of small tenants usually belong in the DTU model, because the smallest General Purpose pool is 2 vCores, and Microsoft's own migration guidance maps every 100 Standard DTUs to *at least* one vCore. Once you're pricing pools of several hundred eDTU, or you already own SQL Server licences, price the equivalent General Purpose pool as well. Without the 1.5x premium, and with Hybrid Benefit and independently scaled storage, the vCore pool often comes out ahead at that size. The rest of this post works through the DTU model because that's where the break-even maths is least obvious.

## The back-of-envelope I do first

For DTU pools, my rule of thumb follows directly from that 1.5x premium. Add up the DTUs your databases would need as single databases. If that total is more than 1.5 times the eDTUs the pool needs to handle the *combined* peak, the pool wins. If it isn't, it doesn't.

A worked example using price ratios, so it holds in any region:

| Option | Units bought | Relative cost |
|---|---|---|
| 10 x S1 single databases (20 DTU each) | 200 DTU | 200 |
| 1 x Standard pool, 100 eDTU | 100 eDTU at 1.5x | 150 |
| 1 x Standard pool, 200 eDTU | 200 eDTU at 1.5x | 300 |

This compares compute only. Ten S1s include 250 GB each, while the 100 eDTU pool includes 100 GB and caps at 750 GB, so check total data size before trusting the ratio.

The 100 eDTU pool saves about 25%, but only if ten tenants that each peak at 20 DTU never need more than 100 DTU *at the same time*. If the combined peak needs 200 eDTU, the pool costs 50% more than the single databases. Same tenants, same workload, opposite answer. That's why I don't recommend a pool from a database count alone.

The profile that pools well looks like this:

- Many databases, each with a low average and occasional spikes.
- Spikes that land at different times (tenants in different time zones, batch jobs at different hours, uneven usage across customers).
- No single database that needs most of the pool for long stretches.

## Measure before you pool

If the databases already exist, Azure SQL keeps the evidence. [`sys.resource_stats`](https://learn.microsoft.com/sql/relational-databases/system-catalog-views/sys-resource-stats-azure-sql-database) holds roughly 14 days of history in 5-minute intervals for every database on the server. It lives in the `master` database of the logical server, so connect there to run this:

```sql
-- Run in the master database of the logical server.
-- Per-database average and peak usage over the last 14 days.
SELECT
    database_name,
    AVG(avg_cpu_percent)       AS avg_cpu,
    MAX(avg_cpu_percent)       AS peak_cpu,
    AVG(avg_data_io_percent)   AS avg_data_io,
    MAX(avg_data_io_percent)   AS peak_data_io,
    MAX(avg_log_write_percent) AS peak_log_write,
    MAX(dtu_limit)             AS dtu_limit
FROM sys.resource_stats
WHERE start_time > DATEADD(day, -14, GETUTCDATE())
GROUP BY database_name
ORDER BY peak_cpu DESC;
```

Per-database averages and peaks tell you whether each tenant is spiky. They don't tell you whether the spikes overlap, and overlap is the question that decides the pool size. For that, convert each 5-minute row into approximate DTUs consumed and add them up per interval:

```sql
-- Run in the master database.
-- Approximate DTUs consumed across all databases, per 5-minute window.
-- DTU usage is the highest of CPU, data IO and log write percentages.
WITH per_db AS (
    SELECT
        start_time,
        database_name,
        dtu_limit * (
            SELECT MAX(v) FROM (VALUES
                (avg_cpu_percent),
                (avg_data_io_percent),
                (avg_log_write_percent)) AS t(v)
        ) / 100.0 AS dtu_used
    FROM sys.resource_stats
    WHERE start_time > DATEADD(day, -14, GETUTCDATE())
)
SELECT TOP (20)
    start_time,
    COUNT(*)      AS databases_reporting,
    SUM(dtu_used) AS combined_dtu
FROM per_db
GROUP BY start_time
ORDER BY combined_dtu DESC;
```

The top rows are your combined peaks. If the highest `combined_dtu` sits comfortably under a pool size, and that pool size times 1.5 is less than what you pay for the single databases today, you have a case. If the top 20 windows all fall at 9am on weekdays, you've learned something about your customers that matters more than the pool.

`databases_reporting` tells you how many databases had a row in that window; if it's well below your database count, treat `combined_dtu` as a lower bound.

These queries assume DTU-model databases; for vCore databases `dtu_limit` is NULL, so use `cpu_limit * avg_cpu_percent / 100` to estimate vCores used instead.

The second query is an estimate. Five-minute averages smooth out short bursts, so leave headroom (I'd add at least 20 to 30 percent) rather than sizing to the exact peak.

## Creating the pool

With the Azure CLI, creating a Standard pool and adding tenant databases to it looks like this. Values in angle brackets are placeholders.

```bash
# Logical server (skip if you already have one)
az sql server create \
    --resource-group <resource-group> \
    --name <server-name> \
    --location australiaeast \
    --admin-user <admin-login> \
    --admin-password '<strong-password>'

# 100 eDTU Standard pool; each database can use between 0 and 50 eDTU
az sql elastic-pool create \
    --resource-group <resource-group> \
    --server <server-name> \
    --name pool-tenants-std \
    --edition Standard \
    --capacity 100 \
    --db-min-capacity 0 \
    --db-max-capacity 50

# New tenant databases go straight into the pool
az sql db create \
    --resource-group <resource-group> \
    --server <server-name> \
    --name tenant-contoso \
    --elastic-pool pool-tenants-std

# Existing single databases can be moved in online
az sql db update \
    --resource-group <resource-group> \
    --server <server-name> \
    --name tenant-fabrikam \
    --elastic-pool pool-tenants-std
```

Two settings deserve more thought than they usually get.

**Per-database maximum (`--db-max-capacity`).** This is your noisy-neighbour control. If one tenant can take all 100 eDTU, one runaway report can stall every other customer in the pool. Capping each database at half the pool, or lower, keeps a single bad query from becoming a platform-wide incident. The cost is that a legitimately busy tenant gets throttled sooner.

**Per-database minimum (`--db-min-capacity`).** A minimum above zero guarantees each database that capacity, but it's reserved: the number of databases multiplied by the minimum can't exceed the pool's eDTUs. Set a minimum of 10 on a 100 eDTU pool and you've capped the pool at ten databases. I leave it at zero unless a tenant has a contractual performance floor, and those tenants usually belong in their own pool anyway.

## Watching the pool once it's live

Pool-level telemetry lives in `sys.elastic_pool_resource_stats`, also in `master`. It reports in 15-second windows and keeps about 14 days of history.

```sql
-- Run in the master database.
-- Pool usage over the last hour, most recent first.
SELECT
    end_time,
    elastic_pool_name,
    avg_cpu_percent,
    avg_data_io_percent,
    avg_log_write_percent,
    avg_storage_percent,
    max_worker_percent,
    max_session_percent
FROM sys.elastic_pool_resource_stats
WHERE elastic_pool_name = 'pool-tenants-std'
  AND end_time > DATEADD(hour, -1, GETUTCDATE())
ORDER BY end_time DESC;
```

Watch `max_worker_percent` as closely as CPU. Pools have a worker limit that scales with pool size (200 concurrent workers on a 100 eDTU Standard pool), and a pool with lots of chatty tenants can hit it while CPU still looks healthy. To find which tenant is driving a spike, query `sys.dm_db_resource_stats` inside the suspect database (it keeps one hour of 15-second data), or go back to `sys.resource_stats` in `master` for longer windows. I'd also set Azure Monitor alerts on pool eDTU percentage and storage percentage. A full pool is worse than a full single database because every tenant in it fills up at the same moment.

Scaling is a single command, and it's an online operation, though open connections can be dropped briefly when the change completes:

```bash
az sql elastic-pool update \
    --resource-group <resource-group> \
    --server <server-name> \
    --name pool-tenants-std \
    --capacity 200
```

## Connecting to tenant databases

Your application code barely changes. Each tenant still has its own database name, and the pool isn't visible in the connection string. Build the connection string per tenant and avoid putting the SQL admin password in it. With Azure AD authentication configured on the server, `Microsoft.Data.SqlClient` can take an access token from `Azure.Identity`, which works with a managed identity in Azure and your developer sign-in locally:

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Identity;
using Microsoft.Data.SqlClient;

public class TenantConnectionFactory
{
    private static readonly string[] SqlScope = { "https://database.windows.net/.default" };

    // One credential and one cached token for every factory instance.
    private static readonly TokenCredential Credential = new DefaultAzureCredential();
    private static readonly SemaphoreSlim TokenLock = new SemaphoreSlim(1, 1);
    private static AccessToken _cachedToken;

    private readonly string _serverName;

    public TenantConnectionFactory(string serverName)
    {
        _serverName = serverName;
    }

    public async Task<SqlConnection> OpenAsync(string tenantId)
    {
        var builder = new SqlConnectionStringBuilder
        {
            DataSource = $"tcp:{_serverName}.database.windows.net,1433",
            InitialCatalog = $"tenant-{tenantId}",
            Encrypt = true,
            TrustServerCertificate = false,
            ConnectTimeout = 30
        };

        var token = await GetTokenAsync();

        var connection = new SqlConnection(builder.ConnectionString)
        {
            AccessToken = token
        };
        await connection.OpenAsync();
        return connection;
    }

    // Azure.Identity 1.2 (current as of August 2020) doesn't cache managed identity
    // tokens, so without this every connection open would call the token endpoint.
    private static async Task<string> GetTokenAsync()
    {
        await TokenLock.WaitAsync();
        try
        {
            if (_cachedToken.Token == null ||
                _cachedToken.ExpiresOn <= DateTimeOffset.UtcNow.AddMinutes(5))
            {
                _cachedToken = await Credential.GetTokenAsync(
                    new TokenRequestContext(SqlScope), CancellationToken.None);
            }
            return _cachedToken.Token;
        }
        finally
        {
            TokenLock.Release();
        }
    }
}
```

Validate `tenantId` against your tenant catalogue before building the name, because it ends up in a connection string. Connection pooling in SqlClient is per connection string and, when you set `AccessToken`, per token as well, so pools turn over each time the token refreshes. Caching the token for most of its lifetime keeps that churn low. Either way, a few hundred tenants means a few hundred small client-side pools. That's fine at this scale, but it's worth knowing when you see connection counts in `max_session_percent`.

Once you're past a handful of tenants, a catalogue that maps tenant to server, pool, and database becomes essential. You can build your own table for that or use the Elastic Database client library and its shard map manager, which also handles data-dependent routing when tenants move to a different server or database. Moving a database between pools on the same server changes neither its server nor its name, so that alone needs no routing change. For running schema migrations across every tenant database, [Elastic Database Jobs](https://learn.microsoft.com/azure/azure-sql/database/elastic-jobs-overview) is still in preview as of August 2020, so I'd run migrations from the release pipeline instead.

## When a pool is the wrong answer

Pools aren't a default. I'd skip them in these cases:

- **Correlated peaks.** If every tenant hits the system at 9am and again at 4pm, the pool must be sized for the simultaneous peak. In a DTU pool, at 1.5x the unit price, that's usually more expensive than individual databases on a smaller tier. A vCore pool with correlated peaks costs about the same as separate databases, so you take on the noisy-neighbour risk for no saving.
- **One or two heavy tenants.** A tenant that needs most of the pool most of the time should be a single database. Leaving it in the pool turns it into everyone else's noisy neighbour.
- **Long idle periods on a few databases.** For a small number of databases that sit idle for hours, the vCore [serverless tier](https://learn.microsoft.com/azure/azure-sql/database/serverless-tier-overview) (generally available since November 2019 for single databases) can auto-pause and bill only storage while paused. Serverless isn't available inside elastic pools, so it's one or the other per database.
- **Mixed service levels.** If you sell a premium tier with guaranteed performance, put those tenants in their own pool or on single databases. One pool shouldn't carry two SLAs.

## The decision in one paragraph

Measure first: pull 14 days of `sys.resource_stats`, sum the DTU usage per interval, and find your real combined peak. For a DTU pool, if the single-database total is more than 1.5 times the eDTUs that peak needs, pool them; for larger estates, price the General Purpose vCore pool alongside it. Then cap per-database eDTU so one tenant can't starve the rest, and alert on workers and storage as well as eDTU. If the peaks line up, keep the databases separate and put the effort into query tuning and right-sizing each tier.
