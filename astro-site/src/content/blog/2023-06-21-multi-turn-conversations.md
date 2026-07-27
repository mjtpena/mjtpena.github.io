---
title: "Multi-Turn Conversations: Managing State in AI Applications"
author: Michael John Peña
draft: false
date: 2023-06-21
tags:
  - Azure OpenAI
  - Conversations
  - State Management
  - AI
  - Chatbots

---

I wrote "Multi-Turn Conversations: Managing State in AI Applications" to share practical, production-minded guidance on this topic.

## Conversation State Management

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
import json

@dataclass
class Message:
    role: str  # system, user, assistant, function
    content: str
    timestamp: datetime = field(default_factory=datetime.utcnow)
    metadata: Dict = field(default_factory=dict)

    def to_api_format(self) -> dict:
        return {"role": self.role, "content": self.content}

@dataclass
class ConversationState:
    session_id: str
    messages: List[Message] = field(default_factory=list)
    context: Dict = field(default_factory=dict)  # Extracted entities, preferences
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    def add_message(self, role: str, content: str, metadata: dict = None):
        self.messages.append(Message(role, content, metadata=metadata or {}))
        self.updated_at = datetime.utcnow()

    def get_messages_for_api(self, include_system: bool = True) -> List[dict]:
        return [m.to_api_format() for m in self.messages if include_system or m.role != "system"]

    def get_recent_messages(self, n: int) -> List[Message]:
        return self.messages[-n:] if len(self.messages) > n else self.messages
```

## Conversation Manager

```python
class ConversationManager:
    def __init__(self, client, system_prompt: str, max_history: int = 20):
        self.client = client
        self.system_prompt = system_prompt
        self.max_history = max_history
        self.conversations: Dict[str, ConversationState] = {}

    def get_or_create_conversation(self, session_id: str) -> ConversationState:
        if session_id not in self.conversations:
            state = ConversationState(session_id=session_id)
            state.add_message("system", self.system_prompt)
            self.conversations[session_id] = state
        return self.conversations[session_id]

    def chat(self, session_id: str, user_message: str) -> str:
        state = self.get_or_create_conversation(session_id)
        state.add_message("user", user_message)

        # Prepare messages for API
        messages = self._prepare_messages(state)

        # Call API
        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.7
        )

        assistant_message = response.choices[0].message.content
        state.add_message("assistant", assistant_message)

        return assistant_message

    def _prepare_messages(self, state: ConversationState) -> List[dict]:
        """Prepare messages with history management"""
        messages = []

        # Always include system message
        messages.append({"role": "system", "content": self.system_prompt})

        # Add conversation summary if history is long
        if len(state.messages) > self.max_history:
            summary = self._summarize_history(state)
            messages.append({
                "role": "system",
                "content": f"Previous conversation summary: {summary}"
            })
            # Add only recent messages
            recent = state.get_recent_messages(self.max_history // 2)
        else:
            recent = state.messages[1:]  # Skip original system message

        for msg in recent:
            if msg.role != "system":
                messages.append(msg.to_api_format())

        return messages

    def _summarize_history(self, state: ConversationState) -> str:
        """Summarize older conversation history"""
        old_messages = state.messages[1:-self.max_history // 2]

        if not old_messages:
            return "No previous history."

        summary_prompt = f"""Summarize the key points from this conversation:

{chr(10).join([f"{m.role}: {m.content}" for m in old_messages])}

Provide a brief summary of:
1. Main topics discussed
2. Key decisions or conclusions
3. Any user preferences or requirements mentioned"""

        response = self.client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": summary_prompt}],
            max_tokens=200
        )

        return response.choices[0].message.content
```

## Context Extraction

```python
class ContextExtractor:
    """Extract and maintain context from conversations"""

    def __init__(self, client):
        self.client = client

    def extract_context(self, messages: List[Message]) -> dict:
        """Extract entities and context from conversation"""

        extraction_prompt = f"""Analyze this conversation and extract:
1. Named entities (people, organizations, products, locations)
2. User preferences mentioned
3. Key topics discussed
4. Any action items or requests

Conversation:
{chr(10).join([f"{m.role}: {m.content}" for m in messages[-10:]])}

Return as JSON:
{{
  "entities": {{"people": [], "organizations": [], "products": [], "locations": []}},
  "preferences": [],
  "topics": [],
  "action_items": []
}}"""

        response = self.client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": extraction_prompt}],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    def update_context(self, existing: dict, new: dict) -> dict:
        """Merge new context with existing"""
        merged = existing.copy()

        for key in ["entities", "preferences", "topics", "action_items"]:
            if key in new:
                if isinstance(new[key], dict):
                    for subkey, values in new[key].items():
                        if subkey not in merged.get(key, {}):
                            merged.setdefault(key, {})[subkey] = []
                        merged[key][subkey] = list(set(merged[key][subkey] + values))
                elif isinstance(new[key], list):
                    merged[key] = list(set(merged.get(key, []) + new[key]))

        return merged
```

## Conversation Branching

```python
class BranchableConversation:
    """Support conversation branching for what-if scenarios"""

    def __init__(self, manager: ConversationManager):
        self.manager = manager
        self.branches: Dict[str, ConversationState] = {}

    def create_branch(self, session_id: str, branch_name: str) -> str:
        """Create a new branch from current conversation state"""
        original = self.manager.get_or_create_conversation(session_id)

        # Deep copy state
        branch_id = f"{session_id}_{branch_name}"
        branch_state = ConversationState(
            session_id=branch_id,
            messages=original.messages.copy(),
            context=original.context.copy()
        )

        self.branches[branch_id] = branch_state
        return branch_id

    def chat_on_branch(self, branch_id: str, message: str) -> str:
        """Continue conversation on a branch"""
        if branch_id not in self.branches:
            raise ValueError(f"Branch {branch_id} not found")

        state = self.branches[branch_id]
        state.add_message("user", message)

        messages = [m.to_api_format() for m in state.messages]
        response = self.manager.client.chat.completions.create(
            model="gpt-4",
            messages=messages
        )

        assistant_message = response.choices[0].message.content
        state.add_message("assistant", assistant_message)

        return assistant_message

    def merge_branch(self, session_id: str, branch_id: str, summary: str):
        """Merge branch learnings back to main conversation"""
        original = self.manager.get_or_create_conversation(session_id)
        branch = self.branches.get(branch_id)

        if branch:
            # Add summary of branch exploration
            original.add_message(
                "system",
                f"Branch exploration summary: {summary}",
                metadata={"branch_id": branch_id}
            )
```

## Session Persistence

```python
import redis
import pickle

class ConversationStore:
    """Persist conversations to Redis"""

    def __init__(self, redis_url: str, ttl_hours: int = 24):
        self.redis = redis.from_url(redis_url)
        self.ttl = ttl_hours * 3600

    def save(self, state: ConversationState):
        key = f"conversation:{state.session_id}"
        self.redis.setex(
            key,
            self.ttl,
            pickle.dumps(state)
        )

    def load(self, session_id: str) -> Optional[ConversationState]:
        key = f"conversation:{session_id}"
        data = self.redis.get(key)
        if data:
            return pickle.loads(data)
        return None

    def delete(self, session_id: str):
        key = f"conversation:{session_id}"
        self.redis.delete(key)

    def extend_ttl(self, session_id: str):
        key = f"conversation:{session_id}"
        self.redis.expire(key, self.ttl)
```

## Usage Example

```python
# Initialize
client = AzureOpenAI(...)
system_prompt = """You are a helpful customer service assistant.
You can help with orders, products, and general inquiries.
Always be polite and ask clarifying questions when needed."""

manager = ConversationManager(client, system_prompt)
store = ConversationStore("redis://localhost:6379")

# Handle user interaction
def handle_message(session_id: str, user_message: str) -> str:
    # Load existing conversation
    state = store.load(session_id)
    if state:
        manager.conversations[session_id] = state

    # Process message
    response = manager.chat(session_id, user_message)

    # Persist updated state
    store.save(manager.conversations[session_id])
    store.extend_ttl(session_id)

    return response

# Example conversation
session = "user-123"
print(handle_message(session, "Hi, I want to check my order status"))
print(handle_message(session, "The order number is ORD-456"))
print(handle_message(session, "When will it arrive?"))
```

Multi-turn conversation management is essential for production chatbots. Tomorrow, I will cover conversation management strategies.

## Resources

- [Azure OpenAI Chat Completions](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/how-to/chatgpt)
- [Conversation Design](https://cloud.google.com/dialogflow/docs/conversation-design)
- [Redis for Session Storage](https://redis.io/docs/data-types/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
