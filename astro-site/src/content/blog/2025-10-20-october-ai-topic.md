---
title: "Building AI Agents with AutoGen and Azure OpenAI"
author: Michael John Peña
draft: false
date: 2025-10-20
tags:
  - AutoGen
  - AI Agents
  - Azure OpenAI
  - Multi-Agent
  - Automation

---

I wrote "Building AI Agents with AutoGen and Azure OpenAI" to share practical, production-minded guidance on this topic.

## Setting Up AutoGen Agents

Configure agents with Azure OpenAI:

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager
import os

# Configure Azure OpenAI
config_list = [
    {
        "model": "gpt-4",
        "api_type": "azure",
        "api_base": os.environ["AZURE_OPENAI_ENDPOINT"],
        "api_key": os.environ["AZURE_OPENAI_KEY"],
        "api_version": "2024-02-01"
    }
]

llm_config = {
    "config_list": config_list,
    "temperature": 0.1,
    "timeout": 120
}

# Create specialized agents
analyst = AssistantAgent(
    name="DataAnalyst",
    system_message="""You are a data analyst expert. You analyze data, create visualizations,
    and provide insights. You write Python code for data analysis using pandas and matplotlib.
    Always explain your findings clearly.""",
    llm_config=llm_config
)

researcher = AssistantAgent(
    name="Researcher",
    system_message="""You are a research specialist. You gather information, synthesize findings,
    and provide comprehensive summaries. Focus on accuracy and citing sources when possible.""",
    llm_config=llm_config
)

critic = AssistantAgent(
    name="Critic",
    system_message="""You are a quality reviewer. You evaluate the work of other agents,
    identify potential issues, and suggest improvements. Be constructive but thorough.""",
    llm_config=llm_config
)
```

## Creating User Proxy for Code Execution

Enable agents to execute code safely:

```python
user_proxy = UserProxyAgent(
    name="UserProxy",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=10,
    is_termination_msg=lambda x: x.get("content", "").rstrip().endswith("TASK_COMPLETE"),
    code_execution_config={
        "work_dir": "workspace",
        "use_docker": True,  # Safer code execution
        "timeout": 60,
        "last_n_messages": 3
    }
)

# Function to run analysis task
def run_analysis_task(task_description: str) -> str:
    """Execute an analysis task using multi-agent collaboration."""

    # Create group chat
    group_chat = GroupChat(
        agents=[user_proxy, analyst, researcher, critic],
        messages=[],
        max_round=15,
        speaker_selection_method="round_robin"
    )

    manager = GroupChatManager(groupchat=group_chat, llm_config=llm_config)

    # Start the conversation
    user_proxy.initiate_chat(
        manager,
        message=f"""Complete the following task. When finished, respond with TASK_COMPLETE.

Task: {task_description}"""
    )

    # Extract final result
    messages = group_chat.messages
    return messages[-1]["content"] if messages else "No result generated"
```

## Tool-Using Agents

Extend agents with custom tools:

```python
from autogen import register_function

def search_database(query: str, table: str) -> str:
    """Search the database for relevant records."""
    # Implementation would connect to actual database
    return f"Found 10 records matching '{query}' in {table}"

def send_notification(message: str, channel: str) -> str:
    """Send notification to specified channel."""
    return f"Notification sent to {channel}: {message}"

# Register tools with the agent
register_function(
    search_database,
    caller=analyst,
    executor=user_proxy,
    description="Search database for records"
)
```

AutoGen enables building sophisticated AI systems that can decompose complex tasks and collaborate to find solutions.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
