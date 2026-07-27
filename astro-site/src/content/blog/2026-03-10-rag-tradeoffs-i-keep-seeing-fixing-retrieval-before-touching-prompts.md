---
title: "RAG Tradeoffs I Keep Seeing: fixing retrieval before touching prompts"
author: Michael John Peña
draft: false
date: 2026-03-10
tags:
  - RAG
  - LLM
  - Data
---

I spent the day reducing cognitive overhead for engineers and analysts—introducing clearer table contracts, simpler failure modes, and concise runbooks that let teams act faster.

The friction I kept seeing was simple: quality regressions are expensive because they are discovered too late.

Instead of adding more moving parts, I tested an explicit contract for inputs, outputs, and owners.

March for me has been about tightening execution after an idea-heavy February.

## What I changed today

- I removed one optional branch that only added maintenance burden.
- I documented one decision that usually lives in hallway conversations.
- I cut one source of rework by tightening upstream validation.

## What I want to keep doing

Nothing looked flashy, but the system became easier to reason about under pressure.
Most of the win comes from making ownership and boundaries unmistakably clear.

## Tomorrow's focus

Tomorrow I want to tighten the metrics so improvements are obvious without interpretation.

## References

- [RAG design and evaluation guide](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide)
- [Azure Well-Architected for AI workloads](https://learn.microsoft.com/azure/well-architected/ai/)
- [Microsoft Foundry documentation](https://learn.microsoft.com/azure/ai-foundry/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
