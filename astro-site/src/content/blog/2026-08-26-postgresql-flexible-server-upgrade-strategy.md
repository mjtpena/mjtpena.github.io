---
title: "PostgreSQL Major Upgrades on Azure: Validate Early, Don't Pay to Wait"
description: "Pre-upgrade validation for Azure PostgreSQL Flexible Server is GA and Extended Support is now billed. An upgrade runbook and a version policy to avoid paying."
author: Michael John Peña
draft: false
date: 2026-08-26
tags:
  - Azure
  - PostgreSQL
  - Database
  - DevOps
  - FinOps
---

This month, [pre-upgrade validation checks](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/how-to-run-upgrade-validation-checks) for Azure Database for PostgreSQL Flexible Server went GA. Since 1 August, servers still on PostgreSQL 11, 12 or 13 have been enrolled in [paid Extended Support](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/extended-support). One makes major upgrades cheaper to plan; the other makes not upgrading cost money. If Extended Support appears in your forecast as anything other than a short, dated bridge, the real problem is your upgrade process.

## What actually changed

**Validation checks are GA.** You can now ask the service whether a server can be upgraded to a target major version without upgrading it. In the portal it's a *Validate only* option on the Upgrade blade. In the CLI it's the `--validate-only` flag on `az postgres flexible-server upgrade`. The check runs the Azure-specific upgrade rules (server state, target version support, storage headroom) together with PostgreSQL's own `pg_upgrade --check`. The flag shipped in Azure CLI 2.89.0, so update your agents before relying on it. It doesn't change the server version and doesn't cause downtime. When it finds a blocker, the result includes an error description and remediation guidance, and the portal lets you download the results as a CSV. The how-to page lists the limits worth knowing:

- The server must be in the *Ready* state, with no other operation in progress.
- It doesn't run against read replicas.
- It needs to connect to every database on the server, so one inaccessible database will fail the whole validation.

**Extended Support is now a line item.** Servers on versions past Azure standard support were enrolled automatically on 1 August 2026, and the charge applies from that date: the Azure CLI warns anyone who selects 11, 12 or 13 that they are enrolled "for an additional charge starting August 1, 2026". It's billed per vCore-hour on top of normal compute. You can't opt out. The only way to stop paying is to upgrade, and if you upgrade partway through a billing period you pay only for the hours spent on the unsupported version. What you get is critical security patching and technical support. You don't get new features.

The timeline matters more than the price. PostgreSQL 13's Azure standard support ended on 31 July 2026. PostgreSQL 14 reaches community end of life on 12 November 2026, and the [version policy](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-version-policy) is where Azure sets its own standard support end date for it. Plan against 12 November, not against whatever grace period follows. Any fleet that just finished moving off 13 by upgrading to 14 is already on the next deadline.

## Extended Support is a budget line, not a strategy

I don't think Extended Support is a bad product. Some teams genuinely can't upgrade on time: a vendor application certified only on one version, an extension that hasn't caught up, a regulated change freeze. For them, paying for security patches is far better than running unpatched. That's what the offering is for.

The problem is when Extended Support stops being an exception and becomes the plan. Three things go wrong:

1. **The cost grows with your largest servers.** It's billed per vCore, so the biggest, busiest production servers cost the most to leave behind. Those are also the servers teams are most nervous about upgrading.
2. **It hides upgrade debt instead of paying it down.** A server two versions behind next year has a bigger version jump to make, more deprecated behaviour to deal with, and more extensions to check. Waiting makes the eventual upgrade harder.
3. **It still ends.** Extended Support has an end date for every version. When that date arrives, you have the same upgrade to do with less time and a team that has spent the interim not practising it.

My rule: Extended Support is approved per server, with a named owner, a reason, and an upgrade date within one quarter. If nobody will put a date on it, the charge isn't buying time, it's buying postponement.

## The upgrade runbook

### 1. Run validation in CI against a restored copy

Microsoft's own guidance says the in-place major version upgrade can't be reversed. They recommend a point-in-time restore of production and a test upgrade on that copy first. Validation only checks; it doesn't upgrade anything. Put them together and you get a pipeline you can run on a schedule, not once a year:

```bash
#!/usr/bin/env bash
# Rehearse a major version upgrade against a point-in-time restore of production.
set -euo pipefail

RG="<your-resource-group>"
SOURCE="<your-production-server>"
REHEARSAL="${SOURCE}-upgrade-rehearsal"
TARGET_VERSION="17"

# Always remove the rehearsal server, even when a step fails, so a
# full-size copy of production never sits there billing.
cleanup() {
  az postgres flexible-server delete --resource-group "$RG" --name "$REHEARSAL" --yes || true
}
trap cleanup EXIT

# Restore the latest recoverable point of production into a throwaway server.
az postgres flexible-server restore \
  --resource-group "$RG" \
  --name "$REHEARSAL" \
  --source-server "$SOURCE"

# Readiness report: no version change, no downtime. Keep it as a build artifact.
az postgres flexible-server upgrade \
  --resource-group "$RG" \
  --name "$REHEARSAL" \
  --version "$TARGET_VERSION" \
  --validate-only > validation-result.json

# The command exits 0 even when validation finds blockers, so gate on the result.
status=$(jq -r '.properties.status' validation-result.json)
if [ "$status" != "Succeeded" ]; then
  echo "Validation returned '$status'. Blockers:" >&2
  jq '.properties.precheckResult.errorInfo' validation-result.json >&2
  exit 1
fi

# Real upgrade on the copy. A failure here fails the pipeline.
az postgres flexible-server upgrade \
  --resource-group "$RG" \
  --name "$REHEARSAL" \
  --version "$TARGET_VERSION" \
  --yes

# Fetch an Entra token now: it expires after about an hour, so don't fetch it at job start.
# Drop these two lines if PGPASSWORD already holds a password from your secret store.
PGPASSWORD=$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)
export PGPASSWORD

# Rebuild planner statistics before running smoke tests or timing queries.
vacuumdb --host "${REHEARSAL}.postgres.database.azure.com" \
  --username "<admin-user>" --all --analyze-in-stages
```

The validation result is kept as a build artifact, and the pipeline stops there if validation doesn't return `Succeeded`, printing the blockers and remediation details from the precheck result. The `EXIT` trap deletes the rehearsal server whether the run passes or fails. Credentials come from `PGPASSWORD`, either a password from the pipeline's secret store or a Microsoft Entra access token fetched straight after the upgrade, never hard-coded. The agent running this needs network access to the rehearsal server (a firewall rule for public access, or a self-hosted agent in the VNet for private access). The rehearsal tells you two things validation alone can't: how long the upgrade takes on your actual data, and whether your application's queries behave on the new version. That duration is the outage you'll be negotiating with the business, so measure it. Don't guess.

The `vacuumdb` step isn't optional. Microsoft's docs say to run `ANALYZE` in each database after the upgrade, because missing statistics lead to poor plans and high memory use. If you skip it in the rehearsal, your performance comparison means nothing.

### 2. Check extensions and replication before the window

The most common upgrade blockers in Microsoft's documentation are extensions and replication; the [major version upgrade page](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-major-version-upgrade) lists the unsupported extensions and other limitations for each target. Validation catches unsupported extensions and logical slots, but you want to know weeks ahead, not on the night. Run this in every database:

```sql
-- Installed extensions and versions: compare against the documented
-- unsupported-for-upgrade list for your target version.
SELECT extname, extversion FROM pg_extension ORDER BY extname;

-- Logical replication slots block in-place upgrade and must be dropped first.
SELECT slot_name, slot_type, database, active FROM pg_replication_slots;

-- Publications and subscriptions usually mean a downstream consumer depends on this server.
SELECT pubname FROM pg_publication;
SELECT subname, subenabled FROM pg_subscription;
```

Read replicas need the same attention. In-place upgrade doesn't carry them across, so the documented approach is to delete the replica before upgrading the primary and recreate it afterwards. That has knock-on effects: reporting workloads pointed at the replica, a CDC tool reading from a logical slot, anything mirroring the server into Fabric. List them with `az postgres flexible-server replica list`, and get the owners of everything downstream to agree on the window before you drop anything. Dropping a slot breaks the subscriber reading from it, and that subscriber usually belongs to another team.

High availability is simpler: for HA-enabled servers, the service disables HA, upgrades the primary, and re-enables HA afterwards. Plan for the time HA takes to rebuild, but there's nothing extra to do.

### 3. Decide: in-place or logical-replication cutover

| | In-place (`pg_upgrade`) | New server + logical replication |
|---|---|---|
| Downtime | Whole upgrade duration | Cutover only (seconds to minutes) |
| Endpoint | Unchanged | New server name, or a DNS/connection-string switch |
| Effort | Low: one operation, implicit backup taken first | High: schema copy, replication setup, sequence sync, cutover |
| Rollback | Restore from backup | Old server still running until you decommission it |
| Blocked by | Unsupported extensions, logical slots, replicas | Tables without primary keys or replica identity, DDL during sync |

In-place should be the default. It's well tested, keeps the endpoint, and the service takes a backup before it starts. You can also skip versions: the upgrade goes straight from your current version to the target, and the CLI accepts 18 as a target, so 13 to 17 or 18 is one operation rather than a staircase. Choose logical replication only when the rehearsed downtime is longer than the business will accept, or when you want a running old server as your rollback. Microsoft has a [walkthrough of the logical replication approach](https://techcommunity.microsoft.com/blog/adforpostgresql/upgrade-azure-database-for-postgresql-with-minimal-downtime-using-logical-replic/4466784), and the migration service in Azure Database for PostgreSQL supports online migration if you'd rather not set up replication yourself.

Don't pick logical replication just because it sounds safer. It moves risk from the outage window into weeks of replication you have to monitor, and DDL changes during that period are the most common way it breaks. If the rehearsal says in-place takes fifteen minutes and you already have a monthly maintenance window, take the fifteen minutes.

### 4. Set a version-lag policy and enforce it

This is what separates teams that pay for Extended Support from teams that don't. Mine is short:

- **Production runs within one major version of the latest version GA on Flexible Server.** With 18 GA, that means 17 or 18.
- **Nothing runs on a version whose community end of life is within six months** without a scheduled upgrade date.
- **Rehearsals run quarterly**, not only when a deadline comes up, so the pipeline above never goes stale.
- **Extended Support needs an exception** with an owner and a date, as described above.

Enforcing it is a query, not a meeting. Azure Resource Graph exposes the server version, so a scheduled check like this fragment lists every Flexible Server below your floor, with the tags for owner and cost centre:

```kusto
// Fragment: run in Azure Resource Graph Explorer or az graph query.
Resources
| where type =~ 'microsoft.dbforpostgresql/flexibleservers'
| extend majorVersion = toint(properties.version)
| where majorVersion < 17
| project name, resourceGroup, subscriptionId, majorVersion, tags
| order by majorVersion asc
```

That gives you the list to chase. I'd put that report in front of the same people who see the cloud bill. A team that sees an Extended Support charge next to its name tends to schedule the upgrade. The same thinking applies to [AKS upgrades](/blog/2021-10-01-azure-kubernetes-service-upgrades/): a fixed version window enforced by automation beats heroics every time. If you're new to the service itself, my [Flexible Server deep dive](/blog/2022-07-13-azure-database-postgresql-flexible-server/) covers the basics.

## The decision

If you're on 11, 12 or 13 today, you're already paying, and every week of delay costs money and makes the eventual jump bigger. Run validation this week against a restored copy, fix what it reports, and book the window. If you're on 14, community support ends on 12 November, so start the rehearsal pipeline now while it's still routine. Extended Support is worth having as insurance for the one server with a real blocker. If it applies to most of your fleet, it means nobody owns your upgrade process.
