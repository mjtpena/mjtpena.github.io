---
title: "Microsoft Fabric: Six Months In Production"
author: Michael John Peña
draft: false
date: 2026-01-05
tags:
  - Fabric
  - Azure
  - Data
  - Analytics

---

I wrote "Microsoft Fabric: Six Months In Production" to share practical, production-minded guidance on this topic.

## What We're Running

- 3 workspaces (dev, staging, production)
- ~500GB in OneLake
- 15 data pipelines
- 8 Power BI reports
- 4 data warehouses
- Daily active users: 50

Capacity: F64

## What Works Really Well

**OneLake is brilliant.** One storage layer for everything. No more copying data between Synapse, Data Lake, and Power BI. It just works.

**Delta tables everywhere.** Time travel, ACID transactions, schema evolution. These aren't just features—they're game-changers for data quality.

**Direct Lake mode.** Our reports went from 5-10 second refresh to instant. Users notice. They ask less questions about why things are slow.

**Git integration.** Finally. Version control for Power BI. This alone justifies Fabric for some teams.

## What's Painful

**Pricing transparency.** Capacity units are confusing. We still can't accurately predict our monthly bill without actual usage data.

**Throttling.** Hit capacity limits? Your users get errors. There's no graceful degradation. It just stops working.

**Monitoring is primitive.** The capacity metrics app exists but it's not intuitive. We built custom monitoring because the built-in tools weren't enough.

**Migration complexity.** Moving from Synapse + Power BI to Fabric isn't straightforward. Budget more time than you think.

## The Gotchas

**Shared capacity means shared pain.** One bad query can impact all your workloads. Isolate resource-intensive jobs to their own capacity.

**Incremental refresh limitations.** Some features from Power BI Premium don't work the same way in Fabric. Test thoroughly.

**Cross-region performance.** If your capacity and data sources are in different regions, you'll feel it. Latency adds up.

**No rollback for lakehouse changes.** Schema changes are permanent. Test in dev. Seriously.

## Real Cost Numbers

Our F64 capacity runs ~$8,000/month. Previously:
- Synapse dedicated pool: $6,000/month
- Power BI Premium: $5,000/month
- Data Lake Gen2: $1,000/month

**Previous total: $12,000/month**

Fabric is cheaper. But it's also doing more. Hard to do a pure apples-to-apples comparison.

## What I'd Do Differently

1. **Start smaller.** We went F64 based on recommendations. Probably could have started at F32 and scaled up.

2. **Test thoroughly.** We hit several "that works differently in Fabric" moments. More testing would have caught them.

3. **Plan for monitoring.** Build observability from day one. The native tools aren't enough.

4. **Document capacity patterns.** Track what consumes capacity units. You'll need this for optimization.

5. **Set clear guidelines.** Without guardrails, users will create chaos. Establish naming conventions, workspace structure, and approval processes early.

## Who Should Adopt Fabric?

**Good fit:**
- Heavy Power BI users
- Teams consolidating multiple Azure data services
- Organizations wanting simplified data architecture
- Companies with Microsoft-centric stack

**Not yet:**
- Real-time requirements with strict SLAs
- Multi-cloud strategies requiring vendor flexibility
- Teams wanting maximum control over infrastructure
- Organizations with limited Azure expertise

## The Verdict

Fabric is Microsoft's vision for unified analytics, and it's mostly delivering. The integration story is strong. The performance is good. The experience is better than managing 5 separate services.

But it's still maturing. Expect rough edges. Budget time for learning. Don't migrate everything at once.

For us? It's working. We're staying on Fabric. But we're also being realistic about its limitations.

If you're considering Fabric, my advice: start a proof of concept with a non-critical workload. Learn the platform. Understand the costs. Then decide.

The future of data platforms is unified experiences like Fabric. But the present still requires careful evaluation and planning.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
