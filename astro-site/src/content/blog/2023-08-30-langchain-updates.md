---
title: "LangChain Updates: New Features and Improvements"
description: "LangChain's velocity in 2023 has been remarkable and occasionally destabilising — the 0.0.x series has introduced breaking API changes in point releases…"
author: Michael John Peña
draft: false
date: 2023-08-30
tags:
  - LangChain
  - LLM
  - Framework
  - Python
---

LangChain's velocity in 2023 has been remarkable and occasionally destabilising — the 0.0.x series has introduced breaking API changes in point releases several times, so pinning versions in production applications is not optional. In August, the library is at approximately 0.0.27x and the interface has stabilised more than earlier in the year, but the community is still discovering which abstractions hold up under production load and which ones were premature. The key additions over the past few months: improved memory implementations (ConversationSummaryBufferMemory is genuinely useful for the summarisation patterns I described this week), better async support throughout the chain execution model, and the nascent LangChain Expression Language (LCEL) which provides a composable chain syntax using Python's `|` operator. LCEL is the future direction and worth learning even though many examples still use the legacy chain classes.

## LangChain Expression Language (LCEL)

```python
from langchain.chat_models import AzureChatOpenAI
from langchain.prompts import ChatPromptTemplate
from langchain.schema.output_parser import StrOutputParser

# New LCEL syntax for chaining
prompt = ChatPromptTemplate.from_template(
    "Tell me a {adjective} joke about {topic}"
)

model = AzureChatOpenAI(
    deployment_name="gpt-4",
    temperature=0.7
)

# Chain using pipe operator
chain = prompt | model | StrOutputParser()

# Invoke the chain
result = chain.invoke({
    "adjective": "funny",
    "topic": "programming"
})
print(result)
```

## Streaming with LCEL

```python
from langchain.callbacks.streaming_stdout import StreamingStdOutCallbackHandler

# Streaming chain
streaming_model = AzureChatOpenAI(
    deployment_name="gpt-4",
    streaming=True,
    callbacks=[StreamingStdOutCallbackHandler()]
)

chain = prompt | streaming_model | StrOutputParser()

# Stream responses
async for chunk in chain.astream({"adjective": "short", "topic": "AI"}):
    print(chunk, end="", flush=True)
```

## Runnable Interface

```python
from langchain.schema.runnable import RunnablePassthrough, RunnableLambda, RunnableParallel

# Passthrough for preserving input
def get_question(input_dict):
    return input_dict["question"]

def get_context(input_dict):
    return input_dict["context"]

# Parallel execution
parallel_chain = RunnableParallel(
    question=RunnableLambda(get_question),
    context=RunnableLambda(get_context),
    original=RunnablePassthrough()
)

# Complex chain with parallel branches
rag_prompt = ChatPromptTemplate.from_template("""
Answer based on context:
Context: {context}
Question: {question}
""")

rag_chain = (
    parallel_chain
    | rag_prompt
    | model
    | StrOutputParser()
)
```

## Improved Memory Management

```python
from langchain.memory import ConversationBufferWindowMemory
from langchain.chains import ConversationChain

# Window-based memory
memory = ConversationBufferWindowMemory(
    k=5,  # Keep last 5 exchanges
    return_messages=True,
    memory_key="history"
)

# Conversation chain with memory
conversation = ConversationChain(
    llm=model,
    memory=memory,
    verbose=True
)

# Chat
response1 = conversation.predict(input="My name is Michael")
response2 = conversation.predict(input="What's my name?")
```

## New Document Loaders

```python
from langchain.document_loaders import (
    AzureBlobStorageContainerLoader,
    AzureAIDocumentIntelligenceLoader,
    UnstructuredExcelLoader
)

# Azure Blob Storage loader
blob_loader = AzureBlobStorageContainerLoader(
    conn_str="your-connection-string",
    container="documents"
)
docs = blob_loader.load()

# Azure Document Intelligence for complex documents
doc_intel_loader = AzureAIDocumentIntelligenceLoader(
    api_endpoint="https://your-resource.cognitiveservices.azure.com/",
    api_key="your-key",
    file_path="complex-document.pdf",
    api_model="prebuilt-layout"
)
structured_docs = doc_intel_loader.load()

# Excel loader
excel_loader = UnstructuredExcelLoader("data.xlsx", mode="elements")
excel_docs = excel_loader.load()
```

## Enhanced Text Splitters

```python
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
    TokenTextSplitter,
    MarkdownHeaderTextSplitter
)

# Recursive splitter with better defaults
recursive_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    length_function=len,
    separators=["\n\n", "\n", ". ", " ", ""]
)

# Token-based splitting
token_splitter = TokenTextSplitter(
    encoding_name="cl100k_base",
    chunk_size=500,
    chunk_overlap=50
)

# Markdown-aware splitting
md_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[
        ("#", "Header 1"),
        ("##", "Header 2"),
        ("###", "Header 3"),
    ]
)

# Split markdown while preserving structure
md_docs = md_splitter.split_text(markdown_content)
```

## Callbacks and Tracing

```python
from langchain.callbacks import get_openai_callback
from langchain.callbacks.tracers import LangChainTracer

# Track token usage and cost
with get_openai_callback() as cb:
    result = chain.invoke({"topic": "AI"})
    print(f"Total Tokens: {cb.total_tokens}")
    print(f"Prompt Tokens: {cb.prompt_tokens}")
    print(f"Completion Tokens: {cb.completion_tokens}")
    print(f"Total Cost: ${cb.total_cost:.4f}")

# LangSmith tracing
tracer = LangChainTracer(project_name="my-project")
chain_with_tracing = chain.with_config(callbacks=[tracer])
```

## Caching Improvements

```python
from langchain.cache import RedisCache, SQLiteCache
from langchain.globals import set_llm_cache
import redis

# Redis caching
redis_client = redis.Redis.from_url("redis://localhost:6379")
set_llm_cache(RedisCache(redis_client))

# SQLite caching for development
set_llm_cache(SQLiteCache(database_path=".langchain.db"))

# Semantic caching
from langchain.cache import RedisSemanticCache
from langchain.embeddings import AzureOpenAIEmbeddings

embeddings = AzureOpenAIEmbeddings(deployment="text-embedding-ada-002")
set_llm_cache(RedisSemanticCache(
    redis_url="redis://localhost:6379",
    embedding=embeddings,
    score_threshold=0.95
))
```

## Output Parsers

```python
from langchain.output_parsers import (
    PydanticOutputParser,
    OutputFixingParser,
    RetryWithErrorOutputParser
)
from pydantic import BaseModel, Field

class ProductReview(BaseModel):
    sentiment: str = Field(description="positive, negative, or neutral")
    score: float = Field(description="sentiment score from 0 to 1")
    key_points: list[str] = Field(description="main points from the review")

# Pydantic parser
parser = PydanticOutputParser(pydantic_object=ProductReview)

# Auto-fixing parser
fixing_parser = OutputFixingParser.from_llm(parser=parser, llm=model)

# Retry parser for complex outputs
retry_parser = RetryWithErrorOutputParser.from_llm(
    parser=parser,
    llm=model,
    max_retries=3
)

# Use in chain
review_prompt = ChatPromptTemplate.from_template("""
Analyze this product review:
{review}

{format_instructions}
""")

review_chain = (
    review_prompt.partial(format_instructions=parser.get_format_instructions())
    | model
    | fixing_parser
)
```

## Agents with Tools

```python
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain.tools import Tool, StructuredTool
from langchain import hub

# Define custom tools
def search_database(query: str) -> str:
    """Search the product database."""
    return f"Found 5 products matching: {query}"

def calculate_price(product_id: str, quantity: int) -> str:
    """Calculate total price for a product."""
    return f"Total price for {quantity}x {product_id}: $99.99"

# Create tools
tools = [
    Tool(
        name="search_database",
        func=search_database,
        description="Search for products in the database"
    ),
    StructuredTool.from_function(
        func=calculate_price,
        name="calculate_price",
        description="Calculate total price for products"
    )
]

# Create agent
prompt = hub.pull("hwchase17/openai-functions-agent")
agent = create_openai_functions_agent(model, tools, prompt)

# Create executor
agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=True,
    max_iterations=5
)

# Run agent
result = agent_executor.invoke({
    "input": "Find laptops and calculate price for 3 units"
})
```

## Migration Guide

```python
# Old style (deprecated)
from langchain.llms import AzureOpenAI
from langchain.chains import LLMChain

old_chain = LLMChain(llm=llm, prompt=prompt)
result = old_chain.run(topic="AI")

# New style (LCEL)
from langchain.chat_models import AzureChatOpenAI

new_chain = prompt | model | StrOutputParser()
result = new_chain.invoke({"topic": "AI"})

# Batch processing
results = new_chain.batch([
    {"topic": "AI"},
    {"topic": "ML"},
    {"topic": "Data"}
])

# Async processing
result = await new_chain.ainvoke({"topic": "AI"})
```

Tomorrow we'll explore vector store integrations and best practices.

## Resources

- [LangChain Documentation](https://python.langchain.com/docs/)
- [LCEL Guide](https://python.langchain.com/docs/expression_language/)
- [LangSmith](https://smith.langchain.com/)
