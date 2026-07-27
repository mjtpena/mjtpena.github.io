---
title: "LangChain Introduction: Building AI Applications with Python"
author: Michael John Peña
draft: false
date: 2023-02-14
tags:
  - LangChain
  - Azure
  - OpenAI
  - AI
  - Python

---

I wrote "LangChain Introduction: Building AI Applications with Python" to share practical, production-minded guidance on this topic.

## Getting Started

```bash
pip install langchain openai
```

```python
from langchain.llms import AzureOpenAI
from langchain.chat_models import AzureChatOpenAI
import os

# Set environment variables
os.environ["OPENAI_API_TYPE"] = "azure"
os.environ["OPENAI_API_BASE"] = "https://your-resource.openai.azure.com/"
os.environ["OPENAI_API_KEY"] = "your-api-key"
os.environ["OPENAI_API_VERSION"] = "2023-03-15-preview"

# Initialize chat model
chat = AzureChatOpenAI(
    deployment_name="gpt-35-turbo",
    temperature=0.7
)

# Simple usage
from langchain.schema import HumanMessage
response = chat([HumanMessage(content="What is Azure?")])
print(response.content)
```

## Prompt Templates

Create reusable, parameterized prompts:

```python
from langchain.prompts import PromptTemplate, ChatPromptTemplate
from langchain.prompts.chat import SystemMessagePromptTemplate, HumanMessagePromptTemplate

# Simple prompt template
template = PromptTemplate(
    input_variables=["topic", "audience"],
    template="Explain {topic} to {audience} in 3 sentences."
)

prompt = template.format(topic="Azure Functions", audience="a beginner")
print(prompt)

# Chat prompt template
system_template = "You are a {role} expert who explains things clearly."
human_template = "Explain {concept} with a practical example."

chat_prompt = ChatPromptTemplate.from_messages([
    SystemMessagePromptTemplate.from_template(system_template),
    HumanMessagePromptTemplate.from_template(human_template)
])

messages = chat_prompt.format_messages(
    role="Azure",
    concept="Azure Cosmos DB"
)

response = chat(messages)
```

## Chains

Combine components into workflows:

```python
from langchain.chains import LLMChain, SimpleSequentialChain, SequentialChain

# Simple chain
simple_chain = LLMChain(
    llm=chat,
    prompt=template
)

result = simple_chain.run(topic="containers", audience="developers")

# Sequential chain - output of one is input to next
first_prompt = PromptTemplate(
    input_variables=["topic"],
    template="Generate 3 questions about {topic}."
)

second_prompt = PromptTemplate(
    input_variables=["questions"],
    template="Answer these questions concisely:\n{questions}"
)

first_chain = LLMChain(llm=chat, prompt=first_prompt, output_key="questions")
second_chain = LLMChain(llm=chat, prompt=second_prompt, output_key="answers")

overall_chain = SequentialChain(
    chains=[first_chain, second_chain],
    input_variables=["topic"],
    output_variables=["questions", "answers"],
    verbose=True
)

result = overall_chain({"topic": "Azure Kubernetes Service"})
print(result["questions"])
print(result["answers"])
```

## Document Loaders

Load content from various sources:

```python
from langchain.document_loaders import (
    TextLoader,
    PyPDFLoader,
    WebBaseLoader,
    DirectoryLoader
)

# Load text file
text_loader = TextLoader("document.txt")
documents = text_loader.load()

# Load PDF
pdf_loader = PyPDFLoader("manual.pdf")
pdf_docs = pdf_loader.load()

# Load from web
web_loader = WebBaseLoader("https://docs.microsoft.com/azure/...")
web_docs = web_loader.load()

# Load entire directory
dir_loader = DirectoryLoader(
    "./documents/",
    glob="**/*.txt",
    loader_cls=TextLoader
)
all_docs = dir_loader.load()

print(f"Loaded {len(all_docs)} documents")
```

## Text Splitters

Split documents for embedding:

```python
from langchain.text_splitter import (
    CharacterTextSplitter,
    RecursiveCharacterTextSplitter,
    TokenTextSplitter
)

# Character-based splitting
char_splitter = CharacterTextSplitter(
    separator="\n\n",
    chunk_size=1000,
    chunk_overlap=200
)

# Recursive splitting (tries multiple separators)
recursive_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " ", ""]
)

# Token-based splitting
token_splitter = TokenTextSplitter(
    chunk_size=500,
    chunk_overlap=50
)

# Split documents
chunks = recursive_splitter.split_documents(documents)
print(f"Split into {len(chunks)} chunks")
```

## Embeddings

Generate embeddings for semantic search:

```python
from langchain.embeddings import OpenAIEmbeddings

# Azure OpenAI embeddings
embeddings = OpenAIEmbeddings(
    deployment="text-embedding-ada-002",
    model="text-embedding-ada-002",
    chunk_size=1
)

# Embed single text
vector = embeddings.embed_query("What is Azure?")
print(f"Vector dimensions: {len(vector)}")

# Embed multiple texts
texts = ["Azure is a cloud platform", "AWS is another cloud provider"]
vectors = embeddings.embed_documents(texts)
```

## Vector Stores

Store and search embeddings:

```python
from langchain.vectorstores import FAISS, Chroma

# Create FAISS index
vectorstore = FAISS.from_documents(
    documents=chunks,
    embedding=embeddings
)

# Search
results = vectorstore.similarity_search("serverless computing", k=3)
for doc in results:
    print(doc.page_content[:100])

# Search with scores
results_with_scores = vectorstore.similarity_search_with_score(
    "database options",
    k=5
)
for doc, score in results_with_scores:
    print(f"Score: {score:.4f} - {doc.page_content[:50]}")

# Save and load
vectorstore.save_local("faiss_index")
loaded_vectorstore = FAISS.load_local("faiss_index", embeddings)
```

## RetrievalQA Chain

Build a complete RAG system:

```python
from langchain.chains import RetrievalQA

# Create retriever from vectorstore
retriever = vectorstore.as_retriever(
    search_type="similarity",
    search_kwargs={"k": 5}
)

# Create QA chain
qa_chain = RetrievalQA.from_chain_type(
    llm=chat,
    chain_type="stuff",  # or "map_reduce", "refine"
    retriever=retriever,
    return_source_documents=True
)

# Query
result = qa_chain({"query": "What are Azure's compute options?"})
print(result["result"])
print(f"Sources: {len(result['source_documents'])}")
```

## Memory

Maintain conversation history:

```python
from langchain.memory import (
    ConversationBufferMemory,
    ConversationSummaryMemory,
    ConversationBufferWindowMemory
)
from langchain.chains import ConversationChain

# Buffer memory - keeps all messages
buffer_memory = ConversationBufferMemory()

# Window memory - keeps last k exchanges
window_memory = ConversationBufferWindowMemory(k=5)

# Summary memory - summarizes history
summary_memory = ConversationSummaryMemory(llm=chat)

# Conversation chain with memory
conversation = ConversationChain(
    llm=chat,
    memory=buffer_memory,
    verbose=True
)

# Multi-turn conversation
response1 = conversation.predict(input="What is Azure Cosmos DB?")
response2 = conversation.predict(input="What are its consistency levels?")
response3 = conversation.predict(input="Which one should I use for e-commerce?")
```

## Example: Complete RAG Application

```python
from langchain.chains import ConversationalRetrievalChain

class LangChainRAGApp:
    """Complete RAG application with LangChain."""

    def __init__(
        self,
        deployment_name: str = "gpt-35-turbo",
        embedding_deployment: str = "text-embedding-ada-002"
    ):
        self.chat = AzureChatOpenAI(deployment_name=deployment_name)
        self.embeddings = OpenAIEmbeddings(deployment=embedding_deployment)
        self.vectorstore = None
        self.qa_chain = None

    def load_documents(self, file_paths: list):
        """Load and process documents."""
        all_docs = []
        for path in file_paths:
            if path.endswith('.pdf'):
                loader = PyPDFLoader(path)
            else:
                loader = TextLoader(path)
            all_docs.extend(loader.load())

        # Split
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
        chunks = splitter.split_documents(all_docs)

        # Create vectorstore
        self.vectorstore = FAISS.from_documents(chunks, self.embeddings)

        # Create QA chain
        self.qa_chain = ConversationalRetrievalChain.from_llm(
            llm=self.chat,
            retriever=self.vectorstore.as_retriever(search_kwargs={"k": 5}),
            return_source_documents=True
        )

        return len(chunks)

    def query(self, question: str, chat_history: list = None) -> dict:
        """Query the knowledge base."""
        chat_history = chat_history or []

        result = self.qa_chain({
            "question": question,
            "chat_history": chat_history
        })

        return {
            "answer": result["answer"],
            "sources": [
                doc.page_content[:200]
                for doc in result["source_documents"]
            ]
        }

# Usage
app = LangChainRAGApp()
app.load_documents(["azure_docs.pdf", "internal_wiki.txt"])

result = app.query("How do I scale Azure Functions?")
print(result["answer"])
```

## Best Practices

1. **Use appropriate chain types**: stuff for small contexts, map_reduce for large
2. **Tune retrieval**: Adjust k, similarity threshold
3. **Manage memory**: Clear or summarize for long conversations
4. **Handle errors**: LangChain can fail silently
5. **Monitor costs**: Track token usage across chains

## Resources

- [LangChain Documentation](https://python.langchain.com/)
- [LangChain GitHub](https://github.com/langchain-ai/langchain)
- [Azure OpenAI Integration](https://python.langchain.com/docs/integrations/llms/azure_openai)

