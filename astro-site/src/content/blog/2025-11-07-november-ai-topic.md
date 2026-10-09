---
title: "Prompt Engineering Patterns for Enterprise RAG Systems"
description: "Poorly designed prompts lead to hallucinations, ignored context, or responses that fail to meet business requirements. A systematic approach to prompt…"
author: Michael John Peña
draft: false
date: 2025-11-07
tags:
  - RAG
  - Prompt Engineering
  - Azure OpenAI
  - Enterprise AI
  - Best Practices
---

## The RAG Prompt Challenge

Poorly designed prompts lead to hallucinations, ignored context, or responses that fail to meet business requirements. A systematic approach to prompt engineering improves reliability.

## Structured Prompt Templates

Create modular prompt components that can be composed for different use cases:

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class RAGPromptBuilder:
    """Builder for enterprise RAG prompts with safety controls."""

    system_context: str = """You are an enterprise assistant for {company_name}.
Answer questions using ONLY the provided context documents.
If the context doesn't contain sufficient information, say so clearly.
Never make up information not present in the context."""

    citation_instruction: str = """
For every claim in your response, cite the source using [Source: document_name].
If multiple sources support a claim, cite all relevant sources."""

    compliance_rules: str = """
IMPORTANT COMPLIANCE RULES:
- Do not disclose confidential financial figures unless user has Finance role
- Do not provide legal advice - direct users to Legal department
- Do not share personal employee information"""

    def build_prompt(
        self,
        query: str,
        context_docs: list[dict],
        user_role: str,
        include_citations: bool = True
    ) -> list[dict]:
        """Construct the full prompt with context and controls."""

        # Format context documents
        context_block = "\n\n---\n\n".join([
            f"Document: {doc['title']}\n"
            f"Source: {doc['source']}\n"
            f"Content: {doc['content']}"
            for doc in context_docs
        ])

        system_message = self.system_context.format(company_name="Contoso")

        if include_citations:
            system_message += f"\n\n{self.citation_instruction}"

        system_message += f"\n\n{self.compliance_rules}"
        system_message += f"\n\nUser Role: {user_role}"

        return [
            {"role": "system", "content": system_message},
            {"role": "user", "content": f"""
CONTEXT DOCUMENTS:
{context_block}

USER QUESTION:
{query}

Provide a helpful, accurate response based solely on the context above."""}
        ]

    def add_few_shot_examples(
        self,
        messages: list[dict],
        examples: list[tuple[str, str]]
    ) -> list[dict]:
        """Add few-shot examples for improved response quality."""
        few_shot_messages = []

        for query, response in examples:
            few_shot_messages.extend([
                {"role": "user", "content": query},
                {"role": "assistant", "content": response}
            ])

        # Insert examples after system message
        return [messages[0]] + few_shot_messages + messages[1:]

# Usage example
builder = RAGPromptBuilder()
prompt = builder.build_prompt(
    query="What is our refund policy?",
    context_docs=[
        {"title": "Return Policy", "source": "policies/returns.md",
         "content": "Customers may request refunds within 30 days..."}
    ],
    user_role="Customer Service",
    include_citations=True
)
```

## Response Validation

Validate LLM responses against context to detect hallucinations:

```python
def validate_response_against_context(response: str, context_docs: list[dict]) -> dict:
    """Check if response claims are supported by context."""
    context_text = " ".join([doc["content"] for doc in context_docs])

    # Extract claims from response and verify each against context
    # Returns validation report with confidence scores
    pass
```

Enterprise RAG systems require ongoing prompt refinement based on user feedback and accuracy metrics. Treating prompts as code with version control enables systematic improvement.
