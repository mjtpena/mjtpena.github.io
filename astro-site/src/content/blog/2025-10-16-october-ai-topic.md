---
title: "Implementing RAG with LangChain and Azure OpenAI"
description: "Experiment with chunk sizes, overlap, and retrieval strategies. Hybrid search combining semantic and keyword matching often provides the best results for…"
author: Michael John Peña
draft: false
date: 2025-10-16
tags:
  - RAG
  - LangChain
  - Azure OpenAI
  - Vector Search
  - AI Applications
---

## Setting Up the RAG Pipeline

Configure LangChain with Azure services:

```python
from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings
from langchain_community.vectorstores import AzureSearch
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate

class RAGPipeline:
    def __init__(
        self,
        azure_endpoint: str,
        api_key: str,
        deployment_name: str,
        embedding_deployment: str,
        search_endpoint: str,
        search_key: str,
        index_name: str
    ):
        self.llm = AzureChatOpenAI(
            azure_endpoint=azure_endpoint,
            api_key=api_key,
            deployment_name=deployment_name,
            temperature=0.1
        )

        self.embeddings = AzureOpenAIEmbeddings(
            azure_endpoint=azure_endpoint,
            api_key=api_key,
            deployment=embedding_deployment
        )

        self.vector_store = AzureSearch(
            azure_search_endpoint=search_endpoint,
            azure_search_key=search_key,
            index_name=index_name,
            embedding_function=self.embeddings.embed_query
        )

    def ingest_documents(self, documents: list[str], metadata: list[dict] = None):
        """Split and ingest documents into vector store."""

        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            separators=["\n\n", "\n", ". ", " ", ""]
        )

        chunks = []
        chunk_metadata = []

        for i, doc in enumerate(documents):
            doc_chunks = text_splitter.split_text(doc)
            chunks.extend(doc_chunks)

            doc_meta = metadata[i] if metadata else {}
            chunk_metadata.extend([{**doc_meta, "chunk_index": j} for j in range(len(doc_chunks))])

        self.vector_store.add_texts(chunks, metadatas=chunk_metadata)
```

## Building the QA Chain

Create a retrieval chain with custom prompts:

```python
def create_qa_chain(self) -> RetrievalQA:
    """Create a question-answering chain with retrieval."""

    prompt_template = """Use the following context to answer the question.
If you cannot answer based on the context, say "I don't have enough information to answer this question."

Context:
{context}

Question: {question}

Answer: Provide a clear, concise answer based on the context above."""

    prompt = PromptTemplate(
        template=prompt_template,
        input_variables=["context", "question"]
    )

    retriever = self.vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": 5}
    )

    qa_chain = RetrievalQA.from_chain_type(
        llm=self.llm,
        chain_type="stuff",
        retriever=retriever,
        return_source_documents=True,
        chain_type_kwargs={"prompt": prompt}
    )

    return qa_chain

def answer_question(self, question: str) -> dict:
    """Answer a question using the RAG pipeline."""

    qa_chain = self.create_qa_chain()
    result = qa_chain.invoke({"query": question})

    return {
        "answer": result["result"],
        "sources": [doc.metadata for doc in result["source_documents"]]
    }
```

## Optimizing Retrieval Quality

Experiment with chunk sizes, overlap, and retrieval strategies. Hybrid search combining semantic and keyword matching often provides the best results for enterprise applications.
