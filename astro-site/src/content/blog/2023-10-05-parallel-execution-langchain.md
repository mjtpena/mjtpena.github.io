---
title: "Parallel Execution in LangChain: Optimizing LLM Applications"
author: Michael John Peña
draft: false
date: 2023-10-05
description: "Master parallel execution patterns in LangChain to build faster, more efficient LLM applications."
tags:
  - LangChain
  - Parallel Processing
  - Performance
  - LLM
  - Async
---

## Introduction

Parallel execution is crucial for building performant LLM applications. When you have multiple independent operations, running them concurrently can dramatically reduce response times. This post covers parallel execution patterns in LangChain.

## Basic Parallel Execution

### RunnableParallel Fundamentals

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnableParallel, RunnableLambda
import time

llm = ChatOpenAI()

# Three independent prompts
prompt1 = ChatPromptTemplate.from_template("Translate to French: {text}")
prompt2 = ChatPromptTemplate.from_template("Translate to Spanish: {text}")
prompt3 = ChatPromptTemplate.from_template("Translate to German: {text}")

# Sequential execution (slow)
def sequential_translate(text: str) -> dict:
    start = time.time()
    french = (prompt1 | llm | StrOutputParser()).invoke({"text": text})
    spanish = (prompt2 | llm | StrOutputParser()).invoke({"text": text})
    german = (prompt3 | llm | StrOutputParser()).invoke({"text": text})
    print(f"Sequential: {time.time() - start:.2f}s")
    return {"french": french, "spanish": spanish, "german": german}

# Parallel execution (fast)
parallel_chain = RunnableParallel(
    french=prompt1 | llm | StrOutputParser(),
    spanish=prompt2 | llm | StrOutputParser(),
    german=prompt3 | llm | StrOutputParser()
)

start = time.time()
result = parallel_chain.invoke({"text": "Hello, how are you?"})
print(f"Parallel: {time.time() - start:.2f}s")
# Parallel is ~3x faster with 3 independent calls
```

### Async Parallel Execution

```python
import asyncio
from langchain_core.runnables import RunnableParallel

async def async_parallel_demo():
    # RunnableParallel uses async internally when using ainvoke
    parallel_chain = RunnableParallel(
        analysis1=analysis_chain_1,
        analysis2=analysis_chain_2,
        analysis3=analysis_chain_3
    )

    # Async invoke - all chains run concurrently
    result = await parallel_chain.ainvoke({"input": "Sample text"})
    return result

# Run async
result = asyncio.run(async_parallel_demo())
```

## Batch Processing

### Efficient Batch Execution

```python
from langchain_core.runnables import RunnableConfig

# Simple chain
chain = (
    ChatPromptTemplate.from_template("Summarize: {text}")
    | llm
    | StrOutputParser()
)

# Multiple inputs
documents = [
    {"text": "Document 1 content..."},
    {"text": "Document 2 content..."},
    {"text": "Document 3 content..."},
    {"text": "Document 4 content..."},
    {"text": "Document 5 content..."}
]

# Batch processing - runs in parallel with configurable concurrency
results = chain.batch(
    documents,
    config=RunnableConfig(max_concurrency=3)  # Limit concurrent calls
)

# Async batch for even better performance
async def async_batch():
    results = await chain.abatch(
        documents,
        config=RunnableConfig(max_concurrency=5)
    )
    return results
```

### Batch with Progress Tracking

```python
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed

def batch_with_progress(chain, inputs: list, max_workers: int = 5) -> list:
    """Batch process with progress bar"""
    results = [None] * len(inputs)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(chain.invoke, inp): i
            for i, inp in enumerate(inputs)
        }

        for future in tqdm(as_completed(futures), total=len(inputs)):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                results[idx] = {"error": str(e)}

    return results

# Usage
results = batch_with_progress(chain, documents, max_workers=5)
```

## Advanced Parallel Patterns

### Parallel with Aggregation

```python
from langchain_core.runnables import RunnableParallel, RunnableLambda

# Multiple analysis chains
sentiment_chain = ChatPromptTemplate.from_template(
    "Rate sentiment 1-10: {text}"
) | llm | StrOutputParser()

complexity_chain = ChatPromptTemplate.from_template(
    "Rate complexity 1-10: {text}"
) | llm | StrOutputParser()

quality_chain = ChatPromptTemplate.from_template(
    "Rate quality 1-10: {text}"
) | llm | StrOutputParser()

def aggregate_scores(results: dict) -> dict:
    """Aggregate parallel results"""
    try:
        scores = {
            k: int(''.join(filter(str.isdigit, v)) or '5')
            for k, v in results.items()
        }
        scores["average"] = sum(scores.values()) / len(scores)
        return scores
    except Exception:
        return results

# Parallel analysis with aggregation
analysis_chain = (
    RunnableParallel(
        sentiment=sentiment_chain,
        complexity=complexity_chain,
        quality=quality_chain
    )
    | RunnableLambda(aggregate_scores)
)

result = analysis_chain.invoke({"text": "This is a sample document."})
# {"sentiment": 7, "complexity": 3, "quality": 8, "average": 6.0}
```

### Fan-Out Fan-In Pattern

```python
def fan_out_fan_in_chain():
    """Process input through multiple paths and combine results"""

    # Fan-out: Different processing paths
    paths = RunnableParallel(
        technical=ChatPromptTemplate.from_template(
            "Analyze technical aspects: {content}"
        ) | llm | StrOutputParser(),

        business=ChatPromptTemplate.from_template(
            "Analyze business impact: {content}"
        ) | llm | StrOutputParser(),

        user=ChatPromptTemplate.from_template(
            "Analyze user experience: {content}"
        ) | llm | StrOutputParser()
    )

    # Fan-in: Combine all analyses
    combine_prompt = ChatPromptTemplate.from_template("""
    Combine these analyses into a comprehensive report:

    Technical Analysis:
    {technical}

    Business Analysis:
    {business}

    User Analysis:
    {user}

    Comprehensive Report:
    """)

    return paths | combine_prompt | llm | StrOutputParser()

chain = fan_out_fan_in_chain()
report = chain.invoke({"content": "New feature proposal..."})
```

### Parallel Map over Collection

```python
from typing import List

def parallel_map_chain(items: List[str], process_chain, max_concurrency: int = 10):
    """Map a chain over a collection in parallel"""

    async def process_all():
        semaphore = asyncio.Semaphore(max_concurrency)

        async def process_one(item):
            async with semaphore:
                return await process_chain.ainvoke({"item": item})

        tasks = [process_one(item) for item in items]
        return await asyncio.gather(*tasks)

    return asyncio.run(process_all())

# Usage
items = ["apple", "banana", "cherry", "date", "elderberry"]
process_chain = ChatPromptTemplate.from_template(
    "Describe the fruit: {item}"
) | llm | StrOutputParser()

results = parallel_map_chain(items, process_chain, max_concurrency=5)
```

## Rate Limiting and Throttling

### Controlled Parallel Execution

```python
import asyncio
from asyncio import Semaphore

class ThrottledExecutor:
    """Execute chains with rate limiting"""

    def __init__(self, requests_per_second: float = 10):
        self.delay = 1.0 / requests_per_second
        self.last_request = 0

    async def execute(self, chain, inputs: list, max_concurrent: int = 5):
        semaphore = Semaphore(max_concurrent)
        results = []

        async def process_one(inp):
            async with semaphore:
                # Rate limiting
                now = asyncio.get_event_loop().time()
                wait_time = self.delay - (now - self.last_request)
                if wait_time > 0:
                    await asyncio.sleep(wait_time)
                self.last_request = asyncio.get_event_loop().time()

                return await chain.ainvoke(inp)

        tasks = [process_one(inp) for inp in inputs]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return results

# Usage
executor = ThrottledExecutor(requests_per_second=5)
results = asyncio.run(executor.execute(chain, documents, max_concurrent=3))
```

### Token Bucket Rate Limiter

```python
import time
import threading

class TokenBucketLimiter:
    """Token bucket rate limiter for parallel execution"""

    def __init__(self, rate: float, capacity: int):
        self.rate = rate  # tokens per second
        self.capacity = capacity
        self.tokens = capacity
        self.last_update = time.time()
        self.lock = threading.Lock()

    def acquire(self):
        """Acquire a token, blocking if necessary"""
        with self.lock:
            now = time.time()
            # Add tokens based on time passed
            self.tokens = min(
                self.capacity,
                self.tokens + (now - self.last_update) * self.rate
            )
            self.last_update = now

            if self.tokens >= 1:
                self.tokens -= 1
                return True

            # Wait for token
            wait_time = (1 - self.tokens) / self.rate
            time.sleep(wait_time)
            self.tokens = 0
            return True

# Usage with parallel execution
limiter = TokenBucketLimiter(rate=10, capacity=20)

def rate_limited_invoke(chain, input_dict):
    limiter.acquire()
    return chain.invoke(input_dict)

# Parallel with rate limiting
from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor(max_workers=10) as executor:
    futures = [
        executor.submit(rate_limited_invoke, chain, inp)
        for inp in documents
    ]
    results = [f.result() for f in futures]
```

## Performance Monitoring

```python
import time
from dataclasses import dataclass
from typing import List

@dataclass
class ExecutionMetrics:
    total_time: float
    items_processed: int
    successful: int
    failed: int
    avg_time_per_item: float

def monitored_parallel_execution(chain, inputs: list, max_concurrency: int = 5) -> tuple:
    """Execute with performance monitoring"""
    start_time = time.time()
    successful = 0
    failed = 0
    results = []

    # Execute
    raw_results = chain.batch(
        inputs,
        config={"max_concurrency": max_concurrency}
    )

    for r in raw_results:
        if isinstance(r, Exception):
            failed += 1
            results.append(None)
        else:
            successful += 1
            results.append(r)

    total_time = time.time() - start_time
    metrics = ExecutionMetrics(
        total_time=total_time,
        items_processed=len(inputs),
        successful=successful,
        failed=failed,
        avg_time_per_item=total_time / len(inputs)
    )

    return results, metrics

# Usage
results, metrics = monitored_parallel_execution(chain, documents, max_concurrency=5)
print(f"Processed {metrics.items_processed} items in {metrics.total_time:.2f}s")
print(f"Average: {metrics.avg_time_per_item:.2f}s per item")
```

## Conclusion

Parallel execution is essential for building performant LLM applications. By leveraging RunnableParallel, async operations, batch processing, and proper rate limiting, you can significantly improve response times while respecting API limits. Always monitor performance and adjust concurrency levels based on your specific use case and API quotas.
