---
title: "Completion vs Chat APIs in Azure OpenAI: Choosing the Right Approach"
author: Michael John Peña
draft: false
date: 2023-01-17
tags:
  - Azure
  - OpenAI
  - API
  - Architecture
  - AI
---

## API Comparison

### Completion API

The original API for text generation:

```python
import openai

# Completion API
response = openai.Completion.create(
    engine="text-davinci-003",
    prompt="Translate the following to French: Hello, how are you?",
    max_tokens=100,
    temperature=0.7
)

print(response.choices[0].text)
```

### Chat Completion API

Message-based API with roles:

```python
import openai

# Chat Completion API
response = openai.ChatCompletion.create(
    engine="gpt-35-turbo",
    messages=[
        {"role": "system", "content": "You are a translator."},
        {"role": "user", "content": "Translate to French: Hello, how are you?"}
    ],
    max_tokens=100,
    temperature=0.7
)

print(response.choices[0].message.content)
```

## Key Differences

```python
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum

class APIType(Enum):
    COMPLETION = "completion"
    CHAT = "chat"

@dataclass
class APIComparison:
    """Comparison of Completion vs Chat APIs."""

    feature: str
    completion_api: str
    chat_api: str

COMPARISONS = [
    APIComparison(
        feature="Input Format",
        completion_api="Single text prompt",
        chat_api="Array of messages with roles"
    ),
    APIComparison(
        feature="System Prompt",
        completion_api="Must be included in prompt text",
        chat_api="Dedicated system role"
    ),
    APIComparison(
        feature="Conversation History",
        completion_api="Manual management in prompt",
        chat_api="Built-in message array"
    ),
    APIComparison(
        feature="Models",
        completion_api="text-davinci-003, etc.",
        chat_api="gpt-35-turbo, gpt-4"
    ),
    APIComparison(
        feature="Cost Efficiency",
        completion_api="Higher (davinci pricing)",
        chat_api="Lower (turbo pricing)"
    ),
    APIComparison(
        feature="Best For",
        completion_api="Text completion, single-turn",
        chat_api="Conversations, instructions"
    )
]

def print_comparison_table():
    """Print comparison as table."""
    print(f"{'Feature':<25} {'Completion API':<30} {'Chat API':<30}")
    print("-" * 85)
    for comp in COMPARISONS:
        print(f"{comp.feature:<25} {comp.completion_api:<30} {comp.chat_api:<30}")
```

## Building a Unified Client

Create an abstraction that works with both APIs:

```python
from abc import ABC, abstractmethod
from typing import List, Dict, Union, Optional
import openai

@dataclass
class Message:
    """A chat message."""
    role: str  # system, user, assistant
    content: str

@dataclass
class CompletionResponse:
    """Unified response format."""
    content: str
    tokens_used: int
    model: str
    finish_reason: str

class LLMClient(ABC):
    """Abstract LLM client."""

    @abstractmethod
    def generate(
        self,
        prompt: Union[str, List[Message]],
        max_tokens: int = 500,
        **kwargs
    ) -> CompletionResponse:
        pass

class CompletionClient(LLMClient):
    """Client for Completion API."""

    def __init__(self, deployment: str):
        self.deployment = deployment

    def generate(
        self,
        prompt: Union[str, List[Message]],
        max_tokens: int = 500,
        **kwargs
    ) -> CompletionResponse:
        # Convert messages to prompt if needed
        if isinstance(prompt, list):
            prompt = self._messages_to_prompt(prompt)

        response = openai.Completion.create(
            engine=self.deployment,
            prompt=prompt,
            max_tokens=max_tokens,
            **kwargs
        )

        return CompletionResponse(
            content=response.choices[0].text.strip(),
            tokens_used=response.usage.total_tokens,
            model=response.model,
            finish_reason=response.choices[0].finish_reason
        )

    def _messages_to_prompt(self, messages: List[Message]) -> str:
        """Convert chat messages to completion prompt."""
        parts = []
        for msg in messages:
            if msg.role == "system":
                parts.append(f"System: {msg.content}")
            elif msg.role == "user":
                parts.append(f"Human: {msg.content}")
            elif msg.role == "assistant":
                parts.append(f"Assistant: {msg.content}")
        parts.append("Assistant:")
        return "\n\n".join(parts)

class ChatClient(LLMClient):
    """Client for Chat Completion API."""

    def __init__(self, deployment: str):
        self.deployment = deployment

    def generate(
        self,
        prompt: Union[str, List[Message]],
        max_tokens: int = 500,
        **kwargs
    ) -> CompletionResponse:
        # Convert string to messages if needed
        if isinstance(prompt, str):
            messages = [Message(role="user", content=prompt)]
        else:
            messages = prompt

        response = openai.ChatCompletion.create(
            engine=self.deployment,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            max_tokens=max_tokens,
            **kwargs
        )

        return CompletionResponse(
            content=response.choices[0].message.content,
            tokens_used=response.usage.total_tokens,
            model=response.model,
            finish_reason=response.choices[0].finish_reason
        )

class UnifiedClient:
    """Unified client that can use either API."""

    def __init__(
        self,
        completion_deployment: Optional[str] = None,
        chat_deployment: Optional[str] = None,
        default_api: APIType = APIType.CHAT
    ):
        self.completion_client = CompletionClient(completion_deployment) if completion_deployment else None
        self.chat_client = ChatClient(chat_deployment) if chat_deployment else None
        self.default_api = default_api

    def generate(
        self,
        prompt: Union[str, List[Message]],
        api_type: Optional[APIType] = None,
        **kwargs
    ) -> CompletionResponse:
        """Generate using specified or default API."""
        api = api_type or self.default_api

        if api == APIType.COMPLETION:
            if not self.completion_client:
                raise ValueError("Completion deployment not configured")
            return self.completion_client.generate(prompt, **kwargs)
        else:
            if not self.chat_client:
                raise ValueError("Chat deployment not configured")
            return self.chat_client.generate(prompt, **kwargs)

# Usage
client = UnifiedClient(
    completion_deployment="text-davinci-003",
    chat_deployment="gpt-35-turbo",
    default_api=APIType.CHAT
)

# Use chat API (default)
result = client.generate("What is Azure?")

# Explicitly use completion API
result = client.generate(
    "Complete this sentence: Azure is",
    api_type=APIType.COMPLETION
)
```

## When to Use Each API

```python
class APISelector:
    """Help select the appropriate API."""

    USE_CASES = {
        APIType.COMPLETION: [
            "Text completion (finish a sentence/paragraph)",
            "Single-turn text generation",
            "Legacy applications using davinci",
            "Fill-in-the-blank tasks",
            "When you need fine-grained prompt control"
        ],
        APIType.CHAT: [
            "Conversational applications",
            "Multi-turn dialogues",
            "Instruction-following tasks",
            "When you need system prompts",
            "Cost-sensitive applications (cheaper)",
            "GPT-4 access (chat only)"
        ]
    }

    RECOMMENDATIONS = {
        "chatbot": APIType.CHAT,
        "code_generation": APIType.CHAT,
        "text_completion": APIType.COMPLETION,
        "summarization": APIType.CHAT,
        "translation": APIType.CHAT,
        "qa": APIType.CHAT,
        "creative_writing": APIType.CHAT,
        "autocomplete": APIType.COMPLETION,
        "classification": APIType.CHAT,
        "extraction": APIType.CHAT
    }

    @classmethod
    def recommend(cls, task: str) -> APIType:
        """Recommend API for a task."""
        task_lower = task.lower()

        # Check direct matches
        if task_lower in cls.RECOMMENDATIONS:
            return cls.RECOMMENDATIONS[task_lower]

        # Check keywords
        if any(kw in task_lower for kw in ["chat", "conversation", "dialogue"]):
            return APIType.CHAT

        if any(kw in task_lower for kw in ["complete", "finish", "continue"]):
            return APIType.COMPLETION

        # Default to chat (more versatile and cheaper)
        return APIType.CHAT

    @classmethod
    def explain_choice(cls, api_type: APIType) -> List[str]:
        """Explain why to use this API."""
        return cls.USE_CASES.get(api_type, [])

# Usage
api = APISelector.recommend("build a customer support chatbot")
print(f"Recommended: {api.value}")
print("Reasons:")
for reason in APISelector.explain_choice(api):
    print(f"  - {reason}")
```

## Migrating from Completion to Chat

```python
class MigrationHelper:
    """Help migrate from Completion to Chat API."""

    @staticmethod
    def convert_prompt_to_messages(
        prompt: str,
        system_message: Optional[str] = None
    ) -> List[Dict[str, str]]:
        """Convert a completion prompt to chat messages."""
        messages = []

        # Add system message if provided
        if system_message:
            messages.append({
                "role": "system",
                "content": system_message
            })

        # Try to detect conversation structure
        lines = prompt.strip().split('\n')

        current_role = "user"
        current_content = []

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Detect role markers
            if line.startswith(("Human:", "User:", "Q:")):
                if current_content:
                    messages.append({
                        "role": current_role,
                        "content": " ".join(current_content)
                    })
                current_role = "user"
                current_content = [line.split(":", 1)[-1].strip()]

            elif line.startswith(("Assistant:", "AI:", "A:")):
                if current_content:
                    messages.append({
                        "role": current_role,
                        "content": " ".join(current_content)
                    })
                current_role = "assistant"
                current_content = [line.split(":", 1)[-1].strip()]

            elif line.startswith("System:"):
                # Move system content to beginning
                system_content = line.split(":", 1)[-1].strip()
                if messages and messages[0]["role"] == "system":
                    messages[0]["content"] += " " + system_content
                else:
                    messages.insert(0, {"role": "system", "content": system_content})

            else:
                current_content.append(line)

        # Add remaining content
        if current_content:
            messages.append({
                "role": current_role,
                "content": " ".join(current_content)
            })

        return messages

    @staticmethod
    def migrate_parameters(completion_params: dict) -> dict:
        """Migrate Completion API parameters to Chat API."""
        chat_params = {}

        # Direct mappings
        direct_mappings = [
            "max_tokens", "temperature", "top_p",
            "frequency_penalty", "presence_penalty", "stop"
        ]

        for param in direct_mappings:
            if param in completion_params:
                chat_params[param] = completion_params[param]

        # Renamed parameters
        if "engine" in completion_params:
            # Might need to map model name
            engine = completion_params["engine"]
            if "davinci" in engine.lower():
                chat_params["engine"] = "gpt-35-turbo"  # or appropriate chat model
            else:
                chat_params["engine"] = engine

        # Handle prompt
        if "prompt" in completion_params:
            chat_params["messages"] = MigrationHelper.convert_prompt_to_messages(
                completion_params["prompt"]
            )

        # Note: 'n', 'best_of', 'logprobs' work differently or aren't available

        return chat_params

# Example migration
old_code = {
    "engine": "text-davinci-003",
    "prompt": """System: You are a helpful assistant.
```
