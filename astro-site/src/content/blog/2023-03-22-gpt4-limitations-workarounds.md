---
title: "GPT-4 Limitations and Workarounds"
description: "GPT-4's training data ends in September 2021. It doesn't know about recent events, technologies, or updates."
author: Michael John Pena
draft: false
date: 2023-03-22
tags:
  - OpenAI
  - AI
  - GPT-4
  - Limitations
  - Best Practices
---

## Limitation 1: Knowledge Cutoff

GPT-4's training data ends in September 2021. It doesn't know about recent events, technologies, or updates.

### Workaround: RAG Pattern

```python
class CurrentKnowledgeAugmentor:
    """Augment GPT-4 with current information."""

    def __init__(self, client, search_client):
        self.client = client
        self.search = search_client

    async def answer_with_current_info(
        self,
        question: str,
        require_recent: bool = False
    ) -> dict:
        """Answer question with current information."""

        # Check if question requires current knowledge
        requires_current = require_recent or await self._needs_current_info(question)

        if requires_current:
            # Search for recent information
            search_results = await self.search.search(question)
            context = self._format_search_results(search_results)

            prompt = f"""Answer this question using the provided recent information.

Question: {question}

Recent Information (from web search):
{context}

Instructions:
- Use the provided information to answer
- Cite sources when possible
- If the information is insufficient, say so
- Distinguish between the provided facts and any reasoning"""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}]
            )

            return {
                "answer": response.content,
                "sources": search_results,
                "augmented": True
            }
        else:
            # Direct answer for historical/conceptual questions
            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": question}]
            )

            return {"answer": response.content, "augmented": False}

    async def _needs_current_info(self, question: str) -> bool:
        """Determine if question needs current information."""
        current_indicators = [
            "latest", "current", "now", "today", "recently",
            "2022", "2023", "new version", "update"
        ]
        return any(ind in question.lower() for ind in current_indicators)
```

## Limitation 2: Hallucination

GPT-4 can generate plausible-sounding but incorrect information.

### Workaround: Verification Layer

```python
class HallucinationGuard:
    """Detect and prevent hallucinations."""

    def __init__(self, client):
        self.client = client

    async def generate_with_verification(
        self,
        prompt: str,
        verification_sources: list[str] = None
    ) -> dict:
        """Generate response with hallucination checks."""

        # Generate initial response
        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[
                {"role": "system", "content": """When answering:
1. Distinguish facts from opinions
2. Express uncertainty when appropriate
3. Avoid making up specific numbers, dates, or quotes unless certain
4. Say "I don't know" if you don't know"""},
                {"role": "user", "content": prompt}
            ]
        )

        initial_answer = response.content

        # Self-verification
        verification = await self._verify_response(prompt, initial_answer)

        # If verification fails, regenerate with constraints
        if not verification["confident"]:
            constrained_response = await self.client.chat_completion(
                model="gpt-4",
                messages=[
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": initial_answer},
                    {"role": "user", "content": f"""Review your response for accuracy.

Verification concerns: {verification['concerns']}

Provide a revised response that:
1. Removes or qualifies uncertain claims
2. Adds appropriate caveats
3. Focuses on what you're confident about"""}
                ]
            )
            return {
                "answer": constrained_response.content,
                "verification": verification,
                "revised": True
            }

        return {
            "answer": initial_answer,
            "verification": verification,
            "revised": False
        }

    async def _verify_response(
        self,
        question: str,
        answer: str
    ) -> dict:
        """Verify response for potential hallucinations."""

        prompt = f"""Evaluate this response for accuracy and confidence.

Question: {question}
Answer: {answer}

Identify:
1. Claims that might be hallucinated
2. Specific facts that should be verified
3. Appropriate confidence level (high/medium/low)

Return JSON:
{{"confident": true/false, "concerns": ["concern1", ...], "verify": ["fact1", ...]}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return {"confident": True, "concerns": [], "raw": response.content}
```

## Limitation 3: Context Window Limits

Even 32K tokens isn't enough for very large documents.

### Workaround: Chunking and Summarization

```python
class LargeDocumentHandler:
    """Handle documents exceeding context limits."""

    def __init__(self, client, chunk_size: int = 6000):
        self.client = client
        self.chunk_size = chunk_size  # tokens

    async def process_large_document(
        self,
        document: str,
        task: str
    ) -> dict:
        """Process document larger than context window."""

        # Estimate tokens (rough: 4 chars per token)
        estimated_tokens = len(document) // 4

        if estimated_tokens <= 25000:  # Fits in 32K with room for response
            return await self._direct_process(document, task)

        # Chunk the document
        chunks = self._chunk_document(document)

        # Map phase: process each chunk
        chunk_results = []
        for i, chunk in enumerate(chunks):
            result = await self._process_chunk(chunk, task, i, len(chunks))
            chunk_results.append(result)

        # Reduce phase: combine results
        final_result = await self._combine_results(chunk_results, task)

        return {
            "result": final_result,
            "chunks_processed": len(chunks),
            "method": "map_reduce"
        }

    def _chunk_document(self, document: str) -> list[str]:
        """Split document into chunks with overlap."""
        words = document.split()
        chunk_words = self.chunk_size  # Approximate words = tokens for English
        overlap = chunk_words // 10

        chunks = []
        i = 0
        while i < len(words):
            end = min(i + chunk_words, len(words))
            chunk = ' '.join(words[i:end])
            chunks.append(chunk)
            i = end - overlap if end < len(words) else end

        return chunks

    async def _process_chunk(
        self,
        chunk: str,
        task: str,
        chunk_num: int,
        total_chunks: int
    ) -> str:
        """Process a single chunk."""
        prompt = f"""Process this document chunk ({chunk_num + 1} of {total_chunks}).

Task: {task}

Document chunk:
{chunk}

Extract relevant information for the task. Note any references to content that might be in other chunks."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def _combine_results(
        self,
        results: list[str],
        task: str
    ) -> str:
        """Combine chunk results into final output."""
        results_str = "\n---\n".join([f"Chunk {i+1}:\n{r}" for i, r in enumerate(results)])

        prompt = f"""Combine these chunk analyses into a coherent final result.

Original task: {task}

Chunk analyses:
{results_str}

Create a unified response that:
1. Synthesizes information from all chunks
2. Resolves any contradictions
3. Provides a complete answer to the task"""

        response = await self.client.chat_completion(
            model="gpt-4-32k",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Limitation 4: Inconsistent Outputs

Same prompt can produce different results.

### Workaround: Consistency Layer

```python
class ConsistencyEnforcer:
    """Ensure consistent outputs."""

    def __init__(self, client):
        self.client = client

    async def generate_consistent(
        self,
        prompt: str,
        num_samples: int = 3,
        method: str = "majority"
    ) -> dict:
        """Generate consistent output through multiple samples."""

        # Generate multiple responses
        responses = []
        for _ in range(num_samples):
            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1  # Low temperature for more consistency
            )
            responses.append(response.content)

        if method == "majority":
            # Find most common response or consensus
            result = await self._find_consensus(responses, prompt)
        elif method == "best":
            # Pick best response based on criteria
            result = await self._select_best(responses, prompt)
        else:
            result = responses[0]

        return {
            "result": result,
            "all_responses": responses,
            "method": method
        }

    async def _find_consensus(
        self,
        responses: list[str],
        original_prompt: str
    ) -> str:
        """Find consensus among responses."""
        responses_str = "\n---\n".join([f"Response {i+1}:\n{r}" for i, r in enumerate(responses)])

        prompt = f"""Find the consensus among these responses.

Original question: {original_prompt}

Responses:
{responses_str}

Identify:
1. Points all responses agree on
2. Points where responses differ
3. The most accurate/complete answer

Provide the consensus response."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Limitation 5: Poor at Math

GPT-4 improves on math but still makes arithmetic errors.

### Workaround: External Computation

```python
class MathSafeProcessor:
    """Handle math safely with external computation."""

    def __init__(self, client):
        self.client = client

    async def process_with_math(
        self,
        question: str
    ) -> dict:
        """Process question that may require math."""

        # First, identify any calculations needed
        analysis = await self._analyze_for_math(question)

        if analysis["needs_calculation"]:
            # Extract and compute externally
            calculations = await self._extract_calculations(question)
            computed_results = self._compute(calculations)

            # Provide results to GPT-4
            prompt = f"""Answer this question using the computed results.

Question: {question}

Pre-computed results:
{computed_results}

Use these computed values in your answer. Do not recalculate them."""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}]
            )

            return {
                "answer": response.content,
                "calculations": computed_results,
                "verified": True
            }
        else:
            # No math needed, direct answer
            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": question}]
            )

            return {"answer": response.content, "verified": False}

    def _compute(self, calculations: list[dict]) -> dict:
        """Compute math externally."""
        results = {}
        for calc in calculations:
            try:
                # Safe eval for simple math
                result = eval(calc["expression"], {"__builtins__": {}}, {
                    "sum": sum, "min": min, "max": max, "abs": abs,
                    "round": round, "len": len
                })
                results[calc["name"]] = result
            except:
                results[calc["name"]] = "Error"
        return results
```

## Limitation 6: Formatting Inconsistency

GPT-4 may not always follow format instructions.

### Workaround: Output Parsing and Retry

```python
class StructuredOutputHandler:
    """Ensure structured output format."""

    def __init__(self, client):
        self.client = client

    async def get_json_output(
        self,
        prompt: str,
        schema: dict,
        max_retries: int = 3
    ) -> dict:
        """Get JSON output matching schema."""

        schema_str = json.dumps(schema, indent=2)

        for attempt in range(max_retries):
            full_prompt = f"""{prompt}

Return your response as valid JSON matching this schema:
{schema_str}

Return ONLY the JSON, no other text."""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": full_prompt}],
                temperature=0.1
            )

            # Try to parse JSON
            try:
                content = response.content
                # Extract JSON if wrapped in markdown
                if "```json" in content:
                    start = content.find("```json") + 7
                    end = content.find("```", start)
                    content = content[start:end]
                elif "```" in content:
                    start = content.find("```") + 3
                    end = content.find("```", start)
                    content = content[start:end]

                result = json.loads(content)

                # Validate against schema (simplified)
                if self._validate_schema(result, schema):
                    return {"data": result, "attempts": attempt + 1}

            except json.JSONDecodeError:
                pass

            # Retry with correction prompt
            if attempt < max_retries - 1:
                prompt = f"Your previous response wasn't valid JSON. {prompt}"

        return {"error": "Failed to get valid JSON", "last_response": response.content}

    def _validate_schema(self, data: dict, schema: dict) -> bool:
        """Simple schema validation."""
        # Check required fields exist
        required = schema.get("required", [])
        return all(field in data for field in required)
```

## Summary of Key Workarounds

| Limitation | Workaround |
|------------|------------|
| Knowledge cutoff | RAG with web search |
| Hallucination | Verification layer, confidence prompting |
| Context limits | Chunking, map-reduce |
| Inconsistency | Multiple samples, consensus |
| Math errors | External computation |
| Format issues | Parsing with retry |

Understanding limitations and implementing workarounds turns GPT-4 from a cool demo into a reliable production tool.
