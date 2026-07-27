---
title: "Chain Composition in LangChain: Building Complex Workflows"
author: Michael John Peña
draft: false
date: 2023-10-04
description: "Learn advanced techniques for composing LangChain chains into complex, multi-step LLM workflows."
tags:
  - LangChain
  - Chain Composition
  - LLM
  - Workflows
  - AI
---

Chain composition in LangChain has evolved significantly with LCEL, but the fundamental challenge it solves — building complex, multi-step LLM workflows that are readable and maintainable — predates the expression language. The composition primitives I use most in production: sequential chains for straightforward pipeline flows (retrieve → augment → generate → parse), map-reduce patterns for processing multiple documents independently and then synthesising results, and refine patterns for iteratively improving an answer as more context becomes available. The question that determines which pattern fits: does the workflow have a fixed structure (sequential, parallel), or does it branch based on intermediate results? Fixed structures are clean in LCEL; conditional branching needs explicit routing logic that can make chains harder to follow.

## Introduction

Complex LLM applications often require multiple processing steps, conditional logic, and parallel execution. This post explores advanced chain composition techniques for building sophisticated workflows.

## Sequential Composition

### Basic Sequential Chains

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough

llm = ChatOpenAI(model="gpt-4")

# Step 1: Generate outline
outline_prompt = ChatPromptTemplate.from_template("""
Create an outline for an article about: {topic}

Outline (numbered list):
""")

# Step 2: Expand each section
expand_prompt = ChatPromptTemplate.from_template("""
Given this outline:
{outline}

Write detailed content for each section. Topic: {topic}
""")

# Step 3: Add introduction and conclusion
finalize_prompt = ChatPromptTemplate.from_template("""
Given this content:
{content}

Add a compelling introduction and conclusion for an article about {topic}.
""")

# Compose sequentially
article_chain = (
    RunnablePassthrough.assign(
        outline=outline_prompt | llm | StrOutputParser()
    )
    | RunnablePassthrough.assign(
        content=expand_prompt | llm | StrOutputParser()
    )
    | finalize_prompt
    | llm
    | StrOutputParser()
)

article = article_chain.invoke({"topic": "Machine Learning in Healthcare"})
```

### Data Transformation Between Steps

```python
from langchain_core.runnables import RunnableLambda

def extract_key_points(text: str) -> list:
    """Extract key points from text"""
    lines = text.split('\n')
    return [line.strip() for line in lines if line.strip().startswith(('-', '*', '1', '2', '3'))]

def format_as_questions(points: list) -> str:
    """Convert points to questions"""
    questions = []
    for point in points:
        # Remove bullet/number prefix
        clean = point.lstrip('-*0123456789. ')
        questions.append(f"Can you explain: {clean}?")
    return '\n'.join(questions)

# Chain with transformations
research_chain = (
    {"topic": RunnablePassthrough()}
    | ChatPromptTemplate.from_template("List 5 key aspects of {topic}")
    | llm
    | StrOutputParser()
    | RunnableLambda(extract_key_points)
    | RunnableLambda(format_as_questions)
)

questions = research_chain.invoke("quantum computing")
```

## Parallel Composition

### Independent Parallel Execution

```python
from langchain_core.runnables import RunnableParallel

# Define independent analysis chains
sentiment_chain = (
    ChatPromptTemplate.from_template("Analyze sentiment of: {text}\nSentiment (positive/negative/neutral):")
    | llm
    | StrOutputParser()
)

entity_chain = (
    ChatPromptTemplate.from_template("Extract named entities from: {text}\nEntities:")
    | llm
    | StrOutputParser()
)

keyword_chain = (
    ChatPromptTemplate.from_template("Extract keywords from: {text}\nKeywords:")
    | llm
    | StrOutputParser()
)

summary_chain = (
    ChatPromptTemplate.from_template("Summarize in one sentence: {text}\nSummary:")
    | llm
    | StrOutputParser()
)

# Execute all in parallel
analysis_chain = RunnableParallel(
    sentiment=sentiment_chain,
    entities=entity_chain,
    keywords=keyword_chain,
    summary=summary_chain
)

result = analysis_chain.invoke({
    "text": "Apple announced a new iPhone model today in Cupertino, California."
})
# Returns: {"sentiment": "...", "entities": "...", "keywords": "...", "summary": "..."}
```

### Parallel with Shared Context

```python
from langchain_core.runnables import RunnablePassthrough

# Generate context once, use in parallel
context_prompt = ChatPromptTemplate.from_template("""
Analyze this business context:
Industry: {industry}
Company: {company}

Provide key factors for analysis:
""")

# Different analysis perspectives
financial_prompt = ChatPromptTemplate.from_template("""
Context: {context}
Provide financial analysis perspective:
""")

operational_prompt = ChatPromptTemplate.from_template("""
Context: {context}
Provide operational analysis perspective:
""")

strategic_prompt = ChatPromptTemplate.from_template("""
Context: {context}
Provide strategic analysis perspective:
""")

# Build chain
multi_analysis = (
    # First, generate shared context
    RunnablePassthrough.assign(
        context=context_prompt | llm | StrOutputParser()
    )
    # Then run analyses in parallel using shared context
    | RunnableParallel(
        financial=financial_prompt | llm | StrOutputParser(),
        operational=operational_prompt | llm | StrOutputParser(),
        strategic=strategic_prompt | llm | StrOutputParser()
    )
)

result = multi_analysis.invoke({
    "industry": "Technology",
    "company": "StartupX"
})
```

## Conditional Composition

### Branch Based on Input

```python
from langchain_core.runnables import RunnableBranch

def classify_request(input_dict: dict) -> str:
    """Classify the type of user request"""
    text = input_dict.get("request", "").lower()
    if any(word in text for word in ["code", "function", "program", "script"]):
        return "code"
    elif any(word in text for word in ["explain", "what is", "how does"]):
        return "explain"
    elif any(word in text for word in ["write", "create", "draft"]):
        return "create"
    return "general"

# Different chains for different request types
code_chain = (
    ChatPromptTemplate.from_template(
        "You are a coding expert. Write code for: {request}"
    )
    | llm
    | StrOutputParser()
)

explain_chain = (
    ChatPromptTemplate.from_template(
        "You are a teacher. Explain clearly: {request}"
    )
    | llm
    | StrOutputParser()
)

create_chain = (
    ChatPromptTemplate.from_template(
        "You are a creative writer. Create: {request}"
    )
    | llm
    | StrOutputParser()
)

general_chain = (
    ChatPromptTemplate.from_template(
        "You are a helpful assistant. Help with: {request}"
    )
    | llm
    | StrOutputParser()
)

# Branch based on classification
routed_chain = RunnableBranch(
    (lambda x: classify_request(x) == "code", code_chain),
    (lambda x: classify_request(x) == "explain", explain_chain),
    (lambda x: classify_request(x) == "create", create_chain),
    general_chain  # Default
)

# Test
code_result = routed_chain.invoke({"request": "Write a Python function to sort a list"})
explain_result = routed_chain.invoke({"request": "Explain how neural networks learn"})
```

### Dynamic Chain Selection

```python
class ChainRouter:
    """Dynamically route to different chains based on analysis"""

    def __init__(self):
        self.chains = {}
        self.classifier = self._build_classifier()

    def _build_classifier(self):
        return (
            ChatPromptTemplate.from_template("""
            Classify this request into one category:
            - technical: coding, debugging, technical questions
            - creative: writing, stories, content creation
            - analytical: data analysis, comparisons, evaluations
            - conversational: general chat, opinions, advice

            Request: {request}
            Category (one word):
            """)
            | llm
            | StrOutputParser()
            | RunnableLambda(lambda x: x.strip().lower())
        )

    def register_chain(self, category: str, chain):
        self.chains[category] = chain

    def route(self, input_dict: dict):
        category = self.classifier.invoke(input_dict)
        chain = self.chains.get(category, self.chains.get("default"))
        if chain:
            return chain.invoke(input_dict)
        raise ValueError(f"No chain for category: {category}")

# Usage
router = ChainRouter()
router.register_chain("technical", code_chain)
router.register_chain("creative", create_chain)
router.register_chain("analytical", analysis_chain)
router.register_chain("default", general_chain)

result = router.route({"request": "Analyze the pros and cons of microservices"})
```

## Recursive Composition

### Self-Improving Chain

```python
def create_iterative_improvement_chain(max_iterations: int = 3):
    """Chain that iteratively improves its output"""

    improve_prompt = ChatPromptTemplate.from_template("""
    Original request: {request}

    Current output:
    {current_output}

    Critique this output and provide an improved version.
    If the output is already excellent, respond with "FINAL: " followed by the output.
    Otherwise, provide the improved version.
    """)

    def iterative_improve(input_dict: dict) -> str:
        current = input_dict.get("current_output", "")

        # Initial generation if no current output
        if not current:
            initial_chain = (
                ChatPromptTemplate.from_template("Respond to: {request}")
                | llm
                | StrOutputParser()
            )
            current = initial_chain.invoke(input_dict)

        # Iterative improvement
        for i in range(max_iterations):
            result = (improve_prompt | llm | StrOutputParser()).invoke({
                "request": input_dict["request"],
                "current_output": current
            })

            if result.startswith("FINAL:"):
                return result[6:].strip()

            current = result

        return current

    return RunnableLambda(iterative_improve)

# Usage
improving_chain = create_iterative_improvement_chain(max_iterations=3)
result = improving_chain.invoke({"request": "Write a professional email declining a meeting"})
```

## Map-Reduce Composition

```python
from langchain_core.runnables import RunnableParallel

def create_map_reduce_chain():
    """Process multiple items and combine results"""

    # Map: Process each chunk
    map_chain = (
        ChatPromptTemplate.from_template("Summarize this section:\n{chunk}")
        | llm
        | StrOutputParser()
    )

    # Reduce: Combine summaries
    reduce_chain = (
        ChatPromptTemplate.from_template("""
        Combine these summaries into one coherent summary:

        {summaries}

        Combined summary:
        """)
        | llm
        | StrOutputParser()
    )

    def map_reduce(input_dict: dict) -> str:
        chunks = input_dict["chunks"]

        # Map phase - process each chunk
        summaries = []
        for chunk in chunks:
            summary = map_chain.invoke({"chunk": chunk})
            summaries.append(summary)

        # Reduce phase - combine summaries
        combined = reduce_chain.invoke({
            "summaries": "\n\n".join(f"- {s}" for s in summaries)
        })

        return combined

    return RunnableLambda(map_reduce)

# Usage
map_reduce = create_map_reduce_chain()
result = map_reduce.invoke({
    "chunks": [
        "First section of a long document...",
        "Second section continues...",
        "Third and final section..."
    ]
})
```

## Conclusion

Chain composition in LangChain enables building sophisticated LLM workflows. By combining sequential, parallel, conditional, and recursive patterns, you can create applications that handle complex multi-step reasoning, parallel analysis, and dynamic routing based on input characteristics.
