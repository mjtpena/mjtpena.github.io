---
title: "LangChain with Azure OpenAI: Getting Started"
author: Michael John Pena
draft: false
date: 2023-03-04
tags:
  - Azure
  - OpenAI
  - AI
  - LangChain
  - Python

---

I wrote "LangChain with Azure OpenAI: Getting Started" to share practical, production-minded guidance on this topic.

## Why LangChain?

LangChain provides abstractions for:
- Prompt templates and management
- Document loaders for various formats
- Vector stores and retrievers
- Chains for multi-step workflows
- Agents for dynamic tool use

Combined with Azure OpenAI's enterprise security and compliance, it's a powerful combination.

## Setting Up

```bash
pip install langchain openai tiktoken azure-identity
```

```python
import os
from langchain.chat_models import AzureChatOpenAI
from langchain.embeddings import AzureOpenAIEmbeddings

# Configure Azure OpenAI
os.environ["AZURE_OPENAI_API_KEY"] = "your-api-key"
os.environ["AZURE_OPENAI_ENDPOINT"] = "https://your-resource.openai.azure.com/"

# Initialize chat model
chat = AzureChatOpenAI(
    deployment_name="gpt-35-turbo",
    openai_api_version="2023-03-15-preview",
    temperature=0.3
)

# Initialize embeddings
embeddings = AzureOpenAIEmbeddings(
    deployment="text-embedding-ada-002",
    openai_api_version="2023-03-15-preview"
)
```

## Basic Chat

```python
from langchain.schema import HumanMessage, SystemMessage

messages = [
    SystemMessage(content="You are a helpful Azure architect."),
    HumanMessage(content="What's the best way to set up a data lake?")
]

response = chat(messages)
print(response.content)
```

## Prompt Templates

```python
from langchain.prompts import ChatPromptTemplate, HumanMessagePromptTemplate
from langchain.schema import SystemMessage

# Create reusable templates
sql_review_template = ChatPromptTemplate.from_messages([
    SystemMessage(content="""You are a SQL performance expert.
Review queries for:
- Index usage
- Query plan efficiency
- Potential deadlocks
- N+1 patterns"""),
    HumanMessagePromptTemplate.from_template("""
Database: {database_type}
Query:
```sql
{query}
```
Provide specific optimization recommendations.""")
])

# Use template
messages = sql_review_template.format_messages(
    database_type="Azure SQL Database",
    query="SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE region = 'APAC')"
)

response = chat(messages)
print(response.content)
```

## Document Loaders

LangChain has loaders for many formats:

```python
from langchain.document_loaders import (
    TextLoader,
    PDFLoader,
    UnstructuredMarkdownLoader,
    AzureBlobStorageContainerLoader
)
from langchain.text_splitter import RecursiveCharacterTextSplitter

# Load from Azure Blob Storage
loader = AzureBlobStorageContainerLoader(
    conn_str="your-connection-string",
    container="documents"
)
documents = loader.load()

# Split into chunks
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=100,
    separators=["\n\n", "\n", ". ", " ", ""]
)

chunks = text_splitter.split_documents(documents)
print(f"Split {len(documents)} documents into {len(chunks)} chunks")
```

## Vector Stores

Connect to various vector databases:

```python
from langchain.vectorstores import FAISS, AzureSearch

# Option 1: FAISS (in-memory/local)
vectorstore = FAISS.from_documents(chunks, embeddings)
vectorstore.save_local("faiss_index")

# Option 2: Azure Cognitive Search
from langchain.vectorstores import AzureSearch

vectorstore = AzureSearch(
    azure_search_endpoint="https://your-search.search.windows.net",
    azure_search_key="your-key",
    index_name="langchain-docs",
    embedding_function=embeddings.embed_query
)

# Add documents
vectorstore.add_documents(chunks)

# Search
results = vectorstore.similarity_search("How to configure ADF triggers?", k=3)
for doc in results:
    print(f"Source: {doc.metadata.get('source', 'Unknown')}")
    print(doc.page_content[:200])
    print("---")
```

## Building Chains

Chains combine multiple steps:

```python
from langchain.chains import LLMChain, SequentialChain

# Chain 1: Analyze requirements
analyze_chain = LLMChain(
    llm=chat,
    prompt=ChatPromptTemplate.from_template(
        "Analyze these requirements and identify key components:\n{requirements}"
    ),
    output_key="analysis"
)

# Chain 2: Generate architecture
architecture_chain = LLMChain(
    llm=chat,
    prompt=ChatPromptTemplate.from_template(
        "Based on this analysis, propose an Azure architecture:\n{analysis}"
    ),
    output_key="architecture"
)

# Chain 3: Estimate costs
cost_chain = LLMChain(
    llm=chat,
    prompt=ChatPromptTemplate.from_template(
        "Estimate monthly Azure costs for this architecture:\n{architecture}"
    ),
    output_key="cost_estimate"
)

# Combine into sequential chain
full_chain = SequentialChain(
    chains=[analyze_chain, architecture_chain, cost_chain],
    input_variables=["requirements"],
    output_variables=["analysis", "architecture", "cost_estimate"]
)

# Run
result = full_chain({
    "requirements": """
    - Real-time data ingestion from IoT devices
    - Process 1 million events per hour
    - Store 2 years of historical data
    - Dashboard for operations team
    - Alert on anomalies
    """
})

print("Architecture:", result["architecture"])
print("Cost Estimate:", result["cost_estimate"])
```

## Retrieval QA Chain

The most common RAG pattern:

```python
from langchain.chains import RetrievalQA

# Create retriever from vectorstore
retriever = vectorstore.as_retriever(
    search_type="similarity",
    search_kwargs={"k": 5}
)

# Build QA chain
qa_chain = RetrievalQA.from_chain_type(
    llm=chat,
    chain_type="stuff",  # stuff, map_reduce, refine
    retriever=retriever,
    return_source_documents=True
)

# Query
result = qa_chain({"query": "How do I set up incremental refresh in ADF?"})
print("Answer:", result["result"])
print("Sources:", [doc.metadata.get("source") for doc in result["source_documents"]])
```

## Custom Chain Types

For large document sets, use map_reduce:

```python
from langchain.chains.question_answering import load_qa_chain

# Map-reduce for large document sets
map_reduce_chain = load_qa_chain(
    llm=chat,
    chain_type="map_reduce",
    verbose=True
)

# Refine for iterative improvement
refine_chain = load_qa_chain(
    llm=chat,
    chain_type="refine",
    verbose=True
)
```

## Memory for Conversations

```python
from langchain.memory import ConversationBufferMemory, ConversationSummaryMemory
from langchain.chains import ConversationChain

# Buffer memory (stores all messages)
memory = ConversationBufferMemory()

# Or summary memory (summarizes older messages)
memory = ConversationSummaryMemory(llm=chat)

# Conversation chain with memory
conversation = ConversationChain(
    llm=chat,
    memory=memory,
    verbose=True
)

# Multi-turn conversation
response1 = conversation.predict(input="I'm building a data pipeline on Azure")
response2 = conversation.predict(input="Should I use ADF or Synapse Pipelines?")
response3 = conversation.predict(input="What about error handling?")

# Memory retains context
print(memory.load_memory_variables({}))
```

## Error Handling and Retries

```python
from langchain.llms import AzureOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

class RobustAzureChat:
    def __init__(self, chat_model):
        self.chat = chat_model

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=60)
    )
    def invoke(self, messages):
        try:
            return self.chat(messages)
        except Exception as e:
            print(f"Error: {e}, retrying...")
            raise

robust_chat = RobustAzureChat(chat)
```

## Best Practices

1. **Use environment variables** for secrets
2. **Implement caching** for repeated queries
3. **Monitor token usage** to control costs
4. **Set appropriate timeouts**
5. **Use streaming** for better UX in chat applications

```python
# Streaming example
from langchain.callbacks.streaming_stdout import StreamingStdOutCallbackHandler

streaming_chat = AzureChatOpenAI(
    deployment_name="gpt-35-turbo",
    openai_api_version="2023-03-15-preview",
    streaming=True,
    callbacks=[StreamingStdOutCallbackHandler()]
)

# Response streams to stdout as it generates
streaming_chat([HumanMessage(content="Explain Azure Event Hubs")])
```

LangChain abstracts away much of the complexity of building LLM applications. Combined with Azure OpenAI's enterprise features, you get the best of both worlds.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
