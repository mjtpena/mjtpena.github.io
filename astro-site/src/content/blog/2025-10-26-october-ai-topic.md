---
title: "Building Copilot Extensions with Azure OpenAI Assistants API"
description: "The Assistants API provides the foundation for building powerful, context-aware AI assistants that integrate with enterprise systems."
author: Michael John Peña
draft: false
date: 2025-10-26
tags:
  - Copilot
  - Assistants API
  - Azure OpenAI
  - Extensions
  - Enterprise AI
---

## Creating an Assistant with Tools

Define an assistant with custom capabilities:

```python
from openai import AzureOpenAI
import json

class CopilotBuilder:
    def __init__(self, client: AzureOpenAI):
        self.client = client

    def create_assistant(
        self,
        name: str,
        instructions: str,
        tools: list[dict]
    ) -> str:
        """Create an assistant with specified tools."""

        assistant = self.client.beta.assistants.create(
            name=name,
            instructions=instructions,
            model="gpt-4",
            tools=tools
        )

        return assistant.id

    def create_enterprise_copilot(self) -> str:
        """Create an enterprise-ready copilot assistant."""

        tools = [
            {
                "type": "function",
                "function": {
                    "name": "search_knowledge_base",
                    "description": "Search the enterprise knowledge base for relevant information",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"},
                            "category": {"type": "string", "description": "Category filter", "enum": ["hr", "it", "finance", "general"]}
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "create_ticket",
                    "description": "Create a support ticket in the helpdesk system",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "priority": {"type": "string", "enum": ["low", "medium", "high"]}
                        },
                        "required": ["title", "description"]
                    }
                }
            },
            {"type": "code_interpreter"}
        ]

        instructions = """You are an enterprise assistant helping employees with their questions.

You can:
1. Search the knowledge base for policies, procedures, and documentation
2. Create support tickets for issues that need human attention
3. Analyze data and create visualizations using code interpreter

Always be helpful, professional, and protect sensitive information."""

        return self.create_assistant("Enterprise Copilot", instructions, tools)
```

## Managing Conversations with Threads

Handle multi-turn conversations:

```python
class ConversationManager:
    def __init__(self, client: AzureOpenAI, assistant_id: str):
        self.client = client
        self.assistant_id = assistant_id
        self.tool_handlers = {}

    def register_tool_handler(self, tool_name: str, handler):
        """Register a handler for a tool."""
        self.tool_handlers[tool_name] = handler

    def start_conversation(self) -> str:
        """Start a new conversation thread."""
        thread = self.client.beta.threads.create()
        return thread.id

    def send_message(self, thread_id: str, message: str) -> str:
        """Send a message and get response."""

        # Add user message
        self.client.beta.threads.messages.create(
            thread_id=thread_id,
            role="user",
            content=message
        )

        # Run the assistant
        run = self.client.beta.threads.runs.create(
            thread_id=thread_id,
            assistant_id=self.assistant_id
        )

        # Wait for completion and handle tool calls
        while run.status in ["queued", "in_progress", "requires_action"]:
            run = self.client.beta.threads.runs.retrieve(thread_id=thread_id, run_id=run.id)

            if run.status == "requires_action":
                run = self._handle_tool_calls(thread_id, run)

        # Get the response
        messages = self.client.beta.threads.messages.list(thread_id=thread_id)
        return messages.data[0].content[0].text.value

    def _handle_tool_calls(self, thread_id: str, run):
        """Handle tool calls from the assistant."""
        tool_outputs = []

        for tool_call in run.required_action.submit_tool_outputs.tool_calls:
            handler = self.tool_handlers.get(tool_call.function.name)
            if handler:
                args = json.loads(tool_call.function.arguments)
                result = handler(**args)
                tool_outputs.append({"tool_call_id": tool_call.id, "output": json.dumps(result)})

        return self.client.beta.threads.runs.submit_tool_outputs(thread_id=thread_id, run_id=run.id, tool_outputs=tool_outputs)
```

The Assistants API provides the foundation for building powerful, context-aware AI assistants that integrate with enterprise systems.
