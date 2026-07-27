---
title: "LCEL Design Patterns for Production LLM Applications"
author: Michael John Peña
draft: false
date: 2023-10-02
description: "Advanced LCEL patterns for building robust, scalable LLM applications in production environments."
tags:
  - LangChain
  - LCEL
  - Design Patterns
  - LLM
  - Production

---

I wrote "LCEL Design Patterns for Production LLM Applications" to share practical, production-minded guidance on this topic.

## Introduction

Building production-ready LLM applications requires more than basic chain composition. This post covers advanced LCEL patterns that handle real-world challenges like error handling, retries, caching, and complex workflows.

## Error Handling Patterns

### Retry with Exponential Backoff

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnableConfig
from tenacity import retry, stop_after_attempt, wait_exponential

# Method 1: Using LangChain's built-in retry
llm = ChatOpenAI().with_retry(
    stop_after_attempt=3,
    wait_exponential_jitter=True
)

chain = prompt | llm | StrOutputParser()

# Method 2: Custom retry logic with tenacity
from langchain_core.runnables import RunnableLambda

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=60)
)
def call_llm_with_retry(input_dict: dict) -> str:
    chain = prompt | ChatOpenAI() | StrOutputParser()
    return chain.invoke(input_dict)

retry_chain = RunnableLambda(call_llm_with_retry)
```

### Graceful Degradation

```python
from langchain_core.runnables import RunnableLambda

def create_fallback_response(error: Exception, input_dict: dict) -> str:
    """Generate fallback response when chain fails"""
    return f"I apologize, but I'm unable to process your request at the moment. Error: {type(error).__name__}"

def safe_invoke(chain):
    """Wrap chain with error handling"""
    def _invoke(input_dict: dict) -> str:
        try:
            return chain.invoke(input_dict)
        except Exception as e:
            return create_fallback_response(e, input_dict)
    return RunnableLambda(_invoke)

# Usage
safe_chain = safe_invoke(prompt | llm | StrOutputParser())
result = safe_chain.invoke({"question": "What is AI?"})
```

### Validation Pattern

```python
from pydantic import BaseModel, validator
from langchain_core.output_parsers import PydanticOutputParser

class AnswerResponse(BaseModel):
    answer: str
    confidence: float
    sources: list[str]

    @validator('confidence')
    def confidence_range(cls, v):
        if not 0 <= v <= 1:
            raise ValueError('Confidence must be between 0 and 1')
        return v

    @validator('answer')
    def answer_not_empty(cls, v):
        if not v.strip():
            raise ValueError('Answer cannot be empty')
        return v

parser = PydanticOutputParser(pydantic_object=AnswerResponse)

prompt = ChatPromptTemplate.from_template("""
Answer the question and provide confidence level and sources.

{format_instructions}

Question: {question}
""").partial(format_instructions=parser.get_format_instructions())

chain = prompt | llm | parser

# Validated output
try:
    result = chain.invoke({"question": "What is machine learning?"})
    print(f"Answer: {result.answer}")
    print(f"Confidence: {result.confidence}")
except Exception as e:
    print(f"Validation failed: {e}")
```

## Caching Patterns

### In-Memory Caching

```python
from langchain_core.globals import set_llm_cache
from langchain_community.cache import InMemoryCache

# Enable global caching
set_llm_cache(InMemoryCache())

# Subsequent identical calls will use cache
chain = prompt | ChatOpenAI() | StrOutputParser()

# First call - hits API
result1 = chain.invoke({"question": "What is Python?"})

# Second call - uses cache
result2 = chain.invoke({"question": "What is Python?"})
```

### Redis Caching for Production

```python
from langchain_community.cache import RedisCache
import redis

# Connect to Redis
redis_client = redis.Redis(host="localhost", port=6379, db=0)

# Set up Redis cache
set_llm_cache(RedisCache(redis_client))

# Or with TTL
from langchain_community.cache import RedisSemanticCache
from langchain_openai import OpenAIEmbeddings

# Semantic cache - caches similar questions
set_llm_cache(RedisSemanticCache(
    redis_url="redis://localhost:6379",
    embedding=OpenAIEmbeddings(),
    score_threshold=0.95
))
```

### Custom Caching Logic

```python
from functools import lru_cache
import hashlib
import json

class CachedChain:
    def __init__(self, chain, cache_size=1000):
        self.chain = chain
        self._cache = {}
        self.cache_size = cache_size

    def _get_cache_key(self, input_dict: dict) -> str:
        serialized = json.dumps(input_dict, sort_keys=True)
        return hashlib.md5(serialized.encode()).hexdigest()

    def invoke(self, input_dict: dict) -> str:
        cache_key = self._get_cache_key(input_dict)

        if cache_key in self._cache:
            return self._cache[cache_key]

        result = self.chain.invoke(input_dict)

        if len(self._cache) >= self.cache_size:
            # Simple LRU: remove oldest
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]

        self._cache[cache_key] = result
        return result

# Usage
cached = CachedChain(prompt | llm | StrOutputParser())
result = cached.invoke({"question": "What is AI?"})
```

## Composition Patterns

### Chain Factory Pattern

```python
from typing import Callable, Dict, Any
from langchain_core.runnables import Runnable

class ChainFactory:
    """Factory for creating standardized chains"""

    def __init__(self, default_llm=None):
        self.default_llm = default_llm or ChatOpenAI()
        self.templates: Dict[str, str] = {}

    def register_template(self, name: str, template: str):
        """Register a prompt template"""
        self.templates[name] = template

    def create_chain(
        self,
        template_name: str,
        output_parser=None,
        llm=None
    ) -> Runnable:
        """Create a chain from registered template"""
        if template_name not in self.templates:
            raise ValueError(f"Unknown template: {template_name}")

        prompt = ChatPromptTemplate.from_template(self.templates[template_name])
        llm_to_use = llm or self.default_llm
        parser = output_parser or StrOutputParser()

        return prompt | llm_to_use | parser

    def create_with_middleware(
        self,
        template_name: str,
        pre_process: Callable = None,
        post_process: Callable = None
    ) -> Runnable:
        """Create chain with pre/post processing"""
        base_chain = self.create_chain(template_name)

        if pre_process:
            base_chain = RunnableLambda(pre_process) | base_chain

        if post_process:
            base_chain = base_chain | RunnableLambda(post_process)

        return base_chain

# Usage
factory = ChainFactory()
factory.register_template("qa", "Answer this question: {question}")
factory.register_template("summarize", "Summarize this text: {text}")

qa_chain = factory.create_chain("qa")
summary_chain = factory.create_chain("summarize")
```

### Pipeline Builder Pattern

```python
class LCELPipelineBuilder:
    """Builder for complex LCEL pipelines"""

    def __init__(self):
        self.steps = []

    def add_prompt(self, template: str, **kwargs):
        """Add prompt step"""
        prompt = ChatPromptTemplate.from_template(template)
        if kwargs:
            prompt = prompt.partial(**kwargs)
        self.steps.append(prompt)
        return self

    def add_llm(self, model: str = "gpt-3.5-turbo", **kwargs):
        """Add LLM step"""
        llm = ChatOpenAI(model=model, **kwargs)
        self.steps.append(llm)
        return self

    def add_parser(self, parser_type: str = "string"):
        """Add output parser"""
        if parser_type == "string":
            self.steps.append(StrOutputParser())
        elif parser_type == "json":
            from langchain_core.output_parsers import JsonOutputParser
            self.steps.append(JsonOutputParser())
        return self

    def add_custom(self, func: Callable):
        """Add custom function"""
        self.steps.append(RunnableLambda(func))
        return self

    def add_parallel(self, **named_chains):
        """Add parallel execution"""
        self.steps.append(RunnableParallel(**named_chains))
        return self

    def build(self) -> Runnable:
        """Build the pipeline"""
        if not self.steps:
            raise ValueError("Pipeline has no steps")

        pipeline = self.steps[0]
        for step in self.steps[1:]:
            pipeline = pipeline | step

        return pipeline

# Usage
pipeline = (LCELPipelineBuilder()
    .add_custom(lambda x: {"question": x["question"].strip()})
    .add_prompt("You are helpful. Answer: {question}")
    .add_llm("gpt-4", temperature=0.7)
    .add_parser("string")
    .add_custom(lambda x: {"answer": x, "processed_at": "now"})
    .build()
)

result = pipeline.invoke({"question": "What is LCEL?"})
```

### Decorator Pattern for Cross-Cutting Concerns

```python
import time
import logging
from functools import wraps

logger = logging.getLogger(__name__)

def with_logging(chain: Runnable) -> Runnable:
    """Add logging to chain"""
    def logged_invoke(input_dict: dict) -> Any:
        logger.info(f"Chain input: {input_dict}")
        start = time.time()
        result = chain.invoke(input_dict)
        duration = time.time() - start
        logger.info(f"Chain output: {result[:100]}... Duration: {duration:.2f}s")
        return result
    return RunnableLambda(logged_invoke)

def with_metrics(chain: Runnable, metrics_client) -> Runnable:
    """Add metrics collection"""
    def metered_invoke(input_dict: dict) -> Any:
        start = time.time()
        try:
            result = chain.invoke(input_dict)
            metrics_client.increment("chain.success")
            return result
        except Exception as e:
            metrics_client.increment("chain.error")
            raise
        finally:
            duration = time.time() - start
            metrics_client.timing("chain.duration", duration)
    return RunnableLambda(metered_invoke)

def with_timeout(chain: Runnable, timeout_seconds: float) -> Runnable:
    """Add timeout to chain"""
    import asyncio

    async def timed_invoke(input_dict: dict) -> Any:
        try:
            return await asyncio.wait_for(
                chain.ainvoke(input_dict),
                timeout=timeout_seconds
            )
        except asyncio.TimeoutError:
            raise TimeoutError(f"Chain timed out after {timeout_seconds}s")

    return RunnableLambda(lambda x: asyncio.run(timed_invoke(x)))

# Usage
base_chain = prompt | llm | StrOutputParser()
production_chain = with_logging(with_timeout(base_chain, 30))
```

## Testing Patterns

```python
import pytest
from unittest.mock import Mock, patch

class TestLCELChains:
    """Test patterns for LCEL chains"""

    def test_chain_output_format(self):
        """Test that chain produces expected output format"""
        # Mock the LLM
        mock_llm = Mock()
        mock_llm.invoke.return_value = Mock(content="Test answer")

        chain = prompt | mock_llm | StrOutputParser()
        result = chain.invoke({"question": "Test?"})

        assert isinstance(result, str)
        assert len(result) > 0

    def test_chain_with_mock_responses(self):
        """Test chain with predefined responses"""
        from langchain_community.llms.fake import FakeListLLM

        responses = ["Answer 1", "Answer 2", "Answer 3"]
        fake_llm = FakeListLLM(responses=responses)

        chain = prompt | fake_llm | StrOutputParser()

        # Each call returns next response
        assert "Answer 1" in chain.invoke({"question": "Q1"})
        assert "Answer 2" in chain.invoke({"question": "Q2"})

    def test_error_handling(self):
        """Test that errors are handled properly"""
        def failing_step(x):
            raise ValueError("Intentional failure")

        chain = RunnableLambda(failing_step)

        with pytest.raises(ValueError):
            chain.invoke({"input": "test"})
```

## Conclusion

These LCEL patterns provide the foundation for building production-grade LLM applications. By implementing proper error handling, caching, composition patterns, and testing strategies, you can create robust systems that handle real-world challenges effectively.

