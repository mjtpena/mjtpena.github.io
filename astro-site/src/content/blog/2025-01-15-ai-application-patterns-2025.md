---
title: "AI Application Patterns for 2025: Building Production-Ready AI Systems"
author: Michael John Peña
draft: false
date: 2025-01-15
tags:
  - AI
  - Architecture
  - Design Patterns
  - Azure
  - LLM

---

I wrote "AI Application Patterns for 2025: Building Production-Ready AI Systems" to share practical, production-minded guidance on this topic.

## Pattern 1: Retrieval-Augmented Generation (RAG)

The most common pattern for knowledge-based AI:

```python
from azure.ai.foundry import AIFoundryClient
from azure.search.documents import SearchClient
from azure.identity import DefaultAzureCredential

class RAGApplication:
    def __init__(self):
        self.ai_client = AIFoundryClient(
            project="my-project",
            credential=DefaultAzureCredential()
        )
        self.search_client = SearchClient(
            endpoint="https://search.search.windows.net",
            index_name="documents",
            credential=DefaultAzureCredential()
        )

    def retrieve(self, query: str, top_k: int = 5) -> list[dict]:
        """Retrieve relevant documents."""
        # Generate query embedding
        embedding = self.ai_client.embeddings.create(
            deployment="embeddings",
            input=[query]
        ).data[0].embedding

        # Vector search
        results = self.search_client.search(
            search_text=query,
            vector_queries=[{
                "vector": embedding,
                "k_nearest_neighbors": top_k,
                "fields": "content_vector"
            }],
            select=["title", "content", "source"]
        )

        return [{"title": r["title"], "content": r["content"], "source": r["source"]}
                for r in results]

    def generate(self, query: str, context: list[dict]) -> str:
        """Generate answer using retrieved context."""
        context_text = "\n\n".join([
            f"Source: {doc['source']}\n{doc['content']}"
            for doc in context
        ])

        response = self.ai_client.chat.complete(
            deployment="gpt-4o",
            messages=[
                {"role": "system", "content": f"""Answer questions based on the provided context.
                If the context doesn't contain the answer, say so.
                Always cite your sources.

                Context:
                {context_text}"""},
                {"role": "user", "content": query}
            ]
        )

        return response.choices[0].message.content

    def query(self, question: str) -> dict:
        """Full RAG pipeline."""
        # Retrieve
        context = self.retrieve(question)

        # Generate
        answer = self.generate(question, context)

        return {
            "question": question,
            "answer": answer,
            "sources": [doc["source"] for doc in context]
        }
```

## Pattern 2: Agent with Tools

For tasks requiring actions beyond text generation:

```python
from azure.ai.foundry.agents import Agent, Tool, AgentExecutor

class DataAnalystAgent:
    def __init__(self, ai_client):
        self.ai_client = ai_client
        self.tools = self._setup_tools()
        self.agent = self._setup_agent()

    def _setup_tools(self) -> list[Tool]:
        return [
            Tool(
                name="sql_query",
                description="Execute SQL query against the warehouse",
                function=self._execute_sql
            ),
            Tool(
                name="python_code",
                description="Execute Python code for data analysis",
                function=self._execute_python
            ),
            Tool(
                name="create_chart",
                description="Create a visualization",
                function=self._create_chart
            ),
            Tool(
                name="save_file",
                description="Save results to a file",
                function=self._save_file
            )
        ]

    def _setup_agent(self) -> Agent:
        return Agent(
            model="gpt-4o",
            instructions="""You are a data analyst. Help users analyze data by:
            1. Understanding their question
            2. Writing and executing SQL queries
            3. Analyzing results with Python if needed
            4. Creating visualizations
            5. Explaining your findings

            Always show your work and explain your reasoning.""",
            tools=self.tools,
            max_iterations=10
        )

    async def analyze(self, request: str) -> dict:
        executor = AgentExecutor(self.agent)
        result = await executor.run(request)
        return {
            "request": request,
            "response": result.final_answer,
            "steps": result.execution_steps,
            "artifacts": result.artifacts  # Charts, files, etc.
        }

    def _execute_sql(self, query: str) -> str:
        # Implementation
        pass

    def _execute_python(self, code: str) -> str:
        # Safe execution in sandbox
        pass

    def _create_chart(self, spec: dict) -> str:
        # Create and return chart URL
        pass

    def _save_file(self, content: str, filename: str) -> str:
        # Save and return path
        pass
```

## Pattern 3: Chain of Thought (CoT)

For complex reasoning tasks:

```python
class ChainOfThoughtReasoner:
    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def reason(self, problem: str, steps: int = 5) -> dict:
        """Multi-step reasoning with explicit thought process."""

        messages = [
            {"role": "system", "content": """You are a careful analytical thinker.
            For each problem:
            1. Break it into smaller sub-problems
            2. Solve each step explicitly
            3. Show your reasoning
            4. Verify your answer

            Think step by step."""},
            {"role": "user", "content": f"Problem: {problem}\n\nLet's think through this step by step."}
        ]

        thoughts = []

        for step in range(steps):
            response = await self.ai_client.chat.complete_async(
                deployment="gpt-4o",
                messages=messages,
                temperature=0.2  # Low temperature for reasoning
            )

            thought = response.choices[0].message.content
            thoughts.append({"step": step + 1, "thought": thought})

            # Check if we've reached a conclusion
            if "final answer" in thought.lower() or "conclusion" in thought.lower():
                break

            # Continue reasoning
            messages.append({"role": "assistant", "content": thought})
            messages.append({"role": "user", "content": "Continue your analysis. What's the next step?"})

        # Extract final answer
        final = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=messages + [
                {"role": "user", "content": "Summarize your final answer in a clear, concise statement."}
            ]
        )

        return {
            "problem": problem,
            "reasoning_chain": thoughts,
            "final_answer": final.choices[0].message.content
        }
```

## Pattern 4: Consensus / Ensemble

For high-stakes decisions requiring verification:

```python
class ConsensusGenerator:
    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def generate_with_consensus(self, prompt: str, n_opinions: int = 3) -> dict:
        """Generate multiple responses and synthesize."""

        # Generate diverse opinions
        tasks = []
        for i in range(n_opinions):
            tasks.append(self._generate_opinion(prompt, perspective=i))

        opinions = await asyncio.gather(*tasks)

        # Synthesize consensus
        synthesis = await self._synthesize(prompt, opinions)

        return {
            "prompt": prompt,
            "opinions": opinions,
            "consensus": synthesis["consensus"],
            "confidence": synthesis["confidence"],
            "dissenting_views": synthesis["dissent"]
        }

    async def _generate_opinion(self, prompt: str, perspective: int) -> dict:
        perspectives = [
            "Consider this from a conservative, risk-averse viewpoint.",
            "Consider this from an innovative, forward-thinking viewpoint.",
            "Consider this from a practical, implementation-focused viewpoint."
        ]

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[
                {"role": "system", "content": perspectives[perspective % len(perspectives)]},
                {"role": "user", "content": prompt}
            ],
            temperature=0.8  # Higher temperature for diversity
        )

        return {
            "perspective": perspectives[perspective % len(perspectives)],
            "response": response.choices[0].message.content
        }

    async def _synthesize(self, original_prompt: str, opinions: list[dict]) -> dict:
        opinions_text = "\n\n".join([
            f"Perspective: {o['perspective']}\nResponse: {o['response']}"
            for o in opinions
        ])

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[
                {"role": "system", "content": """Synthesize multiple expert opinions into a consensus view.
                Identify points of agreement and disagreement.
                Provide a confidence level for the consensus."""},
                {"role": "user", "content": f"""Original question: {original_prompt}

                Expert opinions:
                {opinions_text}

                Provide:
                1. Consensus view
                2. Confidence level (0-1)
                3. Key dissenting points"""}
            ]
        )

        # Parse structured response
        return self._parse_synthesis(response.choices[0].message.content)
```

## Pattern 5: Guardrailed Generation

For safe, controlled outputs:

```python
from azure.ai.foundry.safety import ContentFilter, GuardrailChain

class GuardrailedGenerator:
    def __init__(self, ai_client):
        self.ai_client = ai_client
        self.guardrails = self._setup_guardrails()

    def _setup_guardrails(self) -> GuardrailChain:
        return GuardrailChain([
            # Input validation
            ContentFilter(
                name="input_filter",
                block_categories=["hate", "violence", "self_harm"],
                action="block"
            ),
            # Prompt injection detection
            PromptInjectionDetector(
                name="injection_detector",
                sensitivity="high"
            ),
            # Output validation
            ContentFilter(
                name="output_filter",
                block_categories=["pii", "confidential"],
                action="redact"
            ),
            # Factuality check
            FactualityChecker(
                name="fact_checker",
                threshold=0.7
            )
        ])

    async def generate(self, prompt: str) -> dict:
        # Pre-generation checks
        input_check = await self.guardrails.check_input(prompt)
        if not input_check.passed:
            return {
                "blocked": True,
                "reason": input_check.reason
            }

        # Generate
        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        )

        output = response.choices[0].message.content

        # Post-generation checks
        output_check = await self.guardrails.check_output(output)

        return {
            "blocked": False,
            "output": output_check.content,  # Potentially redacted
            "warnings": output_check.warnings,
            "factuality_score": output_check.factuality_score
        }
```

## Pattern 6: Iterative Refinement

For high-quality outputs through self-improvement:

```python
class IterativeRefiner:
    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def generate_and_refine(self, prompt: str, max_iterations: int = 3) -> dict:
        """Generate, critique, and refine iteratively."""

        # Initial generation
        current = await self._generate(prompt)
        iterations = [{"version": 1, "content": current}]

        for i in range(max_iterations - 1):
            # Self-critique
            critique = await self._critique(prompt, current)

            # Check if good enough
            if critique["score"] >= 0.9:
                break

            # Refine based on critique
            current = await self._refine(prompt, current, critique)
            iterations.append({
                "version": i + 2,
                "content": current,
                "improvements": critique["suggestions"]
            })

        return {
            "final": current,
            "iterations": iterations,
            "refinement_count": len(iterations)
        }

    async def _generate(self, prompt: str) -> str:
        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    async def _critique(self, original_prompt: str, content: str) -> dict:
        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[
                {"role": "system", "content": """Critically evaluate this response.
                Score it 0-1 and provide specific improvement suggestions."""},
                {"role": "user", "content": f"Original request: {original_prompt}\n\nResponse to evaluate:\n{content}"}
            ]
        )
        return self._parse_critique(response.choices[0].message.content)

    async def _refine(self, original_prompt: str, content: str, critique: dict) -> str:
        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[
                {"role": "user", "content": f"""Improve this response based on feedback.

                Original request: {original_prompt}

                Current response: {content}

                Feedback: {critique['suggestions']}

                Provide an improved version."""}
            ]
        )
        return response.choices[0].message.content
```

These patterns form the building blocks of production AI applications. Combine them based on your specific requirements, and always include proper error handling, logging, and monitoring.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
