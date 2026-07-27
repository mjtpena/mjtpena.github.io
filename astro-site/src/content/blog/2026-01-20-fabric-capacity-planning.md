---
title: "Fabric Capacity Planning: Lessons from Production"
author: Michael John Peña
draft: false
date: 2026-01-20
tags:
  - Fabric
  - Azure
  - Planning
  - Cost

---

I wrote "Fabric Capacity Planning: Lessons from Production" to share practical, production-minded guidance on this topic.

## Mistake 1: Starting Too Big

Started with F64 because "enterprise." Spent money we didn't need to.

**Lesson:** Start smaller. F32 was enough. Can always scale up.

## Mistake 2: Not Monitoring

Hit capacity limits without warning. Users got errors.

**Lesson:** Set up monitoring from day one. Alert before hitting limits.

## Mistake 3: Ignoring Patterns

Some days used 20% capacity. Others hit 90%. Paid for peak.

**Lesson:** Analyze usage patterns. Consider autoscale or lower base capacity.

## What We Do Now

**Start F32** for most workloads

**Monitor closely** with custom dashboards

**Set alerts** at 70% capacity usage

**Review monthly** and adjust as needed

**Separate workloads** by criticality

## The Numbers

Previous: F64 = $8,000/month, often underutilized

Current: F32 = $4,000/month, better utilized

**Savings: $4,000/month**

## The Lesson

Don't guess at capacity. Start small, monitor, adjust.

Fabric makes it easy to scale. Take advantage of that.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
