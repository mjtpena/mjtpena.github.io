---
title: "Understanding Runnable Interfaces in LangChain"
author: Michael John Peña
draft: false
date: 2023-10-03
description: "Deep dive into LangChain's Runnable interface and its implementations for building flexible LLM pipelines."
tags:
  - LangChain
  - Runnable
  - Python
  - LLM
  - Architecture
---

## Introduction

The Runnable interface is the foundation of LangChain's composability. Understanding how Runnables work enables you to build custom components that integrate seamlessly with the LCEL ecosystem.

## The Runnable Protocol

### Core Interface

```python
from abc import ABC, abstractmethod
from typing import Any, Optional, List, Iterator, AsyncIterator
from langchain_core.runnables import RunnableConfig

class RunnableProtocol(ABC):
    """The core Runnable interface that all LCEL components implement"""

    @abstractmethod
    def invoke(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        """Synchronous invocation"""
        pass

    @abstractmethod
    async def ainvoke(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        """Asynchronous invocation"""
        pass

    @abstractmethod
    def batch(self, inputs: List[Any], config: Optional[RunnableConfig] = None) -> List[Any]:
        """Batch processing"""
        pass

    @abstractmethod
    async def abatch(self, inputs: List[Any], config: Optional[RunnableConfig] = None) -> List[Any]:
        """Async batch processing"""
        pass

    @abstractmethod
    def stream(self, input: Any, config: Optional[RunnableConfig] = None) -> Iterator[Any]:
        """Streaming output"""
        pass

    @abstractmethod
    async def astream(self, input: Any, config: Optional[RunnableConfig] = None) -> AsyncIterator[Any]:
        """Async streaming"""
        pass
```

### Built-in Runnable Types

```python
from langchain_core.runnables import (
    Runnable,
    RunnableLambda,
    RunnablePassthrough,
    RunnableParallel,
    RunnableBranch,
    RunnableSequence,
    RunnableBinding
)

# RunnableLambda - Wrap any function
def my_function(x: dict) -> dict:
    return {"processed": x["input"].upper()}

runnable_func = RunnableLambda(my_function)
result = runnable_func.invoke({"input": "hello"})
# {"processed": "HELLO"}

# RunnablePassthrough - Pass input unchanged
passthrough = RunnablePassthrough()
result = passthrough.invoke({"data": "value"})
# {"data": "value"}

# With assignment - add new keys while passing through
passthrough_assign = RunnablePassthrough.assign(
    new_key=lambda x: x["data"].upper()
)
result = passthrough_assign.invoke({"data": "value"})
# {"data": "value", "new_key": "VALUE"}

# RunnableParallel - Execute multiple runnables in parallel
parallel = RunnableParallel(
    upper=RunnableLambda(lambda x: x["text"].upper()),
    lower=RunnableLambda(lambda x: x["text"].lower()),
    length=RunnableLambda(lambda x: len(x["text"]))
)
result = parallel.invoke({"text": "Hello World"})
# {"upper": "HELLO WORLD", "lower": "hello world", "length": 11}
```

## Creating Custom Runnables

### Basic Custom Runnable

```python
from langchain_core.runnables import Runnable
from typing import Any, Optional

class TextCleaner(Runnable):
    """Custom runnable for text cleaning"""

    def __init__(self, lowercase: bool = True, strip: bool = True):
        self.lowercase = lowercase
        self.strip = strip

    def invoke(self, input: str, config: Optional[RunnableConfig] = None) -> str:
        result = input
        if self.strip:
            result = result.strip()
        if self.lowercase:
            result = result.lower()
        return result

    async def ainvoke(self, input: str, config: Optional[RunnableConfig] = None) -> str:
        return self.invoke(input, config)

    def batch(self, inputs: List[str], config: Optional[RunnableConfig] = None) -> List[str]:
        return [self.invoke(i, config) for i in inputs]

    async def abatch(self, inputs: List[str], config: Optional[RunnableConfig] = None) -> List[str]:
        return self.batch(inputs, config)

# Usage
cleaner = TextCleaner(lowercase=True, strip=True)
result = cleaner.invoke("  HELLO WORLD  ")
# "hello world"

# Compose with other runnables
chain = cleaner | prompt | llm | StrOutputParser()
```

### Stateful Runnable

```python
from threading import Lock
from datetime import datetime

class RateLimitedRunnable(Runnable):
    """Runnable with rate limiting"""

    def __init__(self, wrapped: Runnable, max_calls_per_minute: int = 60):
        self.wrapped = wrapped
        self.max_calls = max_calls_per_minute
        self.calls = []
        self.lock = Lock()

    def _check_rate_limit(self):
        """Check and enforce rate limit"""
        now = datetime.now()
        with self.lock:
            # Remove calls older than 1 minute
            self.calls = [t for t in self.calls if (now - t).seconds < 60]

            if len(self.calls) >= self.max_calls:
                oldest = min(self.calls)
                wait_time = 60 - (now - oldest).seconds
                raise Exception(f"Rate limit exceeded. Wait {wait_time}s")

            self.calls.append(now)

    def invoke(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        self._check_rate_limit()
        return self.wrapped.invoke(input, config)

    async def ainvoke(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        self._check_rate_limit()
        return await self.wrapped.ainvoke(input, config)

# Usage
rate_limited_llm = RateLimitedRunnable(llm, max_calls_per_minute=20)
chain = prompt | rate_limited_llm | StrOutputParser()
```

### Streaming Custom Runnable

```python
from typing import Iterator, AsyncIterator

class StreamingTextProcessor(Runnable):
    """Custom runnable that supports streaming"""

    def __init__(self, chunk_size: int = 10):
        self.chunk_size = chunk_size

    def invoke(self, input: str, config: Optional[RunnableConfig] = None) -> str:
        # For non-streaming, return full result
        return input.upper()

    def stream(self, input: str, config: Optional[RunnableConfig] = None) -> Iterator[str]:
        # Stream output in chunks
        text = input.upper()
        for i in range(0, len(text), self.chunk_size):
            yield text[i:i + self.chunk_size]

    async def astream(self, input: str, config: Optional[RunnableConfig] = None) -> AsyncIterator[str]:
        text = input.upper()
        for i in range(0, len(text), self.chunk_size):
            yield text[i:i + self.chunk_size]

# Usage
processor = StreamingTextProcessor(chunk_size=5)

# Streaming
for chunk in processor.stream("hello world"):
    print(chunk, end="")
# HELLO WORLD (printed in chunks)
```

## Advanced Runnable Patterns

### Runnable with Side Effects

```python
import logging

class LoggingRunnable(Runnable):
    """Runnable that logs inputs and outputs"""

    def __init__(self, wrapped: Runnable, name: str = "unnamed"):
        self.wrapped = wrapped
        self.name = name
        self.logger = logging.getLogger(__name__)

    def invoke(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        self.logger.info(f"[{self.name}] Input: {input}")
        result = self.wrapped.invoke(input, config)
        self.logger.info(f"[{self.name}] Output: {result}")
        return result

    # Implement other methods...

# Decorator approach
def with_logging(name: str):
    """Decorator to add logging to any runnable"""
    def decorator(runnable: Runnable) -> Runnable:
        return LoggingRunnable(runnable, name)
    return decorator

# Usage
logged_chain = LoggingRunnable(prompt | llm | StrOutputParser(), "qa_chain")
```

### Conditional Runnable

```python
from typing import Callable

class ConditionalRunnable(Runnable):
    """Execute different runnables based on condition"""

    def __init__(
        self,
        condition: Callable[[Any], bool],
        true_branch: Runnable,
        false_branch: Runnable
    ):
        self.condition = condition
        self.true_branch = true_branch
        self.false_branch = false_branch

    def invoke(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        if self.condition(input):
            return self.true_branch.invoke(input, config)
        else:
            return self.false_branch.invoke(input, config)

# Usage
conditional = ConditionalRunnable(
    condition=lambda x: len(x.get("text", "")) > 100,
    true_branch=summary_chain,  # Long text -> summarize
    false_branch=RunnablePassthrough()  # Short text -> pass through
)
```

### Retry Runnable

```python
import time
from typing import Type

class RetryRunnable(Runnable):
    """Runnable with retry logic"""

    def __init__(
        self,
        wrapped: Runnable,
        max_retries: int = 3,
        delay: float = 1.0,
        backoff: float = 2.0,
        exceptions: tuple = (Exception,)
    ):
        self.wrapped = wrapped
        self.max_retries = max_retries
        self.delay = delay
        self.backoff = backoff
        self.exceptions = exceptions

    def invoke(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        last_exception = None
        current_delay = self.delay

        for attempt in range(self.max_retries + 1):
            try:
                return self.wrapped.invoke(input, config)
            except self.exceptions as e:
                last_exception = e
                if attempt < self.max_retries:
                    time.sleep(current_delay)
                    current_delay *= self.backoff

        raise last_exception

# Usage
reliable_chain = RetryRunnable(
    prompt | llm | StrOutputParser(),
    max_retries=3,
    delay=1.0,
    backoff=2.0
)
```

### Caching Runnable

```python
from hashlib import md5
import json

class CachingRunnable(Runnable):
    """Runnable with result caching"""

    def __init__(self, wrapped: Runnable, cache_backend=None):
        self.wrapped = wrapped
        self.cache = cache_backend or {}

    def _get_cache_key(self, input: Any) -> str:
        serialized = json.dumps(input, sort_keys=True, default=str)
        return md5(serialized.encode()).hexdigest()

    def invoke(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        cache_key = self._get_cache_key(input)

        if cache_key in self.cache:
            return self.cache[cache_key]

        result = self.wrapped.invoke(input, config)
        self.cache[cache_key] = result
        return result

    def clear_cache(self):
        self.cache.clear()

# Usage
cached_chain = CachingRunnable(prompt | llm | StrOutputParser())

# First call - executes chain
result1 = cached_chain.invoke({"question": "What is AI?"})

# Second call - returns cached result
result2 = cached_chain.invoke({"question": "What is AI?"})
```

## Combining Runnables

```python
# Complex chain composition
from langchain_core.runnables import RunnableParallel, RunnableLambda

# Create a multi-step processing pipeline
preprocessing = RunnableLambda(lambda x: {"text": x["input"].strip().lower()})

analysis = RunnableParallel(
    sentiment=sentiment_chain,
    entities=entity_chain,
    summary=summary_chain
)

postprocessing = RunnableLambda(lambda x: {
    "results": x,
    "processed_at": datetime.now().isoformat()
})

# Full pipeline
pipeline = preprocessing | analysis | postprocessing

# Execute
result = pipeline.invoke({"input": "  Some text to analyze...  "})
```

## Conclusion

Understanding the Runnable interface is crucial for building sophisticated LangChain applications. By implementing custom Runnables, you can add specialized functionality like rate limiting, caching, retries, and logging while maintaining compatibility with the LCEL ecosystem.
