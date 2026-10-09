---
title: "LangChain Expression Language (LCEL): A Practical Guide"
author: Michael John Peña
draft: false
date: 2023-10-01
description: "Understanding LangChain Expression Language for building composable LLM applications with clean, declarative syntax."
tags:
  - LangChain
  - LCEL
  - LLM
  - AI
  - Python
---

## Introduction

LangChain Expression Language (LCEL) is a declarative way to compose chains in LangChain. It provides a clean syntax for building complex LLM applications while enabling streaming, async operations, and parallel execution out of the box.

## LCEL Fundamentals

### Basic Syntax

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# Traditional approach
def traditional_chain(question: str) -> str:
    llm = ChatOpenAI()
    prompt = ChatPromptTemplate.from_template("Answer: {question}")
    messages = prompt.format_messages(question=question)
    response = llm.invoke(messages)
    return response.content

# LCEL approach - cleaner and more powerful
llm = ChatOpenAI()
prompt = ChatPromptTemplate.from_template("Answer: {question}")
output_parser = StrOutputParser()

# Compose with pipe operator
chain = prompt | llm | output_parser

# Invoke the chain
result = chain.invoke({"question": "What is LCEL?"})
print(result)
```

### Understanding the Pipe Operator

```python
from langchain_core.runnables import RunnableLambda, RunnablePassthrough

# The | operator creates a sequence of Runnables
# Each component must implement the Runnable interface

# Custom runnable function
def preprocess(input_dict: dict) -> dict:
    """Preprocess input before sending to LLM"""
    input_dict["question"] = input_dict["question"].strip().lower()
    return input_dict

def postprocess(output: str) -> str:
    """Postprocess LLM output"""
    return f"Answer: {output.strip()}"

# Convert functions to Runnables
preprocess_runnable = RunnableLambda(preprocess)
postprocess_runnable = RunnableLambda(postprocess)

# Build chain with preprocessing and postprocessing
chain = (
    preprocess_runnable
    | prompt
    | llm
    | StrOutputParser()
    | postprocess_runnable
)

result = chain.invoke({"question": "  What is LangChain?  "})
```

### RunnablePassthrough and RunnableParallel

```python
from langchain_core.runnables import RunnablePassthrough, RunnableParallel

# RunnablePassthrough passes input unchanged
# Useful for combining with other operations

# Example: Pass original question along with LLM response
chain = RunnableParallel(
    question=RunnablePassthrough(),
    answer=prompt | llm | StrOutputParser()
)

result = chain.invoke({"question": "What is Python?"})
# result = {"question": {"question": "What is Python?"}, "answer": "Python is..."}

# More practical example: RAG with context
retriever_prompt = ChatPromptTemplate.from_template("""
Answer the question based on the context:

Context: {context}
Question: {question}

Answer:
""")

def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)

rag_chain = (
    {
        "context": retriever | format_docs,
        "question": RunnablePassthrough()
    }
    | retriever_prompt
    | llm
    | StrOutputParser()
)
```

## Advanced LCEL Patterns

### Branching and Routing

```python
from langchain_core.runnables import RunnableBranch

# Route to different chains based on input
def classify_question(input_dict: dict) -> str:
    """Classify the type of question"""
    question = input_dict["question"].lower()
    if "code" in question or "programming" in question:
        return "technical"
    elif "weather" in question or "news" in question:
        return "current_events"
    else:
        return "general"

technical_prompt = ChatPromptTemplate.from_template(
    "You are a coding expert. Answer: {question}"
)
general_prompt = ChatPromptTemplate.from_template(
    "You are a helpful assistant. Answer: {question}"
)
current_prompt = ChatPromptTemplate.from_template(
    "Note: You don't have real-time data. Answer: {question}"
)

# Create branch based on classification
branch = RunnableBranch(
    (lambda x: classify_question(x) == "technical", technical_prompt | llm),
    (lambda x: classify_question(x) == "current_events", current_prompt | llm),
    general_prompt | llm  # Default
)

chain = branch | StrOutputParser()

# Technical question routes to technical prompt
result = chain.invoke({"question": "How do I write a Python function?"})
```

### Fallback Chains

```python
from langchain_core.runnables import RunnableWithFallbacks

# Create chains with fallback options
primary_llm = ChatOpenAI(model="gpt-4")
fallback_llm = ChatOpenAI(model="gpt-3.5-turbo")

# Chain with fallback
robust_chain = (
    prompt
    | primary_llm.with_fallbacks([fallback_llm])
    | StrOutputParser()
)

# If gpt-4 fails (rate limit, error), automatically try gpt-3.5-turbo
result = robust_chain.invoke({"question": "Complex question here"})
```

### Binding Parameters

```python
# Bind parameters to LLM for consistent behavior
llm_with_params = ChatOpenAI().bind(
    temperature=0.7,
    max_tokens=500,
    stop=["\n\n"]
)

# Bind tools/functions
from langchain_core.tools import tool

@tool
def get_weather(location: str) -> str:
    """Get weather for a location"""
    return f"Weather in {location}: Sunny, 72F"

llm_with_tools = ChatOpenAI().bind_tools([get_weather])

chain = prompt | llm_with_tools | StrOutputParser()
```

### Configurable Chains

```python
from langchain_core.runnables import ConfigurableField

# Make chain components configurable at runtime
configurable_llm = ChatOpenAI(temperature=0).configurable_fields(
    temperature=ConfigurableField(
        id="temperature",
        name="LLM Temperature",
        description="Controls randomness in responses"
    ),
    model=ConfigurableField(
        id="model",
        name="Model Name",
        description="The OpenAI model to use"
    )
)

chain = prompt | configurable_llm | StrOutputParser()

# Use with default config
result1 = chain.invoke({"question": "What is AI?"})

# Use with custom config
result2 = chain.with_config(
    configurable={"temperature": 0.9, "model": "gpt-4"}
).invoke({"question": "What is AI?"})
```

## Streaming and Async

### Streaming Responses

```python
# LCEL chains support streaming by default
chain = prompt | llm | StrOutputParser()

# Stream tokens as they're generated
for chunk in chain.stream({"question": "Tell me a story"}):
    print(chunk, end="", flush=True)

# Async streaming
async def stream_response(question: str):
    async for chunk in chain.astream({"question": question}):
        print(chunk, end="", flush=True)

# Run async
import asyncio
asyncio.run(stream_response("Tell me about LCEL"))
```

### Batch Processing

```python
# Process multiple inputs efficiently
questions = [
    {"question": "What is Python?"},
    {"question": "What is JavaScript?"},
    {"question": "What is Rust?"}
]

# Batch invoke (parallel by default)
results = chain.batch(questions)

# Control concurrency
results = chain.batch(questions, config={"max_concurrency": 2})

# Async batch
async def batch_async():
    results = await chain.abatch(questions)
    return results
```

### Event Streaming

```python
# Stream events for complex chains
async def stream_events():
    async for event in chain.astream_events(
        {"question": "Explain quantum computing"},
        version="v1"
    ):
        kind = event["event"]
        if kind == "on_chat_model_stream":
            print(event["data"]["chunk"].content, end="")
        elif kind == "on_chain_start":
            print(f"\nStarting: {event['name']}")
        elif kind == "on_chain_end":
            print(f"\nFinished: {event['name']}")
```

## Practical Example: Multi-Step Chain

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser, JsonOutputParser
from langchain_core.runnables import RunnableParallel, RunnableLambda

llm = ChatOpenAI(model="gpt-4")

# Step 1: Analyze the question
analyze_prompt = ChatPromptTemplate.from_template("""
Analyze this question and identify:
1. Main topic
2. Key concepts
3. Required expertise level

Question: {question}

Respond in JSON format with keys: topic, concepts (list), level
""")

# Step 2: Generate comprehensive answer
answer_prompt = ChatPromptTemplate.from_template("""
You are an expert in {topic}.
The question requires {level} level explanation.
Key concepts to cover: {concepts}

Question: {question}

Provide a comprehensive answer:
""")

# Step 3: Generate follow-up questions
followup_prompt = ChatPromptTemplate.from_template("""
Based on this Q&A, suggest 3 follow-up questions:

Question: {question}
Answer: {answer}

Follow-up questions:
""")

# Build the multi-step chain
def parse_analysis(analysis_output):
    import json
    try:
        return json.loads(analysis_output)
    except:
        return {"topic": "general", "concepts": [], "level": "intermediate"}

analysis_chain = analyze_prompt | llm | StrOutputParser() | RunnableLambda(parse_analysis)

def combine_for_answer(inputs):
    analysis = inputs["analysis"]
    return {
        "question": inputs["question"],
        "topic": analysis.get("topic", "general"),
        "concepts": ", ".join(analysis.get("concepts", [])),
        "level": analysis.get("level", "intermediate")
    }

full_chain = (
    RunnableParallel(
        question=RunnablePassthrough(),
        analysis=analysis_chain
    )
    | RunnableLambda(combine_for_answer)
    | answer_prompt
    | llm
    | StrOutputParser()
)

# Execute
result = full_chain.invoke({"question": "How do neural networks learn?"})
print(result)
```

## Conclusion

LangChain Expression Language provides a powerful, declarative way to build LLM applications. Its support for streaming, async operations, and composability makes it ideal for production applications. By mastering LCEL patterns like branching, fallbacks, and configurable chains, you can build robust and maintainable AI systems.
