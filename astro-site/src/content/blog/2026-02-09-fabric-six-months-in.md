---
title: "Microsoft Fabric: Six Months In Production"
description: "It worked, but managing five services with five billing models and five sets of credentials was painful."
author: Michael John Peña
draft: false
date: 2026-02-09
tags:
  - Fabric
  - Azure
  - Data
  - Engineering
---

## What We Migrated From

A mess of:

- Azure Data Factory for orchestration
- Azure Databricks for processing
- Azure SQL for serving
- Power BI for reporting
- Separate storage accounts everywhere

It worked, but managing five services with five billing models and five sets of credentials was painful.

## What Fabric Promised

One platform. Unified experience. Single billing. Shared capacity.

## What Fabric Delivered

### The Good

**OneLake is the real deal.** One storage layer. Everything reads from and writes to the same place. No more copying data between services.

```
Before: ADF → Blob Storage → Databricks → SQL → Power BI
After:  Fabric Pipeline → Lakehouse → Power BI
```

Fewer hops means fewer failures.

**Notebooks work well.** PySpark notebooks in Fabric are solid. Not as feature-rich as Databricks, but good enough for 80% of workloads.

**Power BI integration is seamless.** Direct Lake mode is fast. Reports query the lakehouse directly. No import needed.

**Unified billing simplifies budgeting.** One capacity unit. One bill. Finance stopped asking me to explain five different Azure meters.

### The Mixed

**Capacity management requires attention.** Fabric uses shared capacity units (CUs). Spark jobs, SQL queries, and Power BI all compete for the same pool.

We've had situations where a heavy Spark job starved Power BI reports. Took time to learn the right capacity sizing.

**Data Engineering vs Data Science experiences.** They're separate but overlap. Sometimes confusing which to use for what.

**Git integration exists but isn't perfect.** Works for notebooks and pipelines. Less mature for other artifact types.

### The Frustrating

**Some features are still preview.** Real-time analytics, Copilot integration—they exist but aren't production-ready for everything.

**Migration wasn't trivial.** Despite what Microsoft says, moving from Databricks to Fabric notebooks required real refactoring. Different Spark configurations, different libraries.

**Documentation gaps.** For edge cases, you're on your own. Community forums are the real documentation.

## Who Should Consider Fabric

**Microsoft shops.** If you're already on M365, Power BI, and Azure, Fabric is natural.

**Mid-size data teams.** Teams of 3-10 who don't want to manage multiple services.

**Organizations wanting simplicity.** If your current stack has too many moving parts.

## Who Should Wait

**Heavy Databricks users.** Fabric notebooks aren't at Databricks feature parity. If you need Unity Catalog, MLflow integration, or advanced cluster management, stay on Databricks.

**Teams needing cutting-edge features.** Fabric moves fast but some capabilities are still maturing.

## The Verdict

Six months in, I'd make the same choice again. The simplification is worth the trade-offs.

It's not perfect. But it solved the operational complexity problem we had.

For Azure-first data teams, Fabric is the right direction. Just go in with realistic expectations.
