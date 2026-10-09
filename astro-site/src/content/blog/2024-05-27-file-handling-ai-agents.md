---
title: "File Handling in AI Agents"
description: "AI agents often need to work with files - reading documents, processing data, generating outputs. Today I'm exploring safe and effective file handling patterns."
author: Michael John Peña
draft: false
date: 2024-05-27
tags:
  - AI Agents
  - File Processing
  - Azure Storage
  - Document AI
  - Patterns
---

AI agents often need to work with files - reading documents, processing data, generating outputs. Today I'm exploring safe and effective file handling patterns.

## File Handling Challenges

```
Challenges:
├── Large file sizes
├── Multiple formats
├── Sensitive content
├── Storage management
└── Concurrent access
```

## File Type Processing

### Document Processing

```python
import fitz  # PyMuPDF
from docx import Document
import openpyxl
from typing import Union
import magic

class DocumentProcessor:
    """Process various document formats."""

    def __init__(self, max_size_mb: int = 50):
        self.max_size_bytes = max_size_mb * 1024 * 1024

    async def extract_text(self, file_path: str) -> dict:
        # Check file size
        file_size = os.path.getsize(file_path)
        if file_size > self.max_size_bytes:
            return {"error": f"File too large: {file_size / 1024 / 1024:.1f}MB"}

        # Detect file type
        mime_type = magic.from_file(file_path, mime=True)

        if mime_type == "application/pdf":
            return self._extract_pdf(file_path)
        elif mime_type in ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]:
            return self._extract_docx(file_path)
        elif mime_type in ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]:
            return self._extract_xlsx(file_path)
        elif mime_type.startswith("text/"):
            return self._extract_text_file(file_path)
        else:
            return {"error": f"Unsupported file type: {mime_type}"}

    def _extract_pdf(self, path: str) -> dict:
        doc = fitz.open(path)
        text = ""
        pages = []

        for page_num, page in enumerate(doc):
            page_text = page.get_text()
            text += page_text
            pages.append({
                "page": page_num + 1,
                "text": page_text,
                "char_count": len(page_text)
            })

        return {
            "type": "pdf",
            "total_pages": len(doc),
            "total_chars": len(text),
            "text": text,
            "pages": pages
        }

    def _extract_docx(self, path: str) -> dict:
        doc = Document(path)
        paragraphs = [p.text for p in doc.paragraphs]
        text = "\n".join(paragraphs)

        return {
            "type": "docx",
            "total_paragraphs": len(paragraphs),
            "total_chars": len(text),
            "text": text
        }

    def _extract_xlsx(self, path: str) -> dict:
        wb = openpyxl.load_workbook(path, data_only=True)
        sheets = {}

        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            data = []
            for row in sheet.iter_rows(values_only=True):
                data.append(list(row))

            sheets[sheet_name] = {
                "rows": len(data),
                "data": data[:1000]  # Limit rows
            }

        return {
            "type": "xlsx",
            "sheet_count": len(sheets),
            "sheets": sheets
        }

    def _extract_text_file(self, path: str) -> dict:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()

        return {
            "type": "text",
            "total_chars": len(text),
            "text": text
        }
```

### Image Processing

```python
from PIL import Image
import base64
import io

class ImageProcessor:
    """Process images for AI consumption."""

    def __init__(self, max_dimension: int = 2048):
        self.max_dimension = max_dimension

    def prepare_for_vision_api(self, image_path: str) -> dict:
        """Prepare image for vision API consumption."""
        img = Image.open(image_path)

        # Get original info
        original_size = img.size
        original_format = img.format

        # Resize if needed
        if max(img.size) > self.max_dimension:
            img = self._resize_image(img)

        # Convert to RGB if needed
        if img.mode not in ["RGB", "L"]:
            img = img.convert("RGB")

        # Convert to base64
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        base64_data = base64.b64encode(buffer.getvalue()).decode()

        return {
            "original_size": original_size,
            "processed_size": img.size,
            "format": "PNG",
            "base64": base64_data,
            "data_url": f"data:image/png;base64,{base64_data}"
        }

    def _resize_image(self, img: Image) -> Image:
        """Resize while maintaining aspect ratio."""
        ratio = self.max_dimension / max(img.size)
        new_size = tuple(int(dim * ratio) for dim in img.size)
        return img.resize(new_size, Image.LANCZOS)

    def extract_metadata(self, image_path: str) -> dict:
        """Extract image metadata."""
        img = Image.open(image_path)

        metadata = {
            "size": img.size,
            "format": img.format,
            "mode": img.mode,
        }

        # Extract EXIF data if available
        if hasattr(img, "_getexif") and img._getexif():
            exif = img._getexif()
            # Extract safe metadata only
            safe_tags = {271: "make", 272: "model", 306: "datetime"}
            metadata["exif"] = {
                safe_tags[k]: v for k, v in exif.items()
                if k in safe_tags
            }

        return metadata
```

## Azure Blob Storage Integration

```python
from azure.storage.blob import BlobServiceClient, BlobSasPermissions, generate_blob_sas
from datetime import datetime, timedelta
import uuid

class AzureBlobFileManager:
    """Manage files in Azure Blob Storage."""

    def __init__(self, connection_string: str, container_name: str):
        self.blob_service = BlobServiceClient.from_connection_string(connection_string)
        self.container_name = container_name
        self.container_client = self.blob_service.get_container_client(container_name)

        # Ensure container exists
        if not self.container_client.exists():
            self.container_client.create_container()

    async def upload_file(
        self,
        file_path: str,
        user_id: str,
        metadata: dict = None
    ) -> dict:
        """Upload file with organized path."""
        file_name = os.path.basename(file_path)
        blob_name = f"{user_id}/{datetime.utcnow().strftime('%Y/%m/%d')}/{uuid.uuid4()}/{file_name}"

        blob_client = self.container_client.get_blob_client(blob_name)

        with open(file_path, "rb") as f:
            blob_client.upload_blob(
                f,
                metadata=metadata or {},
                overwrite=True
            )

        return {
            "blob_name": blob_name,
            "url": blob_client.url,
            "size": os.path.getsize(file_path)
        }

    async def get_download_url(
        self,
        blob_name: str,
        expiry_hours: int = 1
    ) -> str:
        """Generate SAS URL for download."""
        blob_client = self.container_client.get_blob_client(blob_name)

        sas_token = generate_blob_sas(
            account_name=self.blob_service.account_name,
            container_name=self.container_name,
            blob_name=blob_name,
            account_key=self.blob_service.credential.account_key,
            permission=BlobSasPermissions(read=True),
            expiry=datetime.utcnow() + timedelta(hours=expiry_hours)
        )

        return f"{blob_client.url}?{sas_token}"

    async def list_user_files(self, user_id: str) -> list:
        """List files for a user."""
        blobs = self.container_client.list_blobs(name_starts_with=f"{user_id}/")
        return [
            {
                "name": blob.name,
                "size": blob.size,
                "created": blob.creation_time,
                "metadata": blob.metadata
            }
            for blob in blobs
        ]

    async def delete_file(self, blob_name: str):
        """Delete a file."""
        blob_client = self.container_client.get_blob_client(blob_name)
        blob_client.delete_blob()
```

## File-Aware Agent

```python
class FileAwareAgent:
    """Agent that can work with files."""

    def __init__(
        self,
        client,
        file_manager: AzureBlobFileManager,
        doc_processor: DocumentProcessor
    ):
        self.client = client
        self.file_manager = file_manager
        self.doc_processor = doc_processor

    async def process_query_with_file(
        self,
        query: str,
        file_path: str,
        user_id: str
    ) -> dict:
        # Upload file
        upload_result = await self.file_manager.upload_file(file_path, user_id)

        # Extract content
        content = await self.doc_processor.extract_text(file_path)

        if "error" in content:
            return {"error": content["error"]}

        # Truncate if needed
        text = content.get("text", "")
        if len(text) > 100000:
            text = text[:100000] + "\n\n[Content truncated due to length...]"

        # Query with context
        messages = [
            {
                "role": "system",
                "content": "You help users analyze documents. Use the provided document content to answer questions."
            },
            {
                "role": "user",
                "content": f"Document content:\n\n{text}\n\n---\n\nQuestion: {query}"
            }
        ]

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=messages
        )

        return {
            "answer": response.choices[0].message.content,
            "file_info": upload_result,
            "document_stats": {
                "type": content.get("type"),
                "chars": content.get("total_chars"),
                "pages": content.get("total_pages")
            }
        }

    async def generate_file(
        self,
        prompt: str,
        output_format: str,
        user_id: str
    ) -> dict:
        """Generate a file based on prompt."""
        if output_format == "csv":
            return await self._generate_csv(prompt, user_id)
        elif output_format == "json":
            return await self._generate_json(prompt, user_id)
        else:
            return {"error": f"Unsupported format: {output_format}"}

    async def _generate_csv(self, prompt: str, user_id: str) -> dict:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "Generate CSV data. Output only the CSV content with headers."
                },
                {"role": "user", "content": prompt}
            ]
        )

        csv_content = response.choices[0].message.content

        # Save to temp file
        temp_path = f"/tmp/{uuid.uuid4()}.csv"
        with open(temp_path, "w") as f:
            f.write(csv_content)

        # Upload
        upload_result = await self.file_manager.upload_file(
            temp_path, user_id, {"generated": "true", "format": "csv"}
        )

        # Get download URL
        download_url = await self.file_manager.get_download_url(upload_result["blob_name"])

        # Cleanup
        os.remove(temp_path)

        return {
            "content_preview": csv_content[:1000],
            "download_url": download_url,
            "file_info": upload_result
        }
```

## Chunking Large Files

```python
class FileChunker:
    """Split large files into processable chunks."""

    def __init__(self, chunk_size: int = 4000, overlap: int = 200):
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk_text(self, text: str) -> list:
        """Split text into overlapping chunks."""
        chunks = []
        start = 0

        while start < len(text):
            end = start + self.chunk_size

            # Try to break at sentence boundary
            if end < len(text):
                # Look for sentence end
                for sep in [". ", ".\n", "\n\n"]:
                    last_sep = text[start:end].rfind(sep)
                    if last_sep > 0:
                        end = start + last_sep + len(sep)
                        break

            chunk = text[start:end]
            chunks.append({
                "index": len(chunks),
                "start": start,
                "end": end,
                "text": chunk,
                "char_count": len(chunk)
            })

            start = end - self.overlap

        return chunks

    async def process_large_document(
        self,
        file_path: str,
        processor: DocumentProcessor,
        query: str,
        client
    ) -> dict:
        """Process large document in chunks."""
        # Extract text
        content = await processor.extract_text(file_path)
        if "error" in content:
            return content

        # Chunk the content
        chunks = self.chunk_text(content["text"])

        # Process each chunk
        chunk_results = []
        for chunk in chunks:
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": "Extract relevant information for the query from this document chunk."
                    },
                    {
                        "role": "user",
                        "content": f"Query: {query}\n\nDocument chunk:\n{chunk['text']}"
                    }
                ]
            )
            chunk_results.append({
                "chunk_index": chunk["index"],
                "relevant_info": response.choices[0].message.content
            })

        # Synthesize results
        synthesis_response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "Synthesize these extracted pieces into a coherent answer."
                },
                {
                    "role": "user",
                    "content": f"Query: {query}\n\nExtracted information:\n{json.dumps(chunk_results, indent=2)}"
                }
            ]
        )

        return {
            "answer": synthesis_response.choices[0].message.content,
            "chunks_processed": len(chunks),
            "chunk_results": chunk_results
        }
```

## Security Considerations

```python
class SecureFileHandler:
    """Handle files with security in mind."""

    ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".csv", ".txt", ".json", ".png", ".jpg", ".jpeg"}
    MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB

    def validate_file(self, file_path: str) -> dict:
        """Validate file before processing."""
        issues = []

        # Check extension
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in self.ALLOWED_EXTENSIONS:
            issues.append(f"File type not allowed: {ext}")

        # Check size
        size = os.path.getsize(file_path)
        if size > self.MAX_FILE_SIZE:
            issues.append(f"File too large: {size / 1024 / 1024:.1f}MB")

        # Check magic bytes match extension
        detected_type = magic.from_file(file_path, mime=True)
        expected_types = self._get_expected_mime(ext)
        if detected_type not in expected_types:
            issues.append(f"File type mismatch: {detected_type} vs expected {expected_types}")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "size": size,
            "detected_type": detected_type
        }

    def _get_expected_mime(self, ext: str) -> list:
        mime_map = {
            ".pdf": ["application/pdf"],
            ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
            ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
            ".csv": ["text/csv", "text/plain"],
            ".txt": ["text/plain"],
            ".json": ["application/json", "text/plain"],
            ".png": ["image/png"],
            ".jpg": ["image/jpeg"],
            ".jpeg": ["image/jpeg"]
        }
        return mime_map.get(ext, [])
```

## Best Practices

1. **Validate all uploads** - Check type, size, and content
2. **Use cloud storage** - Don't store locally in production
3. **Generate SAS tokens** - Time-limited access to files
4. **Chunk large files** - Process in manageable pieces
5. **Clean up temp files** - Prevent disk space issues

## What's Next

Tomorrow I'll cover memory and state management in AI agents.

## Resources

- [Azure Blob Storage Python SDK](https://learn.microsoft.com/azure/storage/blobs/storage-quickstart-blobs-python)
- [PyMuPDF Documentation](https://pymupdf.readthedocs.io/)
- [python-docx](https://python-docx.readthedocs.io/)
