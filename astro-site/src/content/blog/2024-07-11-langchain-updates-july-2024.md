---
title: "LangChain Updates: What's New in July 2024"
author: Michael John Peña
draft: false
date: 2024-07-11
tags:
  - AI
  - LangChain
  - Python
  - LLM
  - Framework

---

I wrote "LangChain Updates: What's New in July 2024" to share practical, production-minded guidance on this topic.

## Key Changes

**LangChain 0.2.x Stability**

The 0.2 release line has stabilized, bringing cleaner abstractions and better separation of concerns. The key changes:

- `langchain-core`: Minimal dependencies, core abstractions
- `langchain`: Main package with chains and agents
- `langchain-community`: Third-party integrations
- Provider-specific packages: `langchain-openai`, `langchain-anthropic`, etc.

```python
# Clean imports in 0.2.x
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_openai import AzureChatOpenAI

# Build a simple chain
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant."),
    ("human", "{input}")
])

llm = AzureChatOpenAI(
    azure_deployment="gpt-4o",
    api_version="2024-05-01-preview"
)

chain = prompt | llm | StrOutputParser()

response = chain.invoke({"input": "Explain Azure Data Factory"})
```

**LCEL (LangChain Expression Language) Maturity**

LCEL is now the recommended way to compose chains:

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough, RunnableParallel
from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings
from langchain_community.vectorstores import AzureSearch

# RAG chain with LCEL
embeddings = AzureOpenAIEmbeddings(
    azure_deployment="text-embedding-3-small"
)

vectorstore = AzureSearch(
    azure_search_endpoint="https://search.search.windows.net",
    azure_search_key="your-key",
    index_name="documents",
    embedding_function=embeddings.embed_query
)

retriever = vectorstore.as_retriever(search_kwargs={"k": 5})

prompt = ChatPromptTemplate.from_template("""
Answer based on the following context:

Context: {context}

Question: {question}

Answer:
""")

llm = AzureChatOpenAI(azure_deployment="gpt-4o")

# Compose the chain
chain = (
    RunnableParallel(
        context=retriever | format_docs,
        question=RunnablePassthrough()
    )
    | prompt
    | llm
    | StrOutputParser()
)

def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)

# Use the chain
answer = chain.invoke("What is the data retention policy?")
```

## New Azure Integrations

**Azure AI Search Vector Store**

Improved integration with Azure AI Search:

```python
from langchain_community.vectorstores.azuresearch import AzureSearch
from langchain_openai import AzureOpenAIEmbeddings

embeddings = AzureOpenAIEmbeddings(
    azure_deployment="text-embedding-3-small",
    api_version="2024-05-01-preview"
)

# Create vector store with hybrid search
vector_store = AzureSearch(
    azure_search_endpoint="https://your-search.search.windows.net",
    azure_search_key="your-key",
    index_name="langchain-demo",
    embedding_function=embeddings.embed_query,
    search_type="hybrid",  # New: hybrid search support
    semantic_configuration_name="my-semantic-config"
)

# Add documents
documents = [
    {"content": "Azure Data Factory is a cloud ETL service...", "metadata": {"source": "docs"}},
    {"content": "Azure Synapse Analytics combines big data...", "metadata": {"source": "docs"}},
]

vector_store.add_texts(
    texts=[d["content"] for d in documents],
    metadatas=[d["metadata"] for d in documents]
)

# Search with filters
results = vector_store.similarity_search(
    "ETL service",
    k=5,
    filters="source eq 'docs'"
)
```

**Azure Cosmos DB Vector Store**

New Cosmos DB vector search integration:

```python
from langchain_community.vectorstores import AzureCosmosDBVectorSearch
from langchain_openai import AzureOpenAIEmbeddings

embeddings = AzureOpenAIEmbeddings(azure_deployment="text-embedding-3-small")

# Connect to Cosmos DB with vector search
vector_store = AzureCosmosDBVectorSearch.from_connection_string(
    connection_string="your-cosmos-connection-string",
    namespace="database.collection",
    embedding=embeddings,
    index_name="vector_index"
)

# Use as retriever
retriever = vector_store.as_retriever(
    search_type="similarity_score_threshold",
    search_kwargs={"score_threshold": 0.7}
)
```

## Improved Callbacks and Tracing

Better observability with callbacks:

```python
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from datetime import datetime
import json

class AzureMonitorCallback(BaseCallbackHandler):
    def __init__(self, connection_string: str):
        from opencensus.ext.azure.log_exporter import AzureLogHandler
        import logging

        self.logger = logging.getLogger(__name__)
        self.logger.addHandler(AzureLogHandler(connection_string=connection_string))

    def on_llm_start(self, serialized, prompts, **kwargs):
        self.start_time = datetime.utcnow()
        self.logger.info(f"LLM Start: {serialized.get('name', 'unknown')}")

    def on_llm_end(self, response: LLMResult, **kwargs):
        duration = (datetime.utcnow() - self.start_time).total_seconds()

        # Log to Azure Monitor
        self.logger.info(json.dumps({
            "event": "llm_completion",
            "duration_seconds": duration,
            "token_usage": response.llm_output.get("token_usage", {}),
            "model": response.llm_output.get("model_name", "unknown")
        }))

    def on_llm_error(self, error, **kwargs):
        self.logger.error(f"LLM Error: {str(error)}")

# Use with chains
callback = AzureMonitorCallback(connection_string="your-connection-string")

chain = prompt | llm | StrOutputParser()
response = chain.invoke(
    {"input": "Explain Fabric"},
    config={"callbacks": [callback]}
)
```

## Structured Output

New structured output support for reliable parsing:

```python
from langchain_core.pydantic_v1 import BaseModel, Field
from langchain_openai import AzureChatOpenAI

class DataPipelineAnalysis(BaseModel):
    """Analysis of a data pipeline."""
    name: str = Field(description="Pipeline name")
    source_systems: list[str] = Field(description="Data source systems")
    target_systems: list[str] = Field(description="Data target systems")
    estimated_daily_volume_gb: float = Field(description="Estimated daily data volume in GB")
    complexity: str = Field(description="low, medium, or high")
    risks: list[str] = Field(description="Identified risks")
    recommendations: list[str] = Field(description="Improvement recommendations")

llm = AzureChatOpenAI(azure_deployment="gpt-4o")

# Create structured output chain
structured_llm = llm.with_structured_output(DataPipelineAnalysis)

prompt = ChatPromptTemplate.from_template("""
Analyze this data pipeline description and provide structured analysis:

{pipeline_description}
""")

chain = prompt | structured_llm

# Get structured response
analysis = chain.invoke({
    "pipeline_description": """
    Our sales pipeline extracts data from Salesforce and SAP,
    transforms it using Azure Data Factory, and loads into
    Azure Synapse. We process about 50GB daily with hourly
    incremental updates.
    """
})

print(f"Pipeline: {analysis.name}")
print(f"Complexity: {analysis.complexity}")
print(f"Risks: {analysis.risks}")
```

## Document Loaders Update

New and improved document loaders:

```python
from langchain_community.document_loaders import (
    AzureBlobStorageContainerLoader,
    AzureBlobStorageFileLoader,
    SharePointLoader
)

# Load from Azure Blob Storage
blob_loader = AzureBlobStorageContainerLoader(
    conn_str="your-connection-string",
    container="documents",
    prefix="reports/"
)
documents = blob_loader.load()

# Load from SharePoint (new)
sharepoint_loader = SharePointLoader(
    document_library_id="your-library-id",
    folder_path="/Reports/2024",
    auth_with_token=True
)
sp_documents = sharepoint_loader.load()

# Process documents
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", " ", ""]
)

chunks = splitter.split_documents(documents)
```

## Agent Improvements

Enhanced agent capabilities:

```python
from langchain.agents import create_openai_tools_agent, AgentExecutor
from langchain_core.tools import tool
from langchain_openai import AzureChatOpenAI

@tool
def query_azure_sql(query: str) -> str:
    """Execute a query against Azure SQL Database."""
    import pyodbc

    conn = pyodbc.connect("your-connection-string")
    cursor = conn.cursor()
    cursor.execute(query)
    results = cursor.fetchall()
    conn.close()

    return str(results)

@tool
def get_fabric_capacity_metrics(workspace_name: str) -> str:
    """Get capacity utilization metrics for a Fabric workspace."""
    # Implementation would call Fabric APIs
    return f"Capacity metrics for {workspace_name}: 65% utilized"

@tool
def create_data_pipeline(spec: str) -> str:
    """Create a new data pipeline based on specification."""
    # Implementation would call ADF/Fabric APIs
    return f"Pipeline created based on spec: {spec[:50]}..."

# Create agent
llm = AzureChatOpenAI(azure_deployment="gpt-4o")
tools = [query_azure_sql, get_fabric_capacity_metrics, create_data_pipeline]

prompt = ChatPromptTemplate.from_messages([
    ("system", """You are a data engineering assistant with access to Azure tools.
    Help users query data, monitor capacity, and create pipelines."""),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}")
])

agent = create_openai_tools_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# Run agent
result = executor.invoke({
    "input": "What's the current capacity utilization of the Analytics workspace?"
})
```

## Memory Patterns

Updated memory implementations:

```python
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_core.messages import HumanMessage, AIMessage
from langchain_community.chat_message_histories import RedisChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

# Redis-backed chat history
def get_session_history(session_id: str) -> BaseChatMessageHistory:
    return RedisChatMessageHistory(
        session_id=session_id,
        url="redis://localhost:6379"
    )

# Chain with memory
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful data assistant."),
    ("placeholder", "{history}"),
    ("human", "{input}")
])

llm = AzureChatOpenAI(azure_deployment="gpt-4o")
chain = prompt | llm | StrOutputParser()

# Wrap with message history
chain_with_history = RunnableWithMessageHistory(
    chain,
    get_session_history,
    input_messages_key="input",
    history_messages_key="history"
)

# Use with session
response = chain_with_history.invoke(
    {"input": "What tables are in our data warehouse?"},
    config={"configurable": {"session_id": "user123"}}
)

# Subsequent calls remember context
response2 = chain_with_history.invoke(
    {"input": "Which one has the most rows?"},
    config={"configurable": {"session_id": "user123"}}
)
```

## Migration Guide

If upgrading from 0.1.x:

```python
# Old way (0.1.x)
from langchain.chat_models import AzureChatOpenAI
from langchain.embeddings import AzureOpenAIEmbeddings
from langchain.vectorstores import AzureSearch

# New way (0.2.x)
from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings
from langchain_community.vectorstores import AzureSearch

# Old chain syntax
from langchain.chains import LLMChain
chain = LLMChain(llm=llm, prompt=prompt)
result = chain.run(input="...")

# New LCEL syntax
chain = prompt | llm | StrOutputParser()
result = chain.invoke({"input": "..."})
```

## Best Practices

1. **Use provider-specific packages**: Better maintenance and features
2. **Adopt LCEL**: More composable and debuggable chains
3. **Implement proper callbacks**: Essential for production monitoring
4. **Use structured outputs**: More reliable than parsing text
5. **Manage memory explicitly**: Don't rely on implicit state

## Conclusion

LangChain 0.2.x brings maturity and stability. The cleaner abstractions and LCEL make building production applications more straightforward. The improved Azure integrations mean less custom code for common patterns.

Update your dependencies and adopt the new patterns. The migration effort pays off in maintainability and reliability.

