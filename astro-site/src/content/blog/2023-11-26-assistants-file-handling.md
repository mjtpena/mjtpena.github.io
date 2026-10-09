---
title: "Assistants API: File Handling and Knowledge Retrieval"
description: "I prefer the Assistants API's file-based retrieval when I need a fast, low-friction knowledge assistant — upload a set of documents and let the assistant…"
author: "Michael John Peña"
draft: false
date: 2023-11-26
tags: ["OpenAI", "Assistants API", "RAG", "File Handling", "AI"]
---

I prefer the Assistants API's file-based retrieval when I need a fast, low-friction knowledge assistant — upload a set of documents and let the assistant handle chunking, indexing, and retrieval without standing up a dedicated vector DB. For many internal knowledge use cases this removes operational overhead: files stay attached to the assistant, access controls live with your tenancy, and iteration is fast. It's not a silver bullet — very large corpora or strict provenance requirements still favour a dedicated vector store — but as a pragmatic path to production, file handling is compelling.

## File Upload and Management

## File Upload and Management

```python
from openai import OpenAI
from typing import List, Dict, Optional
from pathlib import Path
import mimetypes

class AssistantFileHandler:
    SUPPORTED_FORMATS = {
        'retrieval': ['.pdf', '.docx', '.txt', '.md', '.html', '.json', '.csv'],
        'code_interpreter': ['.py', '.csv', '.xlsx', '.json', '.txt', '.pdf']
    }

    MAX_FILE_SIZE_MB = 512  # OpenAI limit

    def __init__(self, client: OpenAI):
        self.client = client

    def upload_file(
        self,
        file_path: str,
        purpose: str = "assistants"
    ) -> str:
        """Upload a file for use with assistants."""
        path = Path(file_path)

        # Validate file
        self._validate_file(path)

        with open(path, "rb") as f:
            file = self.client.files.create(file=f, purpose=purpose)

        return file.id

    def _validate_file(self, path: Path):
        """Validate file before upload."""
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        size_mb = path.stat().st_size / (1024 * 1024)
        if size_mb > self.MAX_FILE_SIZE_MB:
            raise ValueError(f"File too large: {size_mb:.1f}MB (max {self.MAX_FILE_SIZE_MB}MB)")

        suffix = path.suffix.lower()
        all_supported = set(self.SUPPORTED_FORMATS['retrieval'] + self.SUPPORTED_FORMATS['code_interpreter'])
        if suffix not in all_supported:
            raise ValueError(f"Unsupported file format: {suffix}")

    def upload_directory(
        self,
        directory_path: str,
        extensions: List[str] = None
    ) -> List[str]:
        """Upload all matching files from a directory."""
        dir_path = Path(directory_path)
        extensions = extensions or self.SUPPORTED_FORMATS['retrieval']

        file_ids = []
        for ext in extensions:
            for file_path in dir_path.glob(f"**/*{ext}"):
                try:
                    file_id = self.upload_file(str(file_path))
                    file_ids.append(file_id)
                    print(f"Uploaded: {file_path.name} -> {file_id}")
                except Exception as e:
                    print(f"Failed to upload {file_path.name}: {e}")

        return file_ids

    def list_files(self, purpose: str = None) -> List[Dict]:
        """List all uploaded files."""
        files = self.client.files.list()
        result = []

        for f in files.data:
            if purpose is None or f.purpose == purpose:
                result.append({
                    "id": f.id,
                    "filename": f.filename,
                    "purpose": f.purpose,
                    "bytes": f.bytes,
                    "created_at": f.created_at
                })

        return result

    def delete_file(self, file_id: str) -> bool:
        """Delete an uploaded file."""
        self.client.files.delete(file_id)
        return True

    def cleanup_old_files(self, max_age_days: int = 30):
        """Delete files older than specified days."""
        import time

        cutoff = time.time() - (max_age_days * 24 * 60 * 60)
        files = self.list_files()

        deleted = 0
        for f in files:
            if f["created_at"] < cutoff:
                self.delete_file(f["id"])
                deleted += 1

        return deleted
```

## Creating Knowledge-Based Assistants

```python
class KnowledgeAssistant:
    """Assistant with retrieval-augmented generation capabilities."""

    def __init__(self, client: OpenAI):
        self.client = client
        self.file_handler = AssistantFileHandler(client)

    def create_with_knowledge_base(
        self,
        name: str,
        instructions: str,
        file_paths: List[str],
        model: str = "gpt-4-1106-preview"
    ) -> str:
        """Create an assistant with a knowledge base."""

        # Upload all files
        file_ids = []
        for path in file_paths:
            file_id = self.file_handler.upload_file(path)
            file_ids.append(file_id)
            print(f"Uploaded {path} -> {file_id}")

        # Create assistant with retrieval
        assistant = self.client.beta.assistants.create(
            name=name,
            instructions=instructions,
            model=model,
            tools=[{"type": "retrieval"}],
            file_ids=file_ids
        )

        return assistant.id

    def add_files_to_assistant(
        self,
        assistant_id: str,
        file_paths: List[str]
    ):
        """Add more files to an existing assistant."""
        for path in file_paths:
            file_id = self.file_handler.upload_file(path)
            self.client.beta.assistants.files.create(
                assistant_id=assistant_id,
                file_id=file_id
            )

    def remove_file_from_assistant(
        self,
        assistant_id: str,
        file_id: str
    ):
        """Remove a file from an assistant."""
        self.client.beta.assistants.files.delete(
            assistant_id=assistant_id,
            file_id=file_id
        )

    def get_assistant_files(self, assistant_id: str) -> List[Dict]:
        """List all files attached to an assistant."""
        files = self.client.beta.assistants.files.list(assistant_id)
        return [{"id": f.id, "created_at": f.created_at} for f in files.data]

# Example: Create a documentation assistant
client = OpenAI()
kb_assistant = KnowledgeAssistant(client)

assistant_id = kb_assistant.create_with_knowledge_base(
    name="Product Documentation Expert",
    instructions="""You are a product documentation expert.
    Answer questions based ONLY on the provided documentation.
    If information is not in the docs, say so clearly.
    Always cite the source document when providing information.""",
    file_paths=[
        "docs/user_guide.pdf",
        "docs/api_reference.md",
        "docs/faq.txt"
    ]
)
```

## Thread-Level File Attachments

```python
class ThreadFileManager:
    """Manage files at the thread level for context-specific data."""

    def __init__(self, client: OpenAI):
        self.client = client
        self.file_handler = AssistantFileHandler(client)

    def create_thread_with_files(
        self,
        initial_message: str,
        file_paths: List[str]
    ) -> str:
        """Create a thread with file attachments."""
        # Upload files
        file_ids = [
            self.file_handler.upload_file(path)
            for path in file_paths
        ]

        # Create thread with initial message and files
        thread = self.client.beta.threads.create(
            messages=[
                {
                    "role": "user",
                    "content": initial_message,
                    "file_ids": file_ids
                }
            ]
        )

        return thread.id

    def add_file_to_message(
        self,
        thread_id: str,
        message: str,
        file_path: str
    ):
        """Add a message with a file attachment."""
        file_id = self.file_handler.upload_file(file_path)

        return self.client.beta.threads.messages.create(
            thread_id=thread_id,
            role="user",
            content=message,
            file_ids=[file_id]
        )

# Example: Analyze a specific document in conversation
thread_files = ThreadFileManager(client)

thread_id = thread_files.create_thread_with_files(
    "Please analyze this financial report and summarize the key metrics.",
    ["reports/q3_financials.pdf"]
)
```

## Handling Generated Files

```python
class GeneratedFileHandler:
    """Handle files generated by the assistant (charts, exports, etc.)."""

    def __init__(self, client: OpenAI):
        self.client = client

    def extract_files_from_response(
        self,
        thread_id: str,
        run_id: str
    ) -> List[Dict]:
        """Extract generated files from assistant response."""
        messages = self.client.beta.threads.messages.list(thread_id)
        generated_files = []

        for message in messages.data:
            if message.role != "assistant":
                continue

            for content in message.content:
                # Check for file annotations
                if hasattr(content, 'text') and content.text.annotations:
                    for annotation in content.text.annotations:
                        if annotation.type == "file_path":
                            generated_files.append({
                                "file_id": annotation.file_path.file_id,
                                "text_reference": annotation.text,
                                "start_index": annotation.start_index,
                                "end_index": annotation.end_index
                            })

                # Check for image files
                if content.type == "image_file":
                    generated_files.append({
                        "file_id": content.image_file.file_id,
                        "type": "image"
                    })

        return generated_files

    def download_file(self, file_id: str, output_path: str):
        """Download a generated file."""
        content = self.client.files.content(file_id)
        with open(output_path, "wb") as f:
            f.write(content.read())
        return output_path

    def process_code_interpreter_output(
        self,
        thread_id: str,
        output_dir: str = "output"
    ) -> List[str]:
        """Download all files generated by code interpreter."""
        import os
        os.makedirs(output_dir, exist_ok=True)

        generated = self.extract_files_from_response(thread_id, None)
        downloaded = []

        for i, file_info in enumerate(generated):
            file_id = file_info["file_id"]
            ext = ".png" if file_info.get("type") == "image" else ".csv"
            output_path = os.path.join(output_dir, f"output_{i}{ext}")
            self.download_file(file_id, output_path)
            downloaded.append(output_path)

        return downloaded
```

## Best Practices for File Handling

```python
file_handling_best_practices = {
    "organization": [
        "Use descriptive filenames",
        "Group related documents together",
        "Version your document uploads"
    ],
    "optimization": [
        "Pre-process large PDFs into smaller chunks",
        "Remove unnecessary formatting from documents",
        "Use plain text where possible for better retrieval"
    ],
    "security": [
        "Don't upload files with sensitive data",
        "Implement access controls for file uploads",
        "Regularly audit and clean up files"
    ],
    "retrieval_quality": [
        "Include descriptive headers in documents",
        "Use clear section titles",
        "Provide context in document introductions"
    ]
}
```

Tomorrow, we'll explore the Code Interpreter tool and how to leverage it for data analysis!
