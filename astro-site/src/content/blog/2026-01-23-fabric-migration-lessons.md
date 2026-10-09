---
title: "Migrating to Fabric: 5 Things I Wish I Knew"
description: "We migrated from Synapse to Fabric. It took twice as long as expected. Here's what I wish someone had told me."
author: Michael John Peña
draft: false
date: 2026-01-23
tags:
  - Fabric
  - Azure
  - Migration
  - Data
---

We migrated from Synapse to Fabric. It took twice as long as expected. Here's what I wish someone had told me.

## 1. Start Smaller Than You Think

We tried migrating everything at once. Bad idea.

Better approach:
- Pick one non-critical workload
- Learn the platform
- Build your patterns
- Then scale

## 2. Your Synapse Notebooks Won't "Just Work"

Fabric uses different runtime versions. APIs changed. Dependencies are different.

Budget time for:
- Updating package versions
- Fixing path references
- Adjusting authentication
- Testing everything

## 3. Direct Lake Has Requirements

Direct Lake is amazing. But it requires:
- Data in Delta format
- Specific data types
- Proper partitioning
- OneLake storage

We had to restructure data. Plan for this.

## 4. Monitor From Day One

Capacity metrics are crucial. Without monitoring, you'll hit limits and not know why.

Set up alerts early:
- Capacity utilization
- Throttling events
- Query failures
- Cost tracking

## 5. Train Your Team

Fabric is different enough that your team needs training. Not just documentation—actual hands-on practice.

We underestimated this. Cost us 2 weeks of confusion.

## The Bottom Line

Fabric is good. Migration is work. Plan accordingly.

Budget 2x your initial estimate. You'll need it.
