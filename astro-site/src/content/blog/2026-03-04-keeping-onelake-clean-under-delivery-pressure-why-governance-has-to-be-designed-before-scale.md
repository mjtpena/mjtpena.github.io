---
title: "Keeping OneLake Clean Under Delivery Pressure: why governance has to be designed before scale"
description: "I spent the day reducing cognitive overhead for engineers and analysts—introducing clearer table contracts, simpler failure modes, and concise runbooks that…"
author: Michael John Peña
draft: false
date: 2026-03-04
tags:
  - Fabric
  - OneLake
  - Governance
---

I spent the day reducing cognitive overhead for engineers and analysts—introducing clearer table contracts, simpler failure modes, and concise runbooks that let teams act faster.

The friction I kept seeing was simple: performance conversations are often really architecture conversations.

Instead of adding more moving parts, I tested an explicit contract for inputs, outputs, and owners.

March for me has been about tightening execution after an idea-heavy February.

## What I changed today

- I documented one decision that usually lives in hallway conversations.
- I reduced unnecessary variability by standardizing one recurring pattern.
- I aligned a technical decision with a business-facing success metric.

## What changed my thinking

Nothing looked flashy, but the system became easier to reason about under pressure.
Most of the win comes from making ownership and boundaries unmistakably clear.

## Tomorrow's focus

Tomorrow I will review this with the team so the decision is shared, not personal.

## References

- [OneLake overview](https://learn.microsoft.com/fabric/onelake/)
- [OneLake shortcuts](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts)
- [Fabric data lifecycle](https://learn.microsoft.com/fabric/fundamentals/data-lifecycle)
