---
title: "LLM Cost and Latency Notes: using caching where it actually pays off"
author: Michael John Peña
draft: false
date: 2026-05-07
tags:
  - AI
  - LLM
  - Cost
---

I worked on smoothing the handoff between data engineering and AI teams—standardizing feature contracts, embedding validation, and adding lightweight integration tests.

The friction I kept seeing was simple: teams over-rotate on tooling when alignment is the real bottleneck.

Instead of adding more moving parts, I tested an explicit contract for inputs, outputs, and owners.

By May, the quality of data and AI foundations shows up clearly in delivery speed.

## What I changed today

- I aligned a technical decision with a business-facing success metric.
- I reduced unnecessary variability by standardizing one recurring pattern.
- I documented one decision that usually lives in hallway conversations.

## Why this mattered today

Nothing looked flashy, but the system became easier to reason about under pressure.
Most of the win comes from making ownership and boundaries unmistakably clear.

## Tomorrow's focus

Tomorrow I want to tighten the metrics so improvements are obvious without interpretation.

## References

- [Microsoft Foundry documentation](https://learn.microsoft.com/azure/ai-foundry/)
- [RAG design and evaluation guide](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide)
- [Azure Well-Architected for AI workloads](https://learn.microsoft.com/azure/well-architected/ai/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
