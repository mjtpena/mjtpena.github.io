---
title: "Assistants Retrieval Tool: Building Knowledge Assistants"
description: "For many teams, the Assistants API's Retrieval tool removes the most tedious parts of building a knowledge assistant — you upload documents and the…"
author: "Michael John Peña"
draft: false
date: 2023-11-28
tags: ["OpenAI", "Assistants API", "RAG", "Retrieval", "Knowledge Base"]
---

For many teams, the Assistants API's Retrieval tool removes the most tedious parts of building a knowledge assistant — you upload documents and the assistant handles chunking, indexing and retrieval behind the scenes. This is a fast path to a production-ready knowledge assistant: no separate embedding pipeline, no vector DB to manage, and integrated file management. The trade-offs are familiar — very large, frequently updated corpora still benefit from a dedicated vector store — but as a pragmatic, low-maintenance option, Retrieval is excellent.

## How Retrieval Works

## How Retrieval Works

```python
from openai import OpenAI
from typing import List, Dict
from dataclasses import dataclass

@dataclass
class RetrievalConfig:
    """Configuration for retrieval-based assistants."""
    max_files: int = 20  # OpenAI limit per assistant
    supported_formats: tuple = ('.pdf', '.docx', '.txt', '.md', '.html', '.json')
    chunk_strategy: str = "auto"  # OpenAI handles chunking

class RetrievalAssistantBuilder:
    """Build assistants with retrieval capabilities."""

    def __init__(self, client: OpenAI):
        self.client = client
        self.config = RetrievalConfig()

    def create_knowledge_assistant(
        self,
        name: str,
        instructions: str,
        knowledge_files: List[str],
        model: str = "gpt-4-1106-preview"
    ) -> str:
        """Create an assistant with a knowledge base."""

        # Validate file count
        if len(knowledge_files) > self.config.max_files:
            raise ValueError(f"Max {self.config.max_files} files per assistant")

        # Upload files
        file_ids = []
        for file_path in knowledge_files:
            if not any(file_path.endswith(fmt) for fmt in self.config.supported_formats):
                print(f"Skipping unsupported format: {file_path}")
                continue

            with open(file_path, "rb") as f:
                file = self.client.files.create(file=f, purpose="assistants")
                file_ids.append(file.id)
                print(f"Uploaded: {file_path}")

        # Create assistant with retrieval
        assistant = self.client.beta.assistants.create(
            name=name,
            instructions=instructions,
            model=model,
            tools=[{"type": "retrieval"}],
            file_ids=file_ids
        )

        return assistant.id

    def create_qa_assistant(self, knowledge_files: List[str]) -> str:
        """Create a Q&A assistant for document queries."""
        instructions = """You are a helpful assistant that answers questions based on the provided documents.

        Guidelines:
        1. ONLY answer based on information in the documents
        2. If the answer isn't in the documents, say "I don't have information about that in my knowledge base"
        3. Always cite the source document when possible
        4. If a question is ambiguous, ask for clarification
        5. Provide direct, concise answers
        6. Use bullet points for lists

        Format citations as: [Source: document_name]"""

        return self.create_knowledge_assistant(
            name="Document Q&A Assistant",
            instructions=instructions,
            knowledge_files=knowledge_files
        )

    def create_research_assistant(self, knowledge_files: List[str]) -> str:
        """Create a research assistant for in-depth analysis."""
        instructions = """You are a research assistant that helps analyze and synthesize information from documents.

        Capabilities:
        1. Answer questions with detailed explanations
        2. Compare information across documents
        3. Identify patterns and themes
        4. Summarize sections or entire documents
        5. Extract specific data points

        Always:
        - Cite sources for claims
        - Distinguish between facts and interpretations
        - Acknowledge gaps in the available information
        - Suggest related questions the user might explore"""

        return self.create_knowledge_assistant(
            name="Research Assistant",
            instructions=instructions,
            knowledge_files=knowledge_files
        )
```

## Managing Knowledge Bases

```python
class KnowledgeBaseManager:
    """Manage knowledge bases for retrieval assistants."""

    def __init__(self, client: OpenAI):
        self.client = client

    def add_documents(self, assistant_id: str, file_paths: List[str]):
        """Add documents to an existing assistant."""
        for path in file_paths:
            with open(path, "rb") as f:
                file = self.client.files.create(file=f, purpose="assistants")

            self.client.beta.assistants.files.create(
                assistant_id=assistant_id,
                file_id=file.id
            )
            print(f"Added: {path}")

    def remove_document(self, assistant_id: str, file_id: str):
        """Remove a document from the assistant."""
        self.client.beta.assistants.files.delete(
            assistant_id=assistant_id,
            file_id=file_id
        )
        # Optionally delete the file entirely
        self.client.files.delete(file_id)

    def list_documents(self, assistant_id: str) -> List[Dict]:
        """List all documents in the assistant's knowledge base."""
        files = self.client.beta.assistants.files.list(assistant_id)

        documents = []
        for f in files.data:
            # Get file details
            file_info = self.client.files.retrieve(f.id)
            documents.append({
                "id": f.id,
                "filename": file_info.filename,
                "bytes": file_info.bytes,
                "created_at": f.created_at
            })

        return documents

    def refresh_document(self, assistant_id: str, old_file_id: str, new_file_path: str):
        """Replace a document with an updated version."""
        # Upload new version
        with open(new_file_path, "rb") as f:
            new_file = self.client.files.create(file=f, purpose="assistants")

        # Add to assistant
        self.client.beta.assistants.files.create(
            assistant_id=assistant_id,
            file_id=new_file.id
        )

        # Remove old version
        self.remove_document(assistant_id, old_file_id)

        return new_file.id

    def sync_directory(self, assistant_id: str, directory: str, extensions: List[str] = None):
        """Sync a directory with the assistant's knowledge base."""
        from pathlib import Path

        extensions = extensions or ['.pdf', '.txt', '.md', '.docx']
        dir_path = Path(directory)

        # Get current files
        current_files = {doc["filename"]: doc["id"]
                        for doc in self.list_documents(assistant_id)}

        # Find files in directory
        local_files = set()
        for ext in extensions:
            for file_path in dir_path.glob(f"*{ext}"):
                local_files.add(file_path.name)

                # Add if not present
                if file_path.name not in current_files:
                    self.add_documents(assistant_id, [str(file_path)])

        # Remove files no longer in directory
        for filename, file_id in current_files.items():
            if filename not in local_files:
                print(f"Removing: {filename}")
                self.remove_document(assistant_id, file_id)
```

## Query Optimization

```python
class RetrievalQueryOptimizer:
    """Optimize queries for better retrieval results."""

    def __init__(self, client: OpenAI):
        self.client = client

    def create_query_expansion_assistant(self) -> str:
        """Create an assistant that expands queries for better retrieval."""
        assistant = self.client.beta.assistants.create(
            name="Query Expander",
            instructions="""You help expand user queries to improve document retrieval.

            For each query, generate:
            1. The original query
            2. 2-3 alternative phrasings
            3. Related terms and concepts
            4. Specific keywords to look for

            Format as JSON:
            {
                "original": "query",
                "alternatives": ["alt1", "alt2"],
                "related_terms": ["term1", "term2"],
                "keywords": ["kw1", "kw2"]
            }""",
            model="gpt-3.5-turbo"
        )
        return assistant.id

    def multi_query_retrieval(
        self,
        assistant_id: str,
        query: str,
        num_variations: int = 3
    ) -> List[str]:
        """Generate multiple query variations for comprehensive retrieval."""
        # This would expand the query and run multiple retrievals
        # Combining results for better coverage
        pass

class CitationExtractor:
    """Extract and format citations from retrieval responses."""

    def extract_citations(self, response_text: str) -> List[Dict]:
        """Extract citation references from response."""
        import re

        # Pattern for citations like [Source: filename.pdf]
        pattern = r'\[Source:\s*([^\]]+)\]'
        matches = re.findall(pattern, response_text)

        return [{"source": match.strip()} for match in matches]

    def format_response_with_footnotes(self, response_text: str) -> str:
        """Convert inline citations to footnote format."""
        import re

        citations = []
        def replace_citation(match):
            source = match.group(1).strip()
            if source not in citations:
                citations.append(source)
            index = citations.index(source) + 1
            return f"[{index}]"

        formatted = re.sub(
            r'\[Source:\s*([^\]]+)\]',
            replace_citation,
            response_text
        )

        if citations:
            formatted += "\n\n---\nReferences:\n"
            for i, source in enumerate(citations, 1):
                formatted += f"{i}. {source}\n"

        return formatted
```

## Best Practices

```python
retrieval_best_practices = {
    "document_preparation": [
        "Use clear section headers in documents",
        "Include a table of contents for long documents",
        "Ensure text is extractable (not scanned images)",
        "Remove irrelevant boilerplate content",
        "Use descriptive filenames"
    ],
    "query_design": [
        "Be specific in your questions",
        "Include relevant context in queries",
        "Ask follow-up questions to drill down",
        "Request citations explicitly if needed"
    ],
    "assistant_instructions": [
        "Specify when to cite sources",
        "Define behavior for missing information",
        "Set expectations for response format",
        "Include domain-specific terminology guidance"
    ],
    "maintenance": [
        "Regularly update documents",
        "Monitor retrieval quality",
        "Remove outdated documents",
        "Test with sample queries after updates"
    ]
}
```

Tomorrow, we'll explore the 2023 AI Year in Review and what we've learned from this transformative year!
