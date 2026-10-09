---
title: "Explainable AI: Making AI Decisions Transparent"
description: "Explainable AI builds trust and enables informed decision-making."
author: Michael John Peña
draft: false
date: 2025-05-24
tags:
  - AI
  - Explainability
  - XAI
  - Transparency
  - Trust
---

## Explainable AI Implementation

```python
from azure.ai.openai import AzureOpenAI
from typing import Dict, List

class ExplainableAI:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    async def generate_with_explanation(self, query: str, context: List[str]) -> Dict:
        """Generate response with step-by-step explanation."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Provide answers with clear explanations.
                Structure your response as:
                1. Answer: [Direct answer]
                2. Reasoning: [Step-by-step reasoning]
                3. Evidence: [Supporting evidence from context]
                4. Confidence: [Your confidence level and why]"""
            }, {
                "role": "user",
                "content": f"Context:\n{chr(10).join(context)}\n\nQuestion: {query}"
            }]
        )

        return self.parse_explained_response(response.choices[0].message.content)

    async def explain_retrieval(self, query: str, results: List[Dict]) -> Dict:
        """Explain why documents were retrieved."""
        explanations = []

        for i, result in enumerate(results[:5]):
            explanation = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": f"""Explain why this document is relevant to the query.

Query: {query}
Document: {result['content'][:500]}
Relevance Score: {result['score']}

Explain the connection briefly."""
                }]
            )

            explanations.append({
                "rank": i + 1,
                "document": result["content"][:200] + "...",
                "score": result["score"],
                "relevance_explanation": explanation.choices[0].message.content
            })

        return {"query": query, "explanations": explanations}

    async def explain_decision(self, input_data: Dict, prediction: str) -> Dict:
        """Explain AI decision/classification."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Explain AI decisions clearly. Include:
                - Key factors that influenced the decision
                - How each factor contributed
                - Alternative outcomes considered
                - Confidence assessment"""
            }, {
                "role": "user",
                "content": f"Input: {input_data}\nDecision: {prediction}\nExplain this decision."
            }],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    async def generate_counterfactuals(self, input_data: Dict, prediction: str) -> List[Dict]:
        """Generate counterfactual explanations."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Generate counterfactual explanations.
                Show what changes would lead to different outcomes.
                Return JSON array of counterfactuals."""
            }, {
                "role": "user",
                "content": f"Input: {input_data}\nPrediction: {prediction}"
            }],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)["counterfactuals"]

    def create_explanation_card(self, response: str, explanation: Dict) -> Dict:
        """Create user-friendly explanation card."""
        return {
            "answer": response,
            "confidence": explanation.get("confidence", "N/A"),
            "key_factors": explanation.get("factors", []),
            "sources_used": explanation.get("sources", []),
            "reasoning_summary": explanation.get("reasoning", ""),
            "limitations": explanation.get("limitations", [])
        }
```

Explainable AI builds trust and enables informed decision-making.
