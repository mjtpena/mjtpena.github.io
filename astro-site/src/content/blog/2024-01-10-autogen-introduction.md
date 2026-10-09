---
title: "AutoGen Introduction: Microsoft's Multi-Agent Framework"
description: "I've used AutoGen to prototype multi-agent workflows that handle planning, tool use, and execution. This practical introduction focuses on the patterns that…"
author: Michael John Peña
draft: false
date: 2024-01-10
tags:
  - AutoGen
  - Microsoft
  - AI Agents
  - Multi-Agent
  - Python
---

I've used AutoGen to prototype multi-agent workflows that handle planning, tool use, and execution. This practical introduction focuses on the patterns that helped those prototypes become repeatable components.

## What is AutoGen?

AutoGen provides:
- **Conversable agents** that can chat with each other
- **Code execution** in sandboxed environments
- **Human-in-the-loop** integration
- **Flexible conversation patterns**
- **LLM agnostic** - works with OpenAI, Azure OpenAI, and local models

## Installation and Setup

```bash
pip install pyautogen
```

```python
import autogen
from autogen import ConversableAgent, AssistantAgent, UserProxyAgent

# Configuration for Azure OpenAI
config_list = [
    {
        "model": "gpt-4-turbo",
        "api_key": "your-api-key",
        "base_url": "https://your-resource.openai.azure.com/",
        "api_type": "azure",
        "api_version": "2024-02-15-preview"
    }
]

llm_config = {
    "config_list": config_list,
    "temperature": 0.7,
    "timeout": 120
}
```

## Basic Two-Agent Conversation

The simplest AutoGen pattern - two agents talking:

```python
# Create an assistant agent
assistant = AssistantAgent(
    name="assistant",
    llm_config=llm_config,
    system_message="""You are a helpful AI assistant.
    You help users with coding, analysis, and problem-solving.
    When you need to write code, provide complete, runnable examples."""
)

# Create a user proxy that can execute code
user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="TERMINATE",  # Only ask for input when conversation ends
    max_consecutive_auto_reply=10,
    is_termination_msg=lambda x: x.get("content", "").rstrip().endswith("TERMINATE"),
    code_execution_config={
        "work_dir": "coding_workspace",
        "use_docker": False  # Set True for safer execution
    }
)

# Start a conversation
user_proxy.initiate_chat(
    assistant,
    message="Write a Python script that fetches weather data from a public API and displays it nicely."
)
```

## Custom Agents

Create specialized agents with specific capabilities:

```python
class DataAnalystAgent(AssistantAgent):
    """Agent specialized in data analysis."""

    DEFAULT_SYSTEM_MESSAGE = """You are an expert data analyst.
    Your capabilities:
    - Write Python code for data analysis using pandas, numpy, matplotlib
    - Perform statistical analysis
    - Create visualizations
    - Explain insights clearly

    Always:
    - Include data validation
    - Handle edge cases
    - Provide clear explanations with your code
    - Use matplotlib for visualizations (save to file, don't show())
    """

    def __init__(self, name="data_analyst", **kwargs):
        super().__init__(
            name=name,
            system_message=self.DEFAULT_SYSTEM_MESSAGE,
            **kwargs
        )

class CodeReviewerAgent(AssistantAgent):
    """Agent specialized in code review."""

    DEFAULT_SYSTEM_MESSAGE = """You are an expert code reviewer.
    Your responsibilities:
    - Review code for bugs, security issues, and best practices
    - Suggest improvements
    - Verify code correctness
    - Check error handling

    Be constructive and specific in your feedback.
    If code is good, say APPROVE and explain why.
    If changes needed, say REVISE and list specific issues.
    """

    def __init__(self, name="code_reviewer", **kwargs):
        super().__init__(
            name=name,
            system_message=self.DEFAULT_SYSTEM_MESSAGE,
            **kwargs
        )

# Usage
analyst = DataAnalystAgent(llm_config=llm_config)
reviewer = CodeReviewerAgent(llm_config=llm_config)

# Analyst writes code, reviewer reviews
user_proxy.initiate_chat(
    analyst,
    message="Analyze this CSV data and find correlations between columns."
)
```

## Group Chat Pattern

Multiple agents collaborating:

```python
from autogen import GroupChat, GroupChatManager

# Define specialized agents
planner = AssistantAgent(
    name="planner",
    llm_config=llm_config,
    system_message="""You are a project planner.
    Break down tasks into steps and assign to appropriate team members.
    Available team: coder, reviewer, tester."""
)

coder = AssistantAgent(
    name="coder",
    llm_config=llm_config,
    system_message="""You are a Python developer.
    Write clean, well-documented code.
    Wait for the planner's instructions before coding."""
)

reviewer = AssistantAgent(
    name="reviewer",
    llm_config=llm_config,
    system_message="""You are a code reviewer.
    Review code from the coder for bugs and improvements.
    Be specific and constructive."""
)

tester = AssistantAgent(
    name="tester",
    llm_config=llm_config,
    system_message="""You are a QA tester.
    Write test cases for the code.
    Execute tests and report results."""
)

user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="TERMINATE",
    code_execution_config={"work_dir": "workspace"}
)

# Create group chat
group_chat = GroupChat(
    agents=[user_proxy, planner, coder, reviewer, tester],
    messages=[],
    max_round=20,
    speaker_selection_method="auto"  # LLM decides who speaks next
)

manager = GroupChatManager(
    groupchat=group_chat,
    llm_config=llm_config
)

# Start the collaboration
user_proxy.initiate_chat(
    manager,
    message="Build a REST API endpoint that returns weather data for a given city."
)
```

## Custom Speaker Selection

Control conversation flow:

```python
def custom_speaker_selection(last_speaker, group_chat):
    """Custom logic for selecting next speaker."""

    messages = group_chat.messages

    if len(messages) == 0:
        return group_chat.agent_by_name("planner")

    last_message = messages[-1]["content"].lower()

    # Route based on message content
    if "code review" in last_message or last_speaker.name == "coder":
        return group_chat.agent_by_name("reviewer")

    if "approved" in last_message:
        return group_chat.agent_by_name("tester")

    if "test" in last_message and "pass" in last_message:
        return group_chat.agent_by_name("user_proxy")

    if last_speaker.name == "planner":
        return group_chat.agent_by_name("coder")

    # Default: let LLM decide
    return "auto"

group_chat = GroupChat(
    agents=[user_proxy, planner, coder, reviewer, tester],
    messages=[],
    max_round=20,
    speaker_selection_method=custom_speaker_selection
)
```

## Function Calling with Agents

Register functions for agents to call:

```python
from typing import Annotated

# Define functions
def get_weather(
    city: Annotated[str, "The city name"]
) -> str:
    """Get current weather for a city."""
    # Mock implementation
    return f"Weather in {city}: 72°F, Sunny"

def search_database(
    query: Annotated[str, "SQL query to execute"]
) -> str:
    """Execute a database query."""
    # Mock implementation
    return "Query results: 150 records found"

def send_email(
    to: Annotated[str, "Recipient email"],
    subject: Annotated[str, "Email subject"],
    body: Annotated[str, "Email body"]
) -> str:
    """Send an email."""
    return f"Email sent to {to}"

# Create agent with function calling
assistant = AssistantAgent(
    name="assistant",
    llm_config=llm_config,
    system_message="You are a helpful assistant with access to weather, database, and email tools."
)

user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    code_execution_config=False  # Don't execute code, just call functions
)

# Register functions
assistant.register_for_llm(
    name="get_weather",
    description="Get current weather for a city"
)(get_weather)

assistant.register_for_llm(
    name="search_database",
    description="Execute a database query"
)(search_database)

assistant.register_for_llm(
    name="send_email",
    description="Send an email"
)(send_email)

# Register execution with user_proxy
user_proxy.register_for_execution(name="get_weather")(get_weather)
user_proxy.register_for_execution(name="search_database")(search_database)
user_proxy.register_for_execution(name="send_email")(send_email)

# Chat with function calling
user_proxy.initiate_chat(
    assistant,
    message="What's the weather in Seattle? Then query the database for users in Seattle and email the results to admin@company.com"
)
```

## RAG with AutoGen

Integrate retrieval augmented generation:

```python
from autogen.agentchat.contrib.retrieve_assistant_agent import RetrieveAssistantAgent
from autogen.agentchat.contrib.retrieve_user_proxy_agent import RetrieveUserProxyAgent

# Create RAG-enabled agents
rag_assistant = RetrieveAssistantAgent(
    name="rag_assistant",
    llm_config=llm_config,
    system_message="You answer questions based on the retrieved context."
)

rag_proxy = RetrieveUserProxyAgent(
    name="rag_proxy",
    human_input_mode="NEVER",
    retrieve_config={
        "task": "qa",
        "docs_path": "./documents",  # Path to your documents
        "chunk_token_size": 1000,
        "model": config_list[0]["model"],
        "collection_name": "my_collection",
        "get_or_create": True
    }
)

# Query with RAG
rag_proxy.initiate_chat(
    rag_assistant,
    problem="What are the key features of our product?"
)
```

## Practical Example: Code Generation Pipeline

```python
class CodeGenPipeline:
    """Multi-agent code generation pipeline."""

    def __init__(self, llm_config):
        self.llm_config = llm_config
        self._setup_agents()

    def _setup_agents(self):
        self.architect = AssistantAgent(
            name="architect",
            llm_config=self.llm_config,
            system_message="""You are a software architect.
            Design the structure and approach before coding.
            Output a clear plan with:
            - Classes/functions needed
            - Data flow
            - Key algorithms
            Don't write code, just the design."""
        )

        self.coder = AssistantAgent(
            name="coder",
            llm_config=self.llm_config,
            system_message="""You are an expert Python developer.
            Implement code based on the architect's design.
            Write clean, documented, production-ready code."""
        )

        self.reviewer = AssistantAgent(
            name="reviewer",
            llm_config=self.llm_config,
            system_message="""You are a senior code reviewer.
            Review code for:
            - Correctness
            - Edge cases
            - Security
            - Performance
            Say APPROVED if good, or list specific issues."""
        )

        self.executor = UserProxyAgent(
            name="executor",
            human_input_mode="NEVER",
            max_consecutive_auto_reply=5,
            code_execution_config={
                "work_dir": "pipeline_workspace",
                "use_docker": False
            }
        )

    async def generate(self, requirement: str) -> dict:
        """Generate code through the pipeline."""

        # Phase 1: Architecture
        self.executor.initiate_chat(
            self.architect,
            message=f"Design the architecture for: {requirement}"
        )
        design = self.executor.last_message()["content"]

        # Phase 2: Implementation
        self.executor.initiate_chat(
            self.coder,
            message=f"Implement this design:\n{design}"
        )
        code = self.executor.last_message()["content"]

        # Phase 3: Review
        self.executor.initiate_chat(
            self.reviewer,
            message=f"Review this code:\n{code}"
        )
        review = self.executor.last_message()["content"]

        # Phase 4: Execute if approved
        if "APPROVED" in review.upper():
            # Extract and run code
            self.executor.initiate_chat(
                self.coder,
                message="Execute the code and show results."
            )

        return {
            "design": design,
            "code": code,
            "review": review,
            "execution": self.executor.last_message()["content"]
        }

# Usage
pipeline = CodeGenPipeline(llm_config)
result = await pipeline.generate(
    "Create a function that finds all prime numbers up to N using the Sieve of Eratosthenes"
)
```

## Best Practices

1. **Clear system messages**: Each agent needs a well-defined role
2. **Termination conditions**: Always define when conversations should end
3. **Code execution safety**: Use Docker for untrusted code
4. **Token management**: Monitor and limit conversation length
5. **Error handling**: Wrap agent interactions in try-except
6. **Logging**: Log all agent messages for debugging

## Conclusion

AutoGen simplifies multi-agent development with:
- Pre-built agent types for common patterns
- Flexible conversation management
- Code execution capabilities
- Easy function registration

Start with two-agent patterns, then progress to group chats as your use cases grow. The framework handles the complexity of agent coordination, letting you focus on defining agent behaviors.
