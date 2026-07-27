---
title: "Building a Personal AI Assistant with Semantic Kernel"
author: Michael John Peña
draft: false
date: 2025-12-20
tags:
  - Semantic-Kernel
  - AI
  - Personal-Assistant
  - Tutorial
  - Python

---

I wrote "Building a Personal AI Assistant with Semantic Kernel" to share practical, production-minded guidance on this topic.

## Architecture Overview

```
User Input -> Semantic Kernel -> Plugin Selection -> Tool Execution -> Response
                   |
            Memory Store (conversation history)
                   |
            Planner (multi-step tasks)
```

## Project Setup

```bash
pip install semantic-kernel openai python-dotenv
```

## Core Assistant Implementation

```python
import os
from semantic_kernel import Kernel
from semantic_kernel.connectors.ai.open_ai import AzureChatCompletion
from semantic_kernel.contents import ChatHistory
from semantic_kernel.functions import kernel_function

# Initialize kernel
kernel = Kernel()
kernel.add_service(AzureChatCompletion(
    deployment_name=os.getenv("AZURE_OPENAI_DEPLOYMENT"),
    endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_KEY")
))

# Chat history for context
chat_history = ChatHistory()
chat_history.add_system_message("""You are a helpful personal assistant. You can:
- Manage tasks and reminders
- Answer questions
- Help with calculations
- Search your knowledge base
Be concise but friendly.""")
```

## Creating Plugins

```python
class TaskPlugin:
    def __init__(self):
        self.tasks = []

    @kernel_function(description="Add a new task to the list")
    def add_task(self, task: str, priority: str = "medium") -> str:
        self.tasks.append({"task": task, "priority": priority, "done": False})
        return f"Added task: {task} (priority: {priority})"

    @kernel_function(description="List all pending tasks")
    def list_tasks(self) -> str:
        pending = [t for t in self.tasks if not t["done"]]
        if not pending:
            return "No pending tasks!"

        result = "Your tasks:\n"
        for i, t in enumerate(pending, 1):
            result += f"{i}. [{t['priority']}] {t['task']}\n"
        return result

    @kernel_function(description="Mark a task as complete")
    def complete_task(self, task_number: int) -> str:
        pending = [t for t in self.tasks if not t["done"]]
        if 0 < task_number <= len(pending):
            pending[task_number - 1]["done"] = True
            return f"Completed: {pending[task_number - 1]['task']}"
        return "Task not found"

class CalculatorPlugin:
    @kernel_function(description="Perform a calculation")
    def calculate(self, expression: str) -> str:
        try:
            # Safe evaluation of math expressions
            allowed = set("0123456789+-*/.() ")
            if all(c in allowed for c in expression):
                result = eval(expression)
                return f"{expression} = {result}"
            return "Invalid expression"
        except Exception as e:
            return f"Error: {str(e)}"

# Register plugins
kernel.add_plugin(TaskPlugin(), "tasks")
kernel.add_plugin(CalculatorPlugin(), "calculator")
```

## Interactive Chat Loop

```python
from semantic_kernel.connectors.ai.function_choice_behavior import FunctionChoiceBehavior
from semantic_kernel.connectors.ai.open_ai import OpenAIChatPromptExecutionSettings

async def chat():
    settings = OpenAIChatPromptExecutionSettings(
        function_choice_behavior=FunctionChoiceBehavior.Auto()
    )

    print("Personal Assistant Ready! Type 'quit' to exit.\n")

    while True:
        user_input = input("You: ").strip()
        if user_input.lower() == 'quit':
            break

        chat_history.add_user_message(user_input)

        response = await kernel.invoke_prompt(
            prompt="{{$chat_history}}",
            arguments={"chat_history": chat_history},
            settings=settings
        )

        assistant_message = str(response)
        chat_history.add_assistant_message(assistant_message)
        print(f"Assistant: {assistant_message}\n")

# Run
import asyncio
asyncio.run(chat())
```

## Example Conversation

```
You: Add a task to buy groceries with high priority
Assistant: Added task: buy groceries (priority: high)

You: What's on my list?
Assistant: Your tasks:
1. [high] buy groceries

You: What's 15% tip on $85.50?
Assistant: 85.50 * 0.15 = 12.825
A 15% tip on $85.50 would be $12.83
```

This foundation can be extended with calendar integration, email access, and more plugins. Perfect for a holiday coding project!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
