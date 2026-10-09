---
title: "Assistants API Deep Dive: Threads and Messages"
description: "Threads and Messages are the state management primitives in the Assistants API, and understanding how they work changes how you architect multi-turn…"
author: "Michael John Peña"
draft: false
date: 2023-11-25
tags: ["OpenAI", "Assistants API", "Threads", "Conversations", "AI"]
---

Threads and Messages are the state management primitives in the Assistants API, and understanding how they work changes how you architect multi-turn conversational applications. A Thread is a persistent conversation history stored server-side by the Assistants API — you create it once, add Messages to it, and the API manages the context window as the conversation grows. Messages have a role (user or assistant) and content (text or files), and they accumulate in the Thread chronologically. When you create a Run against a Thread, the Assistants API retrieves the Thread history, constructs the prompt (respecting the model's context window limits through automatic truncation), and runs the model. The implication: you don't need to maintain conversation history in your application — the Thread is the conversation, and you only need to store the Thread ID to resume a conversation. The limitation to design around: Thread storage is per-OpenAI-organisation, not portable, and Threads expire after 30 days of inactivity (as of the current API).

## Thread Architecture

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
import json

@dataclass
class MessageContent:
    type: str  # "text", "image_file", "file_path"
    data: dict

@dataclass
class Message:
    id: str
    role: str  # "user" or "assistant"
    content: List[MessageContent]
    created_at: datetime
    thread_id: str
    file_ids: List[str] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)

@dataclass
class Thread:
    id: str
    created_at: datetime
    metadata: Dict = field(default_factory=dict)
    messages: List[Message] = field(default_factory=list)

class ThreadManager:
    def __init__(self, client):
        self.client = client
        self.threads: Dict[str, Thread] = {}

    def create_thread(self, metadata: Dict = None) -> Thread:
        """Create a new conversation thread."""
        thread = self.client.beta.threads.create(
            metadata=metadata or {}
        )

        local_thread = Thread(
            id=thread.id,
            created_at=datetime.now(),
            metadata=metadata or {}
        )
        self.threads[thread.id] = local_thread

        return local_thread

    def get_thread(self, thread_id: str) -> Thread:
        """Retrieve a thread with its messages."""
        thread = self.client.beta.threads.retrieve(thread_id)
        messages = self.client.beta.threads.messages.list(thread_id)

        local_thread = Thread(
            id=thread.id,
            created_at=datetime.fromtimestamp(thread.created_at),
            metadata=thread.metadata or {}
        )

        for msg in messages.data:
            local_thread.messages.append(Message(
                id=msg.id,
                role=msg.role,
                content=[MessageContent(c.type, {"value": c.text.value if hasattr(c, 'text') else str(c)})
                        for c in msg.content],
                created_at=datetime.fromtimestamp(msg.created_at),
                thread_id=thread_id,
                file_ids=msg.file_ids or []
            ))

        return local_thread

    def delete_thread(self, thread_id: str) -> bool:
        """Delete a thread and all its messages."""
        self.client.beta.threads.delete(thread_id)
        if thread_id in self.threads:
            del self.threads[thread_id]
        return True
```

## Advanced Message Management

```python
class MessageManager:
    def __init__(self, client):
        self.client = client

    def add_message(
        self,
        thread_id: str,
        content: str,
        role: str = "user",
        file_ids: List[str] = None,
        metadata: Dict = None
    ) -> Message:
        """Add a message to a thread."""
        message = self.client.beta.threads.messages.create(
            thread_id=thread_id,
            role=role,
            content=content,
            file_ids=file_ids or [],
            metadata=metadata or {}
        )

        return Message(
            id=message.id,
            role=message.role,
            content=[MessageContent("text", {"value": content})],
            created_at=datetime.now(),
            thread_id=thread_id,
            file_ids=file_ids or [],
            metadata=metadata or {}
        )

    def get_messages(
        self,
        thread_id: str,
        limit: int = 20,
        order: str = "desc",
        after: str = None,
        before: str = None
    ) -> List[Message]:
        """Get messages with pagination support."""
        params = {
            "limit": limit,
            "order": order
        }
        if after:
            params["after"] = after
        if before:
            params["before"] = before

        messages = self.client.beta.threads.messages.list(
            thread_id=thread_id,
            **params
        )

        return [
            Message(
                id=msg.id,
                role=msg.role,
                content=[MessageContent(c.type, self._extract_content(c))
                        for c in msg.content],
                created_at=datetime.fromtimestamp(msg.created_at),
                thread_id=thread_id,
                file_ids=msg.file_ids or [],
                metadata=msg.metadata or {}
            )
            for msg in messages.data
        ]

    def _extract_content(self, content) -> dict:
        """Extract content based on type."""
        if content.type == "text":
            return {
                "value": content.text.value,
                "annotations": [
                    {"type": a.type, "text": a.text}
                    for a in content.text.annotations
                ] if content.text.annotations else []
            }
        elif content.type == "image_file":
            return {"file_id": content.image_file.file_id}
        return {}

    def get_conversation_context(
        self,
        thread_id: str,
        max_messages: int = 10
    ) -> str:
        """Get conversation context as formatted string."""
        messages = self.get_messages(thread_id, limit=max_messages, order="asc")

        context_parts = []
        for msg in messages:
            role = "User" if msg.role == "user" else "Assistant"
            content = msg.content[0].data.get("value", "") if msg.content else ""
            context_parts.append(f"{role}: {content}")

        return "\n\n".join(context_parts)
```

## Thread Persistence and Recovery

```python
import sqlite3
from contextlib import contextmanager

class ThreadPersistence:
    """Persist thread metadata for recovery and analytics."""

    def __init__(self, db_path: str = "threads.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize the database schema."""
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS threads (
                    thread_id TEXT PRIMARY KEY,
                    user_id TEXT,
                    assistant_id TEXT,
                    created_at TIMESTAMP,
                    last_active TIMESTAMP,
                    metadata TEXT,
                    status TEXT DEFAULT 'active'
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS thread_summaries (
                    thread_id TEXT,
                    summary TEXT,
                    message_count INTEGER,
                    updated_at TIMESTAMP,
                    FOREIGN KEY (thread_id) REFERENCES threads(thread_id)
                )
            """)

    @contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def save_thread(
        self,
        thread_id: str,
        user_id: str,
        assistant_id: str,
        metadata: Dict = None
    ):
        """Save thread information."""
        with self._get_connection() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO threads
                (thread_id, user_id, assistant_id, created_at, last_active, metadata, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                thread_id,
                user_id,
                assistant_id,
                datetime.now(),
                datetime.now(),
                json.dumps(metadata or {}),
                'active'
            ))

    def get_user_threads(
        self,
        user_id: str,
        status: str = 'active'
    ) -> List[Dict]:
        """Get all threads for a user."""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT thread_id, assistant_id, created_at, last_active, metadata
                FROM threads
                WHERE user_id = ? AND status = ?
                ORDER BY last_active DESC
            """, (user_id, status))

            return [
                {
                    "thread_id": row[0],
                    "assistant_id": row[1],
                    "created_at": row[2],
                    "last_active": row[3],
                    "metadata": json.loads(row[4])
                }
                for row in cursor.fetchall()
            ]

    def update_activity(self, thread_id: str):
        """Update last activity timestamp."""
        with self._get_connection() as conn:
            conn.execute("""
                UPDATE threads SET last_active = ? WHERE thread_id = ?
            """, (datetime.now(), thread_id))

    def archive_thread(self, thread_id: str):
        """Archive a thread."""
        with self._get_connection() as conn:
            conn.execute("""
                UPDATE threads SET status = 'archived' WHERE thread_id = ?
            """, (thread_id,))
```

## Conversation Flow Control

```python
class ConversationController:
    """Control conversation flow and handle multi-turn interactions."""

    def __init__(self, client, assistant_id: str):
        self.client = client
        self.assistant_id = assistant_id
        self.thread_manager = ThreadManager(client)
        self.message_manager = MessageManager(client)

    def start_conversation(
        self,
        initial_message: str,
        metadata: Dict = None
    ) -> Dict:
        """Start a new conversation."""
        thread = self.thread_manager.create_thread(metadata)

        # Add initial message
        self.message_manager.add_message(thread.id, initial_message)

        # Run assistant
        response = self._run_and_wait(thread.id)

        return {
            "thread_id": thread.id,
            "response": response
        }

    def continue_conversation(
        self,
        thread_id: str,
        message: str
    ) -> str:
        """Continue an existing conversation."""
        self.message_manager.add_message(thread_id, message)
        return self._run_and_wait(thread_id)

    def _run_and_wait(self, thread_id: str) -> str:
        """Run assistant and wait for response."""
        import time

        run = self.client.beta.threads.runs.create(
            thread_id=thread_id,
            assistant_id=self.assistant_id
        )

        while run.status in ["queued", "in_progress"]:
            time.sleep(0.5)
            run = self.client.beta.threads.runs.retrieve(
                thread_id=thread_id,
                run_id=run.id
            )

        if run.status == "completed":
            messages = self.message_manager.get_messages(thread_id, limit=1)
            if messages and messages[0].role == "assistant":
                return messages[0].content[0].data.get("value", "")

        return f"Error: Run ended with status {run.status}"

    def get_conversation_summary(self, thread_id: str) -> str:
        """Generate a summary of the conversation."""
        context = self.message_manager.get_conversation_context(thread_id)

        # Use the assistant to summarize
        summary_thread = self.thread_manager.create_thread()
        self.message_manager.add_message(
            summary_thread.id,
            f"Summarize this conversation in 2-3 sentences:\n\n{context}"
        )

        summary = self._run_and_wait(summary_thread.id)
        self.thread_manager.delete_thread(summary_thread.id)

        return summary
```

## Best Practices

1. **Implement thread persistence** for user session recovery
2. **Set message limits** to manage context and costs
3. **Use metadata** to track conversation state
4. **Clean up old threads** to manage storage
5. **Handle interruptions** gracefully with run cancellation

Tomorrow, we'll explore file handling and the retrieval tool in the Assistants API!
