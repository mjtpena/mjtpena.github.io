---
title: "OpenAI Assistants API: Production Patterns and Best Practices"
description: "I started building with the Assistants API in late 2023. In production it rewarded strict state management, clear tool contracts, and thoughtful thread…"
author: Michael John Peña
draft: false
date: 2024-01-03
tags:
  - OpenAI
  - Assistants API
  - Azure OpenAI
  - AI Agents
  - Production
---

I started building with the Assistants API in late 2023. In production it rewarded strict state management, clear tool contracts, and thoughtful thread lifecycle control. The patterns below reflect what moved projects from brittle demos to maintainable assistants.

## Assistants API Fundamentals

The API introduces three key concepts:
- **Assistants**: Configured AI agents with instructions and tools
- **Threads**: Conversation sessions that persist messages
- **Runs**: Execution instances that process messages

```python
from openai import OpenAI
import time

client = OpenAI()

# Create an assistant
assistant = client.beta.assistants.create(
    name="Data Analyst",
    instructions="""You are a data analyst assistant. You help users:
    - Analyze data files they upload
    - Generate insights and visualizations
    - Answer questions about their data
    Always explain your methodology and be precise with numbers.""",
    model="gpt-4-turbo",
    tools=[
        {"type": "code_interpreter"},
        {"type": "retrieval"}
    ]
)

print(f"Created assistant: {assistant.id}")
```

## Production Architecture

### Thread Management

Threads persist conversations, but you need a strategy for managing them:

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
import json

@dataclass
class ThreadMetadata:
    thread_id: str
    user_id: str
    created_at: datetime
    last_activity: datetime
    purpose: str

class ThreadManager:
    def __init__(self, client, storage):
        self.client = client
        self.storage = storage  # Redis, database, etc.

    def get_or_create_thread(
        self,
        user_id: str,
        purpose: str,
        max_age_hours: int = 24
    ) -> str:
        """Get existing thread or create new one."""

        # Look for existing recent thread
        key = f"thread:{user_id}:{purpose}"
        existing = self.storage.get(key)

        if existing:
            metadata = ThreadMetadata(**json.loads(existing))

            # Check if thread is still fresh
            if datetime.utcnow() - metadata.last_activity < timedelta(hours=max_age_hours):
                # Update last activity
                metadata.last_activity = datetime.utcnow()
                self.storage.set(key, json.dumps(metadata.__dict__, default=str))
                return metadata.thread_id

        # Create new thread
        thread = self.client.beta.threads.create()

        metadata = ThreadMetadata(
            thread_id=thread.id,
            user_id=user_id,
            created_at=datetime.utcnow(),
            last_activity=datetime.utcnow(),
            purpose=purpose
        )

        self.storage.set(
            key,
            json.dumps(metadata.__dict__, default=str),
            ex=max_age_hours * 3600
        )

        return thread.id

    def cleanup_old_threads(self, max_age_days: int = 7):
        """Delete threads older than threshold."""

        # Implementation depends on your storage backend
        # Iterate through stored threads and delete old ones
        pass
```

### Async Run Processing

Production systems need robust run handling:

```python
import asyncio
from enum import Enum

class RunStatus(Enum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    REQUIRES_ACTION = "requires_action"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"

class AssistantRunner:
    def __init__(self, client, assistant_id: str):
        self.client = client
        self.assistant_id = assistant_id

    async def run_with_message(
        self,
        thread_id: str,
        message: str,
        timeout_seconds: int = 300,
        poll_interval: float = 1.0
    ) -> str:
        """Add message to thread and run assistant."""

        # Add the user message
        self.client.beta.threads.messages.create(
            thread_id=thread_id,
            role="user",
            content=message
        )

        # Create a run
        run = self.client.beta.threads.runs.create(
            thread_id=thread_id,
            assistant_id=self.assistant_id
        )

        # Poll for completion
        start_time = asyncio.get_event_loop().time()

        while True:
            elapsed = asyncio.get_event_loop().time() - start_time

            if elapsed > timeout_seconds:
                self.client.beta.threads.runs.cancel(
                    thread_id=thread_id,
                    run_id=run.id
                )
                raise TimeoutError(f"Run timed out after {timeout_seconds}s")

            run = self.client.beta.threads.runs.retrieve(
                thread_id=thread_id,
                run_id=run.id
            )

            status = RunStatus(run.status)

            if status == RunStatus.COMPLETED:
                return self._get_latest_response(thread_id)

            elif status == RunStatus.REQUIRES_ACTION:
                await self._handle_tool_calls(thread_id, run)

            elif status in [RunStatus.FAILED, RunStatus.CANCELLED, RunStatus.EXPIRED]:
                raise RuntimeError(f"Run failed with status: {status.value}")

            await asyncio.sleep(poll_interval)

    async def _handle_tool_calls(self, thread_id: str, run):
        """Process required tool calls."""

        tool_outputs = []

        for tool_call in run.required_action.submit_tool_outputs.tool_calls:
            result = await self._execute_tool(
                tool_call.function.name,
                json.loads(tool_call.function.arguments)
            )

            tool_outputs.append({
                "tool_call_id": tool_call.id,
                "output": json.dumps(result)
            })

        self.client.beta.threads.runs.submit_tool_outputs(
            thread_id=thread_id,
            run_id=run.id,
            tool_outputs=tool_outputs
        )

    async def _execute_tool(self, name: str, args: dict) -> dict:
        """Execute a custom tool - override in subclass."""
        raise NotImplementedError(f"Tool not implemented: {name}")

    def _get_latest_response(self, thread_id: str) -> str:
        """Get the assistant's latest message."""

        messages = self.client.beta.threads.messages.list(
            thread_id=thread_id,
            order="desc",
            limit=1
        )

        if messages.data and messages.data[0].role == "assistant":
            return messages.data[0].content[0].text.value

        return ""
```

### Custom Function Tools

Extend assistants with custom tools:

```python
class DataAnalystRunner(AssistantRunner):
    def __init__(self, client, assistant_id: str, database_connection):
        super().__init__(client, assistant_id)
        self.db = database_connection
        self.allowed_tables = ["sales", "customers", "products"]

    def get_tool_definitions(self) -> list[dict]:
        """Define custom tools for the assistant."""

        return [
            {
                "type": "function",
                "function": {
                    "name": "query_database",
                    "description": "Execute a read-only SQL query against the database",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "SQL SELECT query to execute"
                            }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_table_schema",
                    "description": "Get the schema of a database table",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "table_name": {
                                "type": "string",
                                "description": "Name of the table"
                            }
                        },
                        "required": ["table_name"]
                    }
                }
            }
        ]

    async def _execute_tool(self, name: str, args: dict) -> dict:
        """Execute custom tools."""

        if name == "query_database":
            return await self._safe_query(args["query"])

        elif name == "get_table_schema":
            return await self._get_schema(args["table_name"])

        return {"error": f"Unknown tool: {name}"}

    async def _safe_query(self, query: str) -> dict:
        """Execute query with safety checks."""

        # Basic SQL injection prevention
        query_upper = query.upper()

        if any(kw in query_upper for kw in ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER"]):
            return {"error": "Only SELECT queries are allowed"}

        # Check table access
        for table in self.allowed_tables:
            if table.upper() in query_upper:
                break
        else:
            return {"error": f"Access only allowed to: {self.allowed_tables}"}

        try:
            result = await self.db.fetch_all(query)
            return {"data": result, "row_count": len(result)}
        except Exception as e:
            return {"error": str(e)}

    async def _get_schema(self, table_name: str) -> dict:
        """Get table schema."""

        if table_name not in self.allowed_tables:
            return {"error": f"Table not accessible: {table_name}"}

        schema = await self.db.get_table_schema(table_name)
        return {"schema": schema}
```

### File Handling

Handle file uploads for code interpreter and retrieval:

```python
class FileManager:
    def __init__(self, client, storage_client):
        self.client = client
        self.storage = storage_client  # Azure Blob, S3, etc.

    async def upload_for_assistant(
        self,
        file_path: str,
        purpose: str = "assistants"
    ) -> str:
        """Upload file for use with assistant."""

        with open(file_path, "rb") as f:
            file = self.client.files.create(
                file=f,
                purpose=purpose
            )

        return file.id

    async def attach_files_to_thread(
        self,
        thread_id: str,
        file_ids: list[str],
        message: str
    ):
        """Attach files to a thread message."""

        self.client.beta.threads.messages.create(
            thread_id=thread_id,
            role="user",
            content=message,
            file_ids=file_ids
        )

    async def download_generated_files(self, thread_id: str) -> list[str]:
        """Download files generated by code interpreter."""

        messages = self.client.beta.threads.messages.list(thread_id=thread_id)
        downloaded = []

        for message in messages.data:
            if message.role == "assistant":
                for content in message.content:
                    if hasattr(content, "image_file"):
                        file_id = content.image_file.file_id
                        file_data = self.client.files.content(file_id)

                        # Save locally or upload to storage
                        path = f"/tmp/{file_id}.png"
                        with open(path, "wb") as f:
                            f.write(file_data.read())

                        downloaded.append(path)

        return downloaded
```

## Error Handling and Monitoring

```python
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

@dataclass
class RunMetrics:
    run_id: str
    thread_id: str
    status: str
    duration_seconds: float
    prompt_tokens: int
    completion_tokens: int
    tool_calls: int
    error: Optional[str] = None

class MonitoredAssistantRunner(AssistantRunner):
    def __init__(self, client, assistant_id: str, metrics_collector):
        super().__init__(client, assistant_id)
        self.metrics = metrics_collector

    async def run_with_message(self, thread_id: str, message: str, **kwargs) -> str:
        start_time = asyncio.get_event_loop().time()
        run_id = None
        error = None
        tool_calls = 0

        try:
            result = await super().run_with_message(thread_id, message, **kwargs)
            return result

        except Exception as e:
            error = str(e)
            logger.error(f"Run failed: {e}")
            raise

        finally:
            duration = asyncio.get_event_loop().time() - start_time

            if run_id:
                run = self.client.beta.threads.runs.retrieve(
                    thread_id=thread_id,
                    run_id=run_id
                )

                metrics = RunMetrics(
                    run_id=run_id,
                    thread_id=thread_id,
                    status=run.status,
                    duration_seconds=duration,
                    prompt_tokens=run.usage.prompt_tokens if run.usage else 0,
                    completion_tokens=run.usage.completion_tokens if run.usage else 0,
                    tool_calls=tool_calls,
                    error=error
                )

                await self.metrics.record(metrics)
```

## Best Practices

1. **Thread lifecycle management** - Don't create threads for every message
2. **Timeout handling** - Runs can take minutes for complex tasks
3. **File cleanup** - Delete uploaded files when no longer needed
4. **Cost monitoring** - Track token usage per run
5. **Graceful degradation** - Fall back to direct API calls if needed

## Conclusion

The Assistants API simplifies building conversational AI but requires careful production engineering. Focus on thread management, robust polling, and comprehensive monitoring. The patterns here provide a foundation for reliable, scalable assistant deployments.
