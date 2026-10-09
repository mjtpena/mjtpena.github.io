---
title: "LangChain with Azure OpenAI: Building Production AI Applications"
author: Michael John Peña
draft: false
date: 2023-09-03
description: "Learn how to use LangChain with Azure OpenAI Service to build robust, production-ready AI applications."
tags:
  - Azure
  - OpenAI
  - LangChain
  - Python
  - AI
---

## Introduction

LangChain has become one of the most popular frameworks for building applications with large language models. Combined with Azure OpenAI Service's enterprise features, it provides a powerful foundation for production AI applications. This post covers how to effectively use LangChain with Azure OpenAI.

## Why LangChain with Azure OpenAI?

LangChain provides:
- **Abstractions** for common LLM patterns
- **Chains** for complex workflows
- **Memory** for conversational context
- **Agents** for autonomous decision-making
- **Tools** for extending LLM capabilities

Azure OpenAI provides:
- **Enterprise security** and compliance
- **Data privacy** guarantees
- **Regional deployment** options
- **SLA-backed** availability

Together, they enable sophisticated AI applications that meet enterprise requirements.

## Getting Started

### Installation

```bash
pip install langchain langchain-openai
```

### Basic Configuration

```python
import os
from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings

# Configure the LLM
llm = AzureChatOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    api_version="2023-07-01-preview",
    deployment_name="gpt-4",
    temperature=0.7,
    max_tokens=1000
)

# Configure embeddings
embeddings = AzureOpenAIEmbeddings(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    api_version="2023-07-01-preview",
    deployment="text-embedding-ada-002"
)

# Simple test
response = llm.invoke("What is Azure Synapse Analytics?")
print(response.content)
```

## Building Chains

### Simple LLM Chain

```python
from langchain.prompts import ChatPromptTemplate
from langchain.schema.output_parser import StrOutputParser

# Create a prompt template
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant that explains technical concepts simply."),
    ("user", "Explain {topic} in simple terms for someone new to cloud computing.")
])

# Create a chain
chain = prompt | llm | StrOutputParser()

# Run the chain
result = chain.invoke({"topic": "Azure Functions"})
print(result)
```

### Sequential Chains

```python
from langchain.prompts import PromptTemplate

# First chain: Generate summary
summary_prompt = PromptTemplate.from_template(
    "Summarize the following text in 3 bullet points:\n\n{text}"
)
summary_chain = summary_prompt | llm | StrOutputParser()

# Second chain: Generate action items
action_prompt = PromptTemplate.from_template(
    "Based on this summary, list actionable next steps:\n\n{summary}"
)
action_chain = action_prompt | llm | StrOutputParser()

# Combined chain using LCEL
def process_document(text: str) -> dict:
    summary = summary_chain.invoke({"text": text})
    actions = action_chain.invoke({"summary": summary})
    return {"summary": summary, "actions": actions}

# Usage
document = """
Our Q3 results show strong growth in cloud services, with Azure revenue up 29%.
However, we're seeing increased competition in the AI space. The team recommends
increasing investment in AI capabilities and improving developer experience.
"""

result = process_document(document)
print("Summary:", result["summary"])
print("\nActions:", result["actions"])
```

## Memory and Conversation

### Conversation with Memory

```python
from langchain.memory import ConversationBufferMemory, ConversationSummaryMemory
from langchain.chains import ConversationChain

# Basic conversation memory
memory = ConversationBufferMemory()

conversation = ConversationChain(
    llm=llm,
    memory=memory,
    verbose=True
)

# Multi-turn conversation
print(conversation.predict(input="Hi, I'm working on a data platform project."))
print(conversation.predict(input="We're considering using Spark for processing."))
print(conversation.predict(input="What storage format would you recommend?"))
```

### Token-Limited Memory

```python
from langchain.memory import ConversationTokenBufferMemory

# Memory that respects token limits
memory = ConversationTokenBufferMemory(
    llm=llm,
    max_token_limit=2000
)

conversation = ConversationChain(
    llm=llm,
    memory=memory
)

# Long conversations automatically trim old messages
for i in range(20):
    response = conversation.predict(input=f"Tell me about topic {i}")
    print(f"Response {i}: {response[:100]}...")
```

### Summary Memory for Long Conversations

```python
# Summarize old conversations to save tokens
summary_memory = ConversationSummaryMemory(llm=llm)

conversation = ConversationChain(
    llm=llm,
    memory=summary_memory
)

# Old conversations are summarized rather than stored verbatim
conversation.predict(input="Let's discuss Azure architecture patterns.")
conversation.predict(input="What about microservices?")
conversation.predict(input="How do they handle state?")

# Memory contains a summary, not full history
print(summary_memory.buffer)
```

## Retrieval-Augmented Generation (RAG)

### Building a RAG Pipeline

```python
from langchain.document_loaders import TextLoader, DirectoryLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.vectorstores import FAISS
from langchain.chains import RetrievalQA

# Load documents
loader = DirectoryLoader("./docs", glob="**/*.md", loader_cls=TextLoader)
documents = loader.load()

# Split into chunks
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", " ", ""]
)
splits = text_splitter.split_documents(documents)

# Create vector store
vectorstore = FAISS.from_documents(splits, embeddings)

# Create retrieval chain
qa_chain = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="stuff",  # For small result sets
    retriever=vectorstore.as_retriever(search_kwargs={"k": 5}),
    return_source_documents=True
)

# Query
result = qa_chain.invoke({"query": "How do I configure Azure Key Vault?"})
print("Answer:", result["result"])
print("\nSources:")
for doc in result["source_documents"]:
    print(f"  - {doc.metadata.get('source', 'Unknown')}")
```

### Custom RAG with Sources

```python
from langchain.prompts import PromptTemplate

# Custom prompt that includes sources
rag_prompt = PromptTemplate.from_template("""Answer the question based on the following context.
If you don't know the answer, say so. Always cite your sources.

Context:
{context}

Question: {question}

Answer (with citations):""")

class RAGWithSources:
    def __init__(self, llm, vectorstore):
        self.llm = llm
        self.vectorstore = vectorstore
        self.prompt = rag_prompt

    def query(self, question: str, k: int = 5) -> dict:
        # Retrieve relevant documents
        docs = self.vectorstore.similarity_search(question, k=k)

        # Build context with source markers
        context_parts = []
        for i, doc in enumerate(docs):
            source = doc.metadata.get("source", f"Document {i+1}")
            context_parts.append(f"[Source: {source}]\n{doc.page_content}")

        context = "\n\n".join(context_parts)

        # Generate answer
        chain = self.prompt | self.llm | StrOutputParser()
        answer = chain.invoke({"context": context, "question": question})

        return {
            "answer": answer,
            "sources": [doc.metadata.get("source") for doc in docs]
        }

# Usage
rag = RAGWithSources(llm, vectorstore)
result = rag.query("What are the best practices for Azure security?")
print(result["answer"])
```

## Building Agents

### Tool-Using Agent

```python
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain.tools import Tool, StructuredTool
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from pydantic import BaseModel, Field

# Define tools
def search_documentation(query: str) -> str:
    """Search the documentation for relevant information."""
    docs = vectorstore.similarity_search(query, k=3)
    return "\n\n".join([doc.page_content for doc in docs])

def get_current_date() -> str:
    """Get the current date."""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d")

class CalculatorInput(BaseModel):
    expression: str = Field(description="Mathematical expression to evaluate")

def calculator(expression: str) -> str:
    """Evaluate a mathematical expression."""
    try:
        result = eval(expression)
        return str(result)
    except Exception as e:
        return f"Error: {str(e)}"

tools = [
    Tool(
        name="search_docs",
        func=search_documentation,
        description="Search documentation for technical information"
    ),
    Tool(
        name="get_date",
        func=get_current_date,
        description="Get the current date"
    ),
    StructuredTool.from_function(
        func=calculator,
        name="calculator",
        description="Perform mathematical calculations",
        args_schema=CalculatorInput
    )
]

# Create agent
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant with access to tools. Use them when needed."),
    ("user", "{input}"),
    MessagesPlaceholder(variable_name="agent_scratchpad")
])

agent = create_openai_functions_agent(llm, tools, prompt)
agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# Run agent
result = agent_executor.invoke({
    "input": "What's today's date and can you search for information about Azure Functions triggers?"
})
print(result["output"])
```

## Production Patterns

### Error Handling and Retries

```python
from langchain.callbacks import get_openai_callback
from tenacity import retry, stop_after_attempt, wait_exponential

class RobustLLMClient:
    def __init__(self, llm):
        self.llm = llm

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=60)
    )
    def invoke_with_retry(self, prompt: str) -> str:
        """Invoke LLM with automatic retry on failure."""
        try:
            with get_openai_callback() as cb:
                response = self.llm.invoke(prompt)
                print(f"Tokens used: {cb.total_tokens}, Cost: ${cb.total_cost:.4f}")
                return response.content
        except Exception as e:
            print(f"Error: {e}, retrying...")
            raise

    def safe_invoke(self, prompt: str, fallback: str = "Unable to process request.") -> str:
        """Invoke with fallback on persistent failure."""
        try:
            return self.invoke_with_retry(prompt)
        except Exception as e:
            print(f"All retries failed: {e}")
            return fallback

# Usage
client = RobustLLMClient(llm)
response = client.safe_invoke("Explain Azure networking")
```

### Streaming Responses

```python
from langchain.callbacks.streaming_stdout import StreamingStdOutCallbackHandler

# Create streaming LLM
streaming_llm = AzureChatOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    api_version="2023-07-01-preview",
    deployment_name="gpt-4",
    streaming=True,
    callbacks=[StreamingStdOutCallbackHandler()]
)

# Stream response
streaming_llm.invoke("Write a detailed explanation of microservices architecture.")
```

### Cost Tracking

```python
from langchain.callbacks import get_openai_callback

class CostTracker:
    def __init__(self):
        self.total_tokens = 0
        self.total_cost = 0.0
        self.requests = 0

    def track(self, func):
        """Decorator to track LLM costs."""
        def wrapper(*args, **kwargs):
            with get_openai_callback() as cb:
                result = func(*args, **kwargs)
                self.total_tokens += cb.total_tokens
                self.total_cost += cb.total_cost
                self.requests += 1
                return result
        return wrapper

    def report(self) -> dict:
        return {
            "total_tokens": self.total_tokens,
            "total_cost": self.total_cost,
            "total_requests": self.requests,
            "avg_tokens_per_request": self.total_tokens / max(self.requests, 1)
        }

tracker = CostTracker()

@tracker.track
def analyze_text(text: str) -> str:
    return llm.invoke(f"Analyze: {text}").content

# Run some requests
analyze_text("Sample text 1")
analyze_text("Sample text 2")

# Check costs
print(tracker.report())
```

## Conclusion

LangChain combined with Azure OpenAI Service provides a powerful foundation for building production AI applications. The framework's abstractions for chains, memory, and agents, combined with Azure's enterprise features, enable sophisticated applications while maintaining security and compliance requirements.

Key takeaways:
- Use chains for structured workflows
- Implement memory for conversational context
- Leverage RAG for knowledge-grounded responses
- Build agents for autonomous task completion
- Always implement proper error handling and cost tracking

## Resources

- [LangChain Documentation](https://python.langchain.com/)
- [Azure OpenAI Service](https://azure.microsoft.com/products/cognitive-services/openai-service/)
- [LangChain Azure Integration](https://python.langchain.com/docs/integrations/llms/azure_openai)
