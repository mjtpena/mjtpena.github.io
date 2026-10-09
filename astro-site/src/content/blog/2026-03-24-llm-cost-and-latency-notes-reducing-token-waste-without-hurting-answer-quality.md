---
title: "LLM Cost and Latency Notes: reducing token waste without hurting answer quality"
description: "I worked on smoothing the handoff between data engineering and AI teams—standardizing feature contracts, embedding validation, and adding lightweight…"
author: Michael John Peña
draft: false
date: 2026-03-24
tags:
  - AI
  - LLM
  - Cost
---

I worked on smoothing the handoff between data engineering and AI teams—standardizing feature contracts, embedding validation, and adding lightweight integration tests.

The friction I kept seeing was simple: performance conversations are often really architecture conversations.

Instead of adding more moving parts, I tested a review pass focused on maintainability over novelty.

March for me has been about tightening execution after an idea-heavy February.

## What I changed today

- I replaced a vague process step with a concrete, testable checkpoint.
- I reduced unnecessary variability by standardizing one recurring pattern.
- I cut one source of rework by tightening upstream validation.

## What I want to keep doing

I came away convinced that constraint clarity beats optimization tricks most days.
Good systems feel calm because decision paths are explicit before incidents happen.

## Tomorrow's focus

Tomorrow I want to verify this pattern under a busier workload before I call it stable.

## References

- [Microsoft Foundry documentation](https://learn.microsoft.com/azure/ai-foundry/)
- [RAG design and evaluation guide](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide)
- [Azure Well-Architected for AI workloads](https://learn.microsoft.com/azure/well-architected/ai/)
