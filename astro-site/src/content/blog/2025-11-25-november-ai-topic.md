---
title: "Building Multi-Agent Systems with AutoGen and Azure"
description: "Instead of a single LLM handling all tasks, multi-agent systems divide work among specialized agents that communicate and coordinate to achieve goals."
author: Michael John Peña
draft: false
date: 2025-11-25
tags:
  - AutoGen
  - Multi-Agent
  - AI Agents
  - Azure OpenAI
  - Orchestration
---

## Multi-Agent Architecture

Instead of a single LLM handling all tasks, multi-agent systems divide work among specialized agents that communicate and coordinate to achieve goals.

## Setting Up AutoGen

Configure agents with distinct roles and capabilities:

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager
from autogen.oai import AzureOpenAIModelClient

# Configure Azure OpenAI
config_list = [{
    "model": "gpt-4",
    "api_type": "azure",
    "azure_endpoint": os.environ["AZURE_OPENAI_ENDPOINT"],
    "api_key": os.environ["AZURE_OPENAI_KEY"],
    "api_version": "2024-02-01"
}]

llm_config = {
    "config_list": config_list,
    "temperature": 0.7,
    "timeout": 120
}

# Create specialized agents
data_analyst = AssistantAgent(
    name="DataAnalyst",
    system_message="""You are a data analyst expert. Your responsibilities:
    - Analyze data requirements and propose analysis approaches
    - Write Python code for data analysis using pandas and numpy
    - Interpret statistical results and provide insights
    - Create visualizations to communicate findings
    Always explain your analysis methodology before writing code.""",
    llm_config=llm_config
)

code_reviewer = AssistantAgent(
    name="CodeReviewer",
    system_message="""You are a senior code reviewer. Your responsibilities:
    - Review code for correctness, efficiency, and best practices
    - Identify potential bugs or edge cases
    - Suggest improvements and optimizations
    - Ensure code follows PEP 8 and is well-documented
    Provide constructive feedback with specific suggestions.""",
    llm_config=llm_config
)

report_writer = AssistantAgent(
    name="ReportWriter",
    system_message="""You are a technical writer. Your responsibilities:
    - Synthesize analysis results into clear reports
    - Create executive summaries for non-technical audiences
    - Highlight key findings and actionable recommendations
    - Structure content logically with proper formatting
    Focus on clarity and actionable insights.""",
    llm_config=llm_config
)

# User proxy to execute code
user_proxy = UserProxyAgent(
    name="UserProxy",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=10,
    is_termination_msg=lambda x: x.get("content", "").rstrip().endswith("TERMINATE"),
    code_execution_config={
        "work_dir": "workspace",
        "use_docker": False
    }
)
```

## Orchestrating Agent Collaboration

Create a group chat for agent coordination:

```python
# Set up group chat
group_chat = GroupChat(
    agents=[user_proxy, data_analyst, code_reviewer, report_writer],
    messages=[],
    max_round=20,
    speaker_selection_method="auto"
)

manager = GroupChatManager(
    groupchat=group_chat,
    llm_config=llm_config
)

# Define the task
task = """
Analyze the sales data in 'data/sales_2025.csv':
1. Calculate monthly revenue trends
2. Identify top-performing products and regions
3. Detect any anomalies or concerning patterns
4. Create visualizations for key metrics
5. Produce an executive summary report

The analysis should be thorough and the code should be production-quality.
"""

# Start the collaboration
await user_proxy.initiate_chat(
    manager,
    message=task
)
```

## Custom Agent Functions

Add specialized capabilities to agents:

```python
from autogen import register_function

# Register custom functions for agents
@register_function(
    name="query_database",
    description="Query the analytics database for specific metrics"
)
async def query_database(query: str, database: str = "analytics") -> dict:
    """Execute SQL query against the database."""
    # Connect and execute
    result = await db_client.execute(query)
    return {"data": result.to_dict(), "row_count": len(result)}

@register_function(
    name="send_report",
    description="Send the generated report to stakeholders"
)
async def send_report(
    report_content: str,
    recipients: list[str],
    subject: str
) -> dict:
    """Email report to specified recipients."""
    await email_service.send(
        to=recipients,
        subject=subject,
        body=report_content
    )
    return {"status": "sent", "recipient_count": len(recipients)}

# Attach functions to relevant agent
data_analyst = AssistantAgent(
    name="DataAnalyst",
    system_message="...",
    llm_config=llm_config,
    function_map={
        "query_database": query_database
    }
)
```

Multi-agent systems excel at complex tasks requiring diverse expertise. The agents provide checks and balances, with reviewers catching errors and writers ensuring clear communication of results.
