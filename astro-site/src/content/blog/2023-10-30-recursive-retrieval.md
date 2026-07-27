---
title: "Recursive Retrieval for Complex RAG Queries"
author: Michael John Peña
draft: false
date: 2023-10-30
description: "Implementing recursive retrieval strategies for handling complex, multi-step queries in RAG systems."
tags:
  - RAG
  - Recursive Retrieval
  - Complex Queries
  - Multi-step Reasoning
  - AI

---

I wrote "Recursive Retrieval for Complex RAG Queries" to share practical, production-minded guidance on this topic.

## Introduction

Recursive retrieval handles complex queries that require multiple retrieval steps or following references between documents. This technique enables RAG systems to answer questions that span multiple documents or require reasoning chains.

## Recursive Retrieval Architecture

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set
from enum import Enum
import uuid

class RetrievalAction(Enum):
    RETRIEVE = "retrieve"
    FOLLOW_REFERENCE = "follow_reference"
    AGGREGATE = "aggregate"
    STOP = "stop"

@dataclass
class RetrievalStep:
    step_id: str
    action: RetrievalAction
    query: str
    results: List[Dict] = field(default_factory=list)
    references_found: List[str] = field(default_factory=list)
    reasoning: str = ""

@dataclass
class RecursiveResult:
    final_context: str
    retrieval_path: List[RetrievalStep]
    total_documents: int
    depth_reached: int

class RecursiveRetriever:
    """Retriever that recursively follows references and queries"""

    def __init__(
        self,
        base_retriever,
        llm_client=None,
        max_depth: int = 3,
        max_documents: int = 10
    ):
        self.retriever = base_retriever
        self.llm = llm_client
        self.max_depth = max_depth
        self.max_documents = max_documents

    def retrieve(self, query: str) -> RecursiveResult:
        """Perform recursive retrieval"""
        retrieval_path = []
        collected_docs = []
        seen_doc_ids: Set[str] = set()
        current_queries = [query]
        depth = 0

        while current_queries and depth < self.max_depth:
            depth += 1
            next_queries = []

            for q in current_queries:
                step = self._execute_retrieval_step(
                    q, depth, seen_doc_ids
                )
                retrieval_path.append(step)

                # Collect new documents
                for result in step.results:
                    doc_id = result.get("id", str(uuid.uuid4()))
                    if doc_id not in seen_doc_ids:
                        seen_doc_ids.add(doc_id)
                        collected_docs.append(result)

                        if len(collected_docs) >= self.max_documents:
                            break

                # Collect references for next iteration
                next_queries.extend(step.references_found)

                if len(collected_docs) >= self.max_documents:
                    break

            current_queries = next_queries[:5]  # Limit queries per depth

        # Build final context
        final_context = self._build_context(collected_docs)

        return RecursiveResult(
            final_context=final_context,
            retrieval_path=retrieval_path,
            total_documents=len(collected_docs),
            depth_reached=depth
        )

    def _execute_retrieval_step(
        self,
        query: str,
        depth: int,
        seen_ids: Set[str]
    ) -> RetrievalStep:
        """Execute a single retrieval step"""
        step_id = f"step_{depth}_{uuid.uuid4().hex[:6]}"

        # Retrieve documents
        results = self.retriever.retrieve(query, top_k=5)

        # Filter already seen
        new_results = [
            r for r in results
            if r.get("id", str(uuid.uuid4())) not in seen_ids
        ]

        # Extract references
        references = self._extract_references(new_results)

        return RetrievalStep(
            step_id=step_id,
            action=RetrievalAction.RETRIEVE,
            query=query,
            results=new_results,
            references_found=references,
            reasoning=f"Retrieved {len(new_results)} new documents, found {len(references)} references"
        )

    def _extract_references(self, results: List[Dict]) -> List[str]:
        """Extract references from retrieved documents"""
        references = []

        for result in results:
            content = result.get("content", "")

            # Look for explicit references
            import re
            ref_patterns = [
                r"see also[:\s]+([^.]+)",
                r"refer(?:s|ring)? to[:\s]+([^.]+)",
                r"as described in[:\s]+([^.]+)",
                r"for more (?:information|details)[,\s]+(?:see|read)[:\s]+([^.]+)"
            ]

            for pattern in ref_patterns:
                matches = re.findall(pattern, content, re.IGNORECASE)
                references.extend(matches)

            # Look for document links
            link_pattern = r'\[([^\]]+)\]\([^)]+\)'
            links = re.findall(link_pattern, content)
            references.extend(links)

        # Clean and deduplicate
        references = list(set(
            ref.strip() for ref in references
            if len(ref.strip()) > 3
        ))

        return references[:5]  # Limit references

    def _build_context(self, documents: List[Dict]) -> str:
        """Build context from collected documents"""
        context_parts = []

        for i, doc in enumerate(documents):
            content = doc.get("content", "")
            source = doc.get("source", f"Document {i+1}")
            context_parts.append(f"[{source}]\n{content}")

        return "\n\n---\n\n".join(context_parts)
```

## Query Decomposition

```python
class QueryDecomposer:
    """Decompose complex queries into sub-queries"""

    def __init__(self, llm_client=None):
        self.llm = llm_client

    def decompose(self, query: str) -> List[Dict]:
        """Decompose query into sub-queries"""
        if not self.llm:
            return [{"query": query, "type": "original", "dependency": None}]

        decomposition_prompt = f"""Analyze this question and break it down into simpler sub-questions if needed.
If the question is already simple, return it as is.

Question: {query}

For each sub-question, indicate:
1. The sub-question itself
2. Whether it depends on the answer to a previous sub-question

Format your response as:
SUB1: [question]
DEPENDS: [none or SUB number]

Sub-questions:"""

        response = self.llm.generate(decomposition_prompt)

        # Parse response
        sub_queries = self._parse_decomposition(response, query)

        return sub_queries

    def _parse_decomposition(
        self,
        response: str,
        original_query: str
    ) -> List[Dict]:
        """Parse decomposition response"""
        import re
        sub_queries = []

        lines = response.strip().split('\n')
        current_sub = None
        current_depends = None

        for line in lines:
            if line.startswith('SUB'):
                if current_sub:
                    sub_queries.append({
                        "query": current_sub,
                        "type": "decomposed",
                        "dependency": current_depends
                    })

                match = re.match(r'SUB\d+:\s*(.+)', line)
                if match:
                    current_sub = match.group(1)
                current_depends = None

            elif line.startswith('DEPENDS:'):
                depends = line.replace('DEPENDS:', '').strip().lower()
                if depends != 'none':
                    current_depends = depends

        if current_sub:
            sub_queries.append({
                "query": current_sub,
                "type": "decomposed",
                "dependency": current_depends
            })

        if not sub_queries:
            return [{"query": original_query, "type": "original", "dependency": None}]

        return sub_queries

class RecursiveQueryRetriever:
    """Retriever with query decomposition and recursive retrieval"""

    def __init__(
        self,
        base_retriever,
        llm_client=None,
        max_depth: int = 3
    ):
        self.retriever = base_retriever
        self.llm = llm_client
        self.decomposer = QueryDecomposer(llm_client)
        self.recursive = RecursiveRetriever(base_retriever, llm_client, max_depth)

    def retrieve(self, query: str) -> Dict:
        """Retrieve with decomposition"""
        # Decompose query
        sub_queries = self.decomposer.decompose(query)

        # Process each sub-query
        all_results = []
        sub_answers = {}

        for i, sub_q in enumerate(sub_queries):
            # Substitute dependencies
            actual_query = self._substitute_dependencies(
                sub_q["query"],
                sub_q["dependency"],
                sub_answers
            )

            # Recursive retrieval
            result = self.recursive.retrieve(actual_query)
            all_results.append({
                "sub_query": sub_q,
                "actual_query": actual_query,
                "result": result
            })

            # Generate intermediate answer if LLM available
            if self.llm and result.final_context:
                answer = self._generate_intermediate_answer(
                    actual_query,
                    result.final_context
                )
                sub_answers[f"sub{i+1}"] = answer

        # Combine all contexts
        combined_context = self._combine_contexts(all_results)

        return {
            "combined_context": combined_context,
            "sub_query_results": all_results,
            "decomposition": sub_queries,
            "total_retrieval_steps": sum(
                len(r["result"].retrieval_path) for r in all_results
            )
        }

    def _substitute_dependencies(
        self,
        query: str,
        dependency: Optional[str],
        answers: Dict[str, str]
    ) -> str:
        """Substitute dependency answers into query"""
        if not dependency or dependency not in answers:
            return query

        # Simple substitution
        return f"{query} (Context: {answers[dependency]})"

    def _generate_intermediate_answer(
        self,
        query: str,
        context: str
    ) -> str:
        """Generate answer for intermediate query"""
        prompt = f"""Based on the context, briefly answer the question.

Context: {context[:2000]}

Question: {query}

Brief answer:"""

        return self.llm.generate(prompt)

    def _combine_contexts(self, results: List[Dict]) -> str:
        """Combine contexts from all sub-queries"""
        parts = []

        for i, r in enumerate(results):
            query = r["sub_query"]["query"]
            context = r["result"].final_context

            parts.append(f"[Sub-query {i+1}: {query}]\n{context}")

        return "\n\n===\n\n".join(parts)
```

## Multi-Hop Retrieval

```python
class MultiHopRetriever:
    """Retriever for multi-hop reasoning questions"""

    def __init__(
        self,
        base_retriever,
        llm_client,
        max_hops: int = 3
    ):
        self.retriever = base_retriever
        self.llm = llm_client
        self.max_hops = max_hops

    def retrieve(self, query: str) -> Dict:
        """Multi-hop retrieval with reasoning"""
        hops = []
        current_context = ""
        current_query = query

        for hop in range(self.max_hops):
            # Retrieve for current query
            results = self.retriever.retrieve(current_query, top_k=3)

            # Build hop context
            hop_context = self._build_hop_context(results)

            # Analyze if more hops needed
            analysis = self._analyze_hop(
                query,
                current_query,
                hop_context,
                current_context,
                hop
            )

            hops.append({
                "hop_number": hop + 1,
                "query": current_query,
                "results": results,
                "context": hop_context,
                "analysis": analysis
            })

            # Update cumulative context
            current_context += f"\n\n[Hop {hop + 1}]\n{hop_context}"

            # Check if we should continue
            if analysis["should_stop"]:
                break

            # Generate next query
            current_query = analysis.get("next_query", current_query)

        return {
            "final_context": current_context,
            "hops": hops,
            "total_hops": len(hops),
            "original_query": query
        }

    def _build_hop_context(self, results: List[Dict]) -> str:
        """Build context from hop results"""
        parts = []
        for r in results:
            content = r.get("content", "")
            parts.append(content)
        return "\n\n".join(parts)

    def _analyze_hop(
        self,
        original_query: str,
        current_query: str,
        hop_context: str,
        cumulative_context: str,
        hop_number: int
    ) -> Dict:
        """Analyze hop results and determine next action"""
        if not self.llm:
            return {"should_stop": True, "reason": "No LLM for analysis"}

        analysis_prompt = f"""Analyze the retrieval results for a multi-hop question.

Original Question: {original_query}
Current Query: {current_query}
Hop Number: {hop_number + 1}

New Information Retrieved:
{hop_context[:1500]}

Previous Context:
{cumulative_context[:1000]}

Determine:
1. Can the original question be answered with current information?
2. If not, what additional information is needed?
3. What should be the next search query?

Respond in format:
ANSWERABLE: [yes/no]
MISSING: [what information is missing, or "none"]
NEXT_QUERY: [next search query, or "none"]"""

        response = self.llm.generate(analysis_prompt)

        # Parse response
        answerable = "yes" in response.lower().split("ANSWERABLE:")[-1].split("\n")[0]
        should_stop = answerable or hop_number >= self.max_hops - 1

        next_query = None
        if "NEXT_QUERY:" in response:
            next_part = response.split("NEXT_QUERY:")[-1].strip()
            if next_part and "none" not in next_part.lower():
                next_query = next_part.split("\n")[0].strip()

        return {
            "should_stop": should_stop,
            "answerable": answerable,
            "next_query": next_query,
            "raw_analysis": response
        }
```

## Self-Querying Recursive Retrieval

```python
class SelfQueryingRetriever:
    """Retriever that generates its own follow-up queries"""

    def __init__(
        self,
        base_retriever,
        llm_client,
        max_iterations: int = 3
    ):
        self.retriever = base_retriever
        self.llm = llm_client
        self.max_iterations = max_iterations

    def retrieve(self, query: str) -> Dict:
        """Self-querying retrieval loop"""
        iterations = []
        all_contexts = []
        current_query = query

        for i in range(self.max_iterations):
            # Retrieve
            results = self.retriever.retrieve(current_query, top_k=3)
            context = self._results_to_context(results)
            all_contexts.append(context)

            # Evaluate completeness
            evaluation = self._evaluate_completeness(
                query,
                all_contexts
            )

            iterations.append({
                "iteration": i + 1,
                "query": current_query,
                "results_count": len(results),
                "evaluation": evaluation
            })

            if evaluation["is_complete"]:
                break

            # Generate follow-up query
            follow_up = self._generate_follow_up(
                query,
                all_contexts,
                evaluation["gaps"]
            )

            if not follow_up:
                break

            current_query = follow_up

        return {
            "final_context": "\n\n---\n\n".join(all_contexts),
            "iterations": iterations,
            "total_iterations": len(iterations),
            "original_query": query
        }

    def _results_to_context(self, results: List[Dict]) -> str:
        """Convert results to context string"""
        return "\n\n".join(r.get("content", "") for r in results)

    def _evaluate_completeness(
        self,
        original_query: str,
        contexts: List[str]
    ) -> Dict:
        """Evaluate if we have enough information"""
        combined = "\n".join(contexts)

        prompt = f"""Evaluate if the retrieved information is sufficient to answer the question.

Question: {original_query}

Retrieved Information:
{combined[:3000]}

Analyze:
1. Is the information sufficient to fully answer the question?
2. What specific information is missing (if any)?

SUFFICIENT: [yes/no]
MISSING: [list specific gaps, or "none"]"""

        response = self.llm.generate(prompt)

        is_complete = "yes" in response.lower().split("SUFFICIENT:")[-1].split("\n")[0]

        gaps = []
        if "MISSING:" in response:
            missing_part = response.split("MISSING:")[-1].strip()
            if "none" not in missing_part.lower():
                gaps = [g.strip() for g in missing_part.split(",")]

        return {
            "is_complete": is_complete,
            "gaps": gaps
        }

    def _generate_follow_up(
        self,
        original_query: str,
        contexts: List[str],
        gaps: List[str]
    ) -> Optional[str]:
        """Generate follow-up query to fill gaps"""
        if not gaps:
            return None

        prompt = f"""Generate a search query to find the missing information.

Original Question: {original_query}

Information Gaps:
{chr(10).join(f"- {g}" for g in gaps)}

Generate a single, focused search query to address the most important gap:"""

        response = self.llm.generate(prompt)

        return response.strip() if response.strip() else None
```

## Complete Recursive RAG

```python
class RecursiveRAG:
    """RAG system with recursive retrieval capabilities"""

    def __init__(self, base_retriever, generator):
        self.retriever = base_retriever
        self.generator = generator
        self.recursive = RecursiveRetriever(base_retriever, generator)
        self.multi_hop = MultiHopRetriever(base_retriever, generator)
        self.self_query = SelfQueryingRetriever(base_retriever, generator)

    def query(
        self,
        question: str,
        mode: str = "auto"
    ) -> Dict:
        """Query with recursive retrieval"""
        # Determine complexity
        if mode == "auto":
            mode = self._determine_mode(question)

        # Execute appropriate retrieval
        if mode == "simple":
            results = self.retriever.retrieve(question, top_k=5)
            context = "\n\n".join(r.get("content", "") for r in results)
            retrieval_info = {"mode": "simple", "steps": 1}

        elif mode == "recursive":
            result = self.recursive.retrieve(question)
            context = result.final_context
            retrieval_info = {
                "mode": "recursive",
                "steps": len(result.retrieval_path),
                "depth": result.depth_reached
            }

        elif mode == "multi_hop":
            result = self.multi_hop.retrieve(question)
            context = result["final_context"]
            retrieval_info = {
                "mode": "multi_hop",
                "hops": result["total_hops"]
            }

        else:  # self_query
            result = self.self_query.retrieve(question)
            context = result["final_context"]
            retrieval_info = {
                "mode": "self_query",
                "iterations": result["total_iterations"]
            }

        # Generate answer
        prompt = f"""Answer the question based on the provided context.

Context:
{context[:4000]}

Question: {question}

Provide a comprehensive answer:"""

        answer = self.generator.generate(prompt)

        return {
            "answer": answer,
            "retrieval_info": retrieval_info,
            "context_length": len(context)
        }

    def _determine_mode(self, question: str) -> str:
        """Determine best retrieval mode for question"""
        question_lower = question.lower()

        # Check for multi-hop indicators
        multi_hop_indicators = [
            "relationship between",
            "how does X affect Y",
            "compare",
            "what led to"
        ]
        if any(ind in question_lower for ind in multi_hop_indicators):
            return "multi_hop"

        # Check for complex query indicators
        if len(question.split()) > 20:
            return "recursive"

        if "?" in question and question.count("?") > 1:
            return "self_query"

        return "simple"

# Usage
class MockRetriever:
    def retrieve(self, query, top_k=5):
        return [{"content": f"Result for: {query}", "id": "1"}]

class MockGenerator:
    def generate(self, prompt):
        return "Generated answer."

rag = RecursiveRAG(MockRetriever(), MockGenerator())

result = rag.query("What is the relationship between X and Y?")
print(f"Mode: {result['retrieval_info']['mode']}")
print(f"Answer: {result['answer']}")
```

## Conclusion

Recursive retrieval enables RAG systems to handle complex queries requiring multiple steps, reference following, or multi-hop reasoning. By decomposing queries, following references, and iteratively retrieving until sufficient information is gathered, recursive retrieval significantly extends the capabilities of RAG systems for answering complex, real-world questions.

