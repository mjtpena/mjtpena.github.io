---
title: "Agentic RAG Patterns: Self-Correcting and Adaptive Retrieval"
description: "When RAG systems can reason about what to retrieve, they stop failing silently. My implementations of agentic RAG show how to add evaluation and iterative…"
author: Michael John Peña
draft: false
date: 2024-01-08
tags:
  - RAG
  - AI Agents
  - Azure OpenAI
  - LangChain
  - Advanced AI
---

When RAG systems can reason about what to retrieve, they stop failing silently. My implementations of agentic RAG show how to add evaluation and iterative retrieval without exploding costs—these patterns have reduced retrieval errors in production workloads.

## The Evolution from Static to Agentic RAG

```
Static RAG:     Query → Retrieve → Generate → Done

Agentic RAG:    Query → Plan → Retrieve → Evaluate →
                        ↓                      ↓
                   Sufficient?  ←  No  ←  Refine
                        ↓ Yes
                    Generate → Validate → Done
```

## Pattern 1: Self-RAG (Self-Reflective RAG)

The model evaluates its own retrieval and generation:

```python
from dataclasses import dataclass
from enum import Enum
from typing import Optional

class RetrievalQuality(Enum):
    RELEVANT = "relevant"
    PARTIALLY_RELEVANT = "partially_relevant"
    NOT_RELEVANT = "not_relevant"

class GenerationQuality(Enum):
    SUPPORTED = "supported"
    PARTIALLY_SUPPORTED = "partially_supported"
    NOT_SUPPORTED = "not_supported"

@dataclass
class SelfRAGResult:
    response: str
    retrieval_quality: RetrievalQuality
    generation_quality: GenerationQuality
    iterations: int
    contexts_used: list[dict]

class SelfRAG:
    def __init__(self, retriever, llm_client, max_iterations: int = 3):
        self.retriever = retriever
        self.llm = llm_client
        self.max_iterations = max_iterations

    async def query(self, question: str) -> SelfRAGResult:
        """Execute self-reflective RAG."""

        for iteration in range(self.max_iterations):
            # Step 1: Retrieve
            contexts = await self.retriever.retrieve(question)

            # Step 2: Evaluate retrieval quality
            retrieval_quality = await self._evaluate_retrieval(question, contexts)

            if retrieval_quality == RetrievalQuality.NOT_RELEVANT:
                # Refine query and retry
                question = await self._refine_query(question, contexts)
                continue

            # Step 3: Generate response
            response = await self._generate(question, contexts)

            # Step 4: Evaluate generation quality (groundedness)
            generation_quality = await self._evaluate_generation(
                question, response, contexts
            )

            if generation_quality == GenerationQuality.SUPPORTED:
                return SelfRAGResult(
                    response=response,
                    retrieval_quality=retrieval_quality,
                    generation_quality=generation_quality,
                    iterations=iteration + 1,
                    contexts_used=contexts
                )

            # If not supported, try again with refined approach
            question = await self._refine_query(question, contexts)

        # Max iterations reached, return best effort
        return SelfRAGResult(
            response=response,
            retrieval_quality=retrieval_quality,
            generation_quality=generation_quality,
            iterations=self.max_iterations,
            contexts_used=contexts
        )

    async def _evaluate_retrieval(
        self,
        question: str,
        contexts: list[dict]
    ) -> RetrievalQuality:
        """Evaluate if retrieved contexts are relevant."""

        context_summaries = "\n".join([
            f"- {c['content'][:200]}..."
            for c in contexts
        ])

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": """Evaluate if the retrieved contexts are relevant to answer the question.
                    Return ONLY one of: RELEVANT, PARTIALLY_RELEVANT, NOT_RELEVANT"""
                },
                {
                    "role": "user",
                    "content": f"Question: {question}\n\nContexts:\n{context_summaries}"
                }
            ],
            max_tokens=20
        )

        result = response.choices[0].message.content.strip().upper()

        mapping = {
            "RELEVANT": RetrievalQuality.RELEVANT,
            "PARTIALLY_RELEVANT": RetrievalQuality.PARTIALLY_RELEVANT,
            "NOT_RELEVANT": RetrievalQuality.NOT_RELEVANT
        }

        return mapping.get(result, RetrievalQuality.PARTIALLY_RELEVANT)

    async def _evaluate_generation(
        self,
        question: str,
        response: str,
        contexts: list[dict]
    ) -> GenerationQuality:
        """Evaluate if response is grounded in contexts."""

        context_text = "\n\n".join([c["content"] for c in contexts])

        eval_response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": """Evaluate if the response is supported by the provided contexts.
                    Check each claim in the response against the contexts.
                    Return ONLY one of: SUPPORTED, PARTIALLY_SUPPORTED, NOT_SUPPORTED"""
                },
                {
                    "role": "user",
                    "content": f"""Question: {question}

Response to evaluate:
{response}

Available contexts:
{context_text}"""
                }
            ],
            max_tokens=20
        )

        result = eval_response.choices[0].message.content.strip().upper()

        mapping = {
            "SUPPORTED": GenerationQuality.SUPPORTED,
            "PARTIALLY_SUPPORTED": GenerationQuality.PARTIALLY_SUPPORTED,
            "NOT_SUPPORTED": GenerationQuality.NOT_SUPPORTED
        }

        return mapping.get(result, GenerationQuality.PARTIALLY_SUPPORTED)

    async def _refine_query(self, original: str, contexts: list[dict]) -> str:
        """Refine query based on retrieval gaps."""

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": """The original query didn't retrieve relevant results.
                    Rewrite it to be more specific or try alternative phrasings.
                    Return ONLY the refined query."""
                },
                {
                    "role": "user",
                    "content": f"Original query: {original}"
                }
            ],
            max_tokens=100
        )

        return response.choices[0].message.content.strip()

    async def _generate(self, question: str, contexts: list[dict]) -> str:
        """Generate response from contexts."""

        context_text = "\n\n".join([
            f"[Source {i+1}]: {c['content']}"
            for i, c in enumerate(contexts)
        ])

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": """Answer the question based ONLY on the provided contexts.
                    Cite sources using [Source N] format.
                    If the contexts don't contain the answer, say so."""
                },
                {
                    "role": "user",
                    "content": f"Contexts:\n{context_text}\n\nQuestion: {question}"
                }
            ]
        )

        return response.choices[0].message.content
```

## Pattern 2: CRAG (Corrective RAG)

Corrective RAG explicitly corrects retrieval failures:

```python
class CorrectiveRAG:
    def __init__(
        self,
        retriever,
        web_search,
        llm_client,
        relevance_threshold: float = 0.7
    ):
        self.retriever = retriever
        self.web_search = web_search
        self.llm = llm_client
        self.threshold = relevance_threshold

    async def query(self, question: str) -> str:
        """Execute CRAG with web search fallback."""

        # Initial retrieval
        contexts = await self.retriever.retrieve(question)

        # Score each context
        scored_contexts = await self._score_contexts(question, contexts)

        # Separate by relevance
        relevant = [c for c in scored_contexts if c["score"] >= self.threshold]
        ambiguous = [c for c in scored_contexts if 0.3 <= c["score"] < self.threshold]
        irrelevant = [c for c in scored_contexts if c["score"] < 0.3]

        # Decide action based on results
        if len(relevant) >= 2:
            # Enough relevant results - proceed normally
            return await self._generate(question, relevant)

        elif len(relevant) + len(ambiguous) >= 2:
            # Some relevant + ambiguous - use both but weight appropriately
            all_contexts = relevant + ambiguous
            # Refine ambiguous contexts
            refined = await self._refine_contexts(question, ambiguous)
            return await self._generate(question, relevant + refined)

        else:
            # Not enough from knowledge base - use web search
            web_results = await self._web_search_fallback(question)

            # Combine with any relevant KB results
            combined = relevant + web_results

            if not combined:
                return "I don't have enough information to answer this question."

            return await self._generate(question, combined, include_web_disclaimer=True)

    async def _score_contexts(
        self,
        question: str,
        contexts: list[dict]
    ) -> list[dict]:
        """Score context relevance."""

        scored = []

        for ctx in contexts:
            response = await self.llm.chat.completions.create(
                model="gpt-4-turbo",
                messages=[
                    {
                        "role": "system",
                        "content": """Rate how relevant this context is for answering the question.
                        Return a score from 0.0 to 1.0 and nothing else."""
                    },
                    {
                        "role": "user",
                        "content": f"Question: {question}\n\nContext: {ctx['content']}"
                    }
                ],
                max_tokens=10
            )

            try:
                score = float(response.choices[0].message.content.strip())
            except:
                score = 0.5

            scored.append({**ctx, "score": score})

        return scored

    async def _refine_contexts(
        self,
        question: str,
        contexts: list[dict]
    ) -> list[dict]:
        """Extract relevant portions from ambiguous contexts."""

        refined = []

        for ctx in contexts:
            response = await self.llm.chat.completions.create(
                model="gpt-4-turbo",
                messages=[
                    {
                        "role": "system",
                        "content": """Extract only the parts of this context that are relevant
                        to answering the question. Return the relevant excerpt or 'NONE'."""
                    },
                    {
                        "role": "user",
                        "content": f"Question: {question}\n\nContext: {ctx['content']}"
                    }
                ]
            )

            excerpt = response.choices[0].message.content

            if excerpt.strip().upper() != "NONE":
                refined.append({
                    "content": excerpt,
                    "source": ctx.get("source", "refined"),
                    "score": ctx["score"]
                })

        return refined

    async def _web_search_fallback(self, question: str) -> list[dict]:
        """Search web for additional context."""

        results = await self.web_search.search(question, num_results=5)

        contexts = []
        for result in results:
            contexts.append({
                "content": result["snippet"],
                "source": result["url"],
                "score": 0.8,  # Web results get reasonable default score
                "is_web": True
            })

        return contexts

    async def _generate(
        self,
        question: str,
        contexts: list[dict],
        include_web_disclaimer: bool = False
    ) -> str:
        """Generate response from contexts."""

        context_text = "\n\n".join([
            f"[{c.get('source', 'KB')}]: {c['content']}"
            for c in contexts
        ])

        system_prompt = """Answer based on the provided contexts. Cite sources."""

        if include_web_disclaimer:
            system_prompt += "\nNote: Some information comes from web search and may need verification."

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Contexts:\n{context_text}\n\nQuestion: {question}"}
            ]
        )

        return response.choices[0].message.content
```

## Pattern 3: Adaptive RAG

Choose retrieval strategy based on query complexity:

```python
from enum import Enum

class QueryComplexity(Enum):
    SIMPLE = "simple"  # Direct factual question
    MODERATE = "moderate"  # Requires some reasoning
    COMPLEX = "complex"  # Multi-hop, comparison, synthesis

class AdaptiveRAG:
    def __init__(self, retriever, llm_client):
        self.retriever = retriever
        self.llm = llm_client

    async def query(self, question: str) -> str:
        """Execute adaptive RAG based on query complexity."""

        # Classify query complexity
        complexity = await self._classify_complexity(question)

        if complexity == QueryComplexity.SIMPLE:
            return await self._simple_rag(question)

        elif complexity == QueryComplexity.MODERATE:
            return await self._iterative_rag(question)

        else:  # COMPLEX
            return await self._multi_hop_rag(question)

    async def _classify_complexity(self, question: str) -> QueryComplexity:
        """Classify query complexity."""

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": """Classify the query complexity:
                    - SIMPLE: Direct factual question, single retrieval sufficient
                    - MODERATE: Requires some reasoning or aggregation
                    - COMPLEX: Multi-hop reasoning, comparison, or synthesis

                    Return ONLY: SIMPLE, MODERATE, or COMPLEX"""
                },
                {"role": "user", "content": question}
            ],
            max_tokens=10
        )

        result = response.choices[0].message.content.strip().upper()

        mapping = {
            "SIMPLE": QueryComplexity.SIMPLE,
            "MODERATE": QueryComplexity.MODERATE,
            "COMPLEX": QueryComplexity.COMPLEX
        }

        return mapping.get(result, QueryComplexity.MODERATE)

    async def _simple_rag(self, question: str) -> str:
        """Single-shot retrieval and generation."""

        contexts = await self.retriever.retrieve(question, top_k=3)
        return await self._generate(question, contexts)

    async def _iterative_rag(self, question: str, max_iterations: int = 2) -> str:
        """Retrieve, generate, check, refine if needed."""

        all_contexts = []

        for i in range(max_iterations):
            contexts = await self.retriever.retrieve(question, top_k=5)
            all_contexts.extend(contexts)

            response = await self._generate(question, all_contexts)

            # Check if answer is complete
            is_complete = await self._check_completeness(question, response)

            if is_complete:
                return response

            # Generate follow-up query
            question = await self._generate_followup(question, response)

        return response

    async def _multi_hop_rag(self, question: str) -> str:
        """Decompose into sub-questions and aggregate."""

        # Decompose
        sub_questions = await self._decompose_question(question)

        # Answer each sub-question
        sub_answers = []
        all_contexts = []

        for sub_q in sub_questions:
            contexts = await self.retriever.retrieve(sub_q, top_k=3)
            all_contexts.extend(contexts)

            sub_answer = await self._generate(sub_q, contexts)
            sub_answers.append({
                "question": sub_q,
                "answer": sub_answer
            })

        # Synthesize final answer
        return await self._synthesize(question, sub_answers, all_contexts)

    async def _decompose_question(self, question: str) -> list[str]:
        """Decompose complex question into sub-questions."""

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": """Decompose this question into simpler sub-questions.
                    Return JSON: {"sub_questions": ["q1", "q2", ...]}"""
                },
                {"role": "user", "content": question}
            ]
        )

        result = json.loads(response.choices[0].message.content)
        return result["sub_questions"]

    async def _synthesize(
        self,
        original_question: str,
        sub_answers: list[dict],
        contexts: list[dict]
    ) -> str:
        """Synthesize sub-answers into final response."""

        sub_qa_text = "\n\n".join([
            f"Q: {sa['question']}\nA: {sa['answer']}"
            for sa in sub_answers
        ])

        response = await self.llm.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": """Synthesize the sub-answers into a comprehensive
                    response to the original question."""
                },
                {
                    "role": "user",
                    "content": f"""Original question: {original_question}

Sub-questions and answers:
{sub_qa_text}

Provide a comprehensive answer."""
                }
            ]
        )

        return response.choices[0].message.content
```

## Evaluation Metrics for Agentic RAG

```python
@dataclass
class AgenticRAGMetrics:
    answer_relevance: float
    faithfulness: float  # Groundedness in retrieved context
    context_precision: float  # % of retrieved contexts actually used
    context_recall: float  # Did we retrieve all needed information
    iterations: int
    latency_ms: float

async def evaluate_agentic_rag(
    rag_system,
    test_cases: list[dict]
) -> list[AgenticRAGMetrics]:
    """Evaluate agentic RAG on test cases."""

    results = []

    for case in test_cases:
        start = time.time()

        result = await rag_system.query(case["question"])

        latency = (time.time() - start) * 1000

        # Calculate metrics
        metrics = AgenticRAGMetrics(
            answer_relevance=await _score_relevance(case["question"], result.response),
            faithfulness=await _score_faithfulness(result.response, result.contexts_used),
            context_precision=await _score_precision(result.contexts_used, result.response),
            context_recall=await _score_recall(case["expected_sources"], result.contexts_used),
            iterations=result.iterations,
            latency_ms=latency
        )

        results.append(metrics)

    return results
```

## Conclusion

Agentic RAG transforms retrieval from a static lookup to an intelligent process. Key patterns:

1. **Self-RAG**: Model evaluates its own retrieval and generation
2. **CRAG**: Explicit correction with fallback strategies
3. **Adaptive RAG**: Strategy selection based on query complexity

These patterns increase latency but significantly improve answer quality for complex queries. Use them when accuracy matters more than speed.
