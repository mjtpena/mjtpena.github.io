---
title: "RAG Architecture Patterns: Building Production-Ready Systems"
author: Michael John Peña
draft: false
date: 2023-02-01
tags:
  - Azure
  - OpenAI
  - RAG
  - Architecture
  - AI

---

I wrote "RAG Architecture Patterns: Building Production-Ready Systems" to share practical, production-minded guidance on this topic.

## Pattern 1: Simple RAG

The basic pattern for straightforward use cases:

```python
"""
User Query → Embed → Retrieve → Generate → Response
"""

class SimpleRAGPattern:
    def query(self, question: str) -> str:
        # 1. Embed the query
        query_embedding = self.embed(question)

        # 2. Retrieve relevant documents
        docs = self.vector_store.search(query_embedding, top_k=5)

        # 3. Generate response with context
        context = self.format_context(docs)
        return self.llm.generate(question, context)
```

## Pattern 2: Query Transformation

Transform queries for better retrieval:

```python
class QueryTransformRAG:
    """Transform queries before retrieval."""

    def expand_query(self, query: str) -> List[str]:
        """Generate multiple query variations."""
        prompt = f"""Generate 3 alternative ways to ask this question:
"{query}"

Return only the questions, one per line."""

        response = self.llm.generate(prompt)
        queries = [query] + response.strip().split('\n')
        return queries

    def decompose_query(self, query: str) -> List[str]:
        """Break complex query into sub-questions."""
        prompt = f"""Break this question into simpler sub-questions:
"{query}"

Return sub-questions, one per line."""

        response = self.llm.generate(prompt)
        return response.strip().split('\n')

    def query(self, question: str) -> str:
        # Expand query
        queries = self.expand_query(question)

        # Retrieve for all query variations
        all_docs = []
        for q in queries:
            docs = self.retrieve(q, top_k=3)
            all_docs.extend(docs)

        # Deduplicate and rerank
        unique_docs = self.deduplicate(all_docs)
        top_docs = self.rerank(question, unique_docs, top_k=5)

        return self.generate(question, top_docs)
```

## Pattern 3: Hypothetical Document Embedding (HyDE)

Generate a hypothetical answer first, then use it for retrieval:

```python
class HyDERAG:
    """Hypothetical Document Embedding pattern."""

    def generate_hypothetical_answer(self, query: str) -> str:
        """Generate what an ideal answer might look like."""
        prompt = f"""Write a detailed answer to this question as if you had perfect knowledge:
"{query}"

Provide a comprehensive answer:"""

        return self.llm.generate(prompt, temperature=0.7)

    def query(self, question: str) -> str:
        # Generate hypothetical answer
        hypothetical = self.generate_hypothetical_answer(question)

        # Use hypothetical answer for retrieval (instead of query)
        hypothetical_embedding = self.embed(hypothetical)

        # Retrieve documents similar to ideal answer
        docs = self.vector_store.search(hypothetical_embedding, top_k=5)

        # Generate final answer with retrieved context
        return self.generate(question, docs)
```

## Pattern 4: Multi-Stage Retrieval

Progressive retrieval for better precision:

```python
class MultiStageRAG:
    """Multi-stage retrieval for better results."""

    def query(self, question: str) -> str:
        # Stage 1: Broad retrieval with lightweight model
        initial_docs = self.coarse_retrieve(question, top_k=50)

        # Stage 2: Rerank with cross-encoder
        reranked_docs = self.cross_encoder_rerank(question, initial_docs, top_k=10)

        # Stage 3: LLM-based filtering
        relevant_docs = self.llm_filter(question, reranked_docs, top_k=5)

        return self.generate(question, relevant_docs)

    def coarse_retrieve(self, query: str, top_k: int) -> List[Document]:
        """Fast, broad retrieval."""
        embedding = self.embed(query)
        return self.vector_store.search(embedding, top_k)

    def cross_encoder_rerank(
        self,
        query: str,
        docs: List[Document],
        top_k: int
    ) -> List[Document]:
        """Rerank using cross-encoder model."""
        # Cross-encoder scores query-document pairs directly
        scores = []
        for doc in docs:
            score = self.cross_encoder.score(query, doc.content)
            scores.append((doc, score))

        scores.sort(key=lambda x: x[1], reverse=True)
        return [doc for doc, _ in scores[:top_k]]

    def llm_filter(
        self,
        query: str,
        docs: List[Document],
        top_k: int
    ) -> List[Document]:
        """Filter using LLM relevance judgment."""
        relevant = []

        for doc in docs:
            prompt = f"""Is this document relevant to the question?
Question: {query}
Document: {doc.content[:500]}

Answer only YES or NO:"""

            response = self.llm.generate(prompt, max_tokens=5)
            if "YES" in response.upper():
                relevant.append(doc)

            if len(relevant) >= top_k:
                break

        return relevant
```

## Pattern 5: Self-Reflective RAG

Evaluate and improve responses iteratively:

```python
class SelfReflectiveRAG:
    """RAG with self-evaluation and correction."""

    def query(self, question: str, max_iterations: int = 3) -> str:
        docs = self.retrieve(question)

        for iteration in range(max_iterations):
            # Generate response
            response = self.generate(question, docs)

            # Evaluate response
            evaluation = self.evaluate_response(question, response, docs)

            if evaluation["is_satisfactory"]:
                return response

            # If not satisfactory, try to improve
            if evaluation["needs_more_context"]:
                # Retrieve additional documents
                additional_query = evaluation["suggested_query"]
                more_docs = self.retrieve(additional_query)
                docs.extend(more_docs)

            elif evaluation["has_hallucination"]:
                # Regenerate with stricter prompt
                response = self.generate_strict(question, docs)

        return response

    def evaluate_response(
        self,
        question: str,
        response: str,
        docs: List[Document]
    ) -> Dict:
        """Evaluate response quality."""
        context_text = "\n".join([d.content for d in docs])

        prompt = f"""Evaluate this response:

Question: {question}
Response: {response}
Available Context: {context_text[:2000]}

Evaluate:
1. Is the response fully supported by the context? (YES/NO)
2. Does it fully answer the question? (YES/NO)
3. Does it contain information not in the context (hallucination)? (YES/NO)

If the answer is incomplete, suggest what additional information is needed.

Evaluation:"""

        eval_response = self.llm.generate(prompt)
        return self.parse_evaluation(eval_response)
```

## Pattern 6: Agentic RAG

Use agents to decide retrieval strategy:

```python
class AgenticRAG:
    """Agent-based RAG with tool use."""

    def __init__(self):
        self.tools = {
            "search_docs": self.search_documents,
            "search_web": self.search_web,
            "calculate": self.calculate,
            "lookup_table": self.lookup_table
        }

    def query(self, question: str) -> str:
        # Agent decides which tools to use
        plan = self.plan_actions(question)

        context = []
        for action in plan:
            tool = self.tools.get(action["tool"])
            if tool:
                result = tool(action["input"])
                context.append({
                    "source": action["tool"],
                    "content": result
                })

        return self.generate_with_context(question, context)

    def plan_actions(self, question: str) -> List[Dict]:
        """Plan which tools to use."""
        prompt = f"""Given this question, decide which tools to use and in what order.

Available tools:
- search_docs: Search internal documentation
- search_web: Search the web for current information
- calculate: Perform calculations
- lookup_table: Look up values in reference tables

Question: {question}

Return a JSON list of actions:
[{{"tool": "tool_name", "input": "input_for_tool"}}]"""

        response = self.llm.generate(prompt)
        return json.loads(response)
```

## Pattern 7: Conversational RAG

Maintain context across conversation turns:

```python
class ConversationalRAG:
    """RAG with conversation history."""

    def __init__(self):
        self.conversation_history = []
        self.retrieved_docs_history = []

    def query(self, question: str) -> str:
        # Rewrite question with conversation context
        contextualized_query = self.contextualize_query(question)

        # Retrieve documents
        docs = self.retrieve(contextualized_query)

        # Check if we need docs from previous turns
        if self.needs_previous_context(question):
            docs.extend(self.get_relevant_previous_docs(question))

        # Generate with conversation history
        response = self.generate_conversational(question, docs)

        # Update history
        self.conversation_history.append({
            "question": question,
            "response": response
        })
        self.retrieved_docs_history.append(docs)

        return response

    def contextualize_query(self, question: str) -> str:
        """Rewrite question to be standalone."""
        if not self.conversation_history:
            return question

        history_text = "\n".join([
            f"Q: {turn['question']}\nA: {turn['response']}"
            for turn in self.conversation_history[-3:]  # Last 3 turns
        ])

        prompt = f"""Given this conversation history:
{history_text}

Rewrite this follow-up question to be standalone:
"{question}"

Standalone question:"""

        return self.llm.generate(prompt).strip()
```

## Pattern Selection Guide

```python
PATTERN_RECOMMENDATIONS = {
    "simple_qa": {
        "pattern": "Simple RAG",
        "when": "Straightforward questions with clear answers in docs"
    },
    "complex_queries": {
        "pattern": "Query Transformation",
        "when": "Questions that need reformulation or decomposition"
    },
    "domain_mismatch": {
        "pattern": "HyDE",
        "when": "Query language differs from document language"
    },
    "high_precision": {
        "pattern": "Multi-Stage Retrieval",
        "when": "Need high precision, can trade off latency"
    },
    "reliability_critical": {
        "pattern": "Self-Reflective RAG",
        "when": "Must minimize hallucinations"
    },
    "multi_source": {
        "pattern": "Agentic RAG",
        "when": "Need to combine multiple data sources"
    },
    "chat_applications": {
        "pattern": "Conversational RAG",
        "when": "Multi-turn conversations"
    }
}
```

## Best Practices

1. **Start simple**: Begin with basic RAG, add complexity as needed
2. **Measure quality**: Track retrieval relevance and answer accuracy
3. **Handle failures gracefully**: Plan for when retrieval fails
4. **Monitor latency**: Complex patterns add latency
5. **Test edge cases**: Empty results, irrelevant queries, etc.

## Resources

- [RAG Survey Paper](https://arxiv.org/abs/2312.10997)
- [Advanced RAG Techniques](https://www.llamaindex.ai/blog/a-cheat-sheet-and-some-recipes-for-building-advanced-rag-803a9d94c41b)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
