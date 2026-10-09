---
title: "Orchestration Lessons in Fabric: designing pipelines for failure, not the happy path"
description: "I spent the day reducing cognitive overhead for engineers and analysts—introducing clearer table contracts, simpler failure modes, and concise runbooks that…"
author: Michael John Peña
draft: false
date: 2026-03-27
tags:
  - Fabric
  - Data Factory
  - Engineering
---

I spent the day reducing cognitive overhead for engineers and analysts—introducing clearer table contracts, simpler failure modes, and concise runbooks that let teams act faster.

The friction I kept seeing was simple: quality regressions are expensive because they are discovered too late.

Instead of adding more moving parts, I tested a single-path implementation before introducing alternatives.

March for me has been about tightening execution after an idea-heavy February.

## What I changed today

- I cut one source of rework by tightening upstream validation.
- I documented one decision that usually lives in hallway conversations.
- I removed one optional branch that only added maintenance burden.

## What changed my thinking

Nothing looked flashy, but the system became easier to reason about under pressure.
Most of the win comes from making ownership and boundaries unmistakably clear.

## Tomorrow's focus

Tomorrow's focus is to stress-test this with less ideal inputs and see where it bends.

## References

- [Fabric Data Factory](https://learn.microsoft.com/fabric/data-factory/)
- [Microsoft Fabric documentation](https://learn.microsoft.com/fabric/)
- [Azure Well-Architected for AI workloads](https://learn.microsoft.com/azure/well-architected/ai/)
