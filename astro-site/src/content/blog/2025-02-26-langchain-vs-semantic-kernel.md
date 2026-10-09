---
title: "LangChain vs Semantic Kernel: Choosing Your AI Framework"
description: "Choose based on your ecosystem and team skills."
author: Michael John Peña
draft: false
date: 2025-02-26
tags:
  - AI
  - LangChain
  - Semantic Kernel
  - Framework
  - Comparison
---

## Framework Comparison

```python
# LangChain approach
from langchain.chat_models import AzureChatOpenAI
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def query_database(query: str) -> str:
    """Execute SQL query."""
    return execute_sql(query)

llm = AzureChatOpenAI(deployment_name="gpt-4o")
agent = create_openai_tools_agent(llm, [query_database], prompt)
executor = AgentExecutor(agent=agent, tools=[query_database])

result = executor.invoke({"input": "Get sales data"})

# Semantic Kernel approach
import semantic_kernel as sk

kernel = sk.Kernel()
kernel.add_service(AzureChatCompletion(...))

@sk.kernel_function
def query_database(query: str) -> str:
    """Execute SQL query."""
    return execute_sql(query)

kernel.add_plugin(plugin, "data")
result = await kernel.invoke_prompt("Get sales data")
```

| Feature | LangChain | Semantic Kernel |
|---------|-----------|-----------------|
| Language | Python-first | .NET & Python |
| Ecosystem | Large, many integrations | Microsoft-focused |
| Learning Curve | Moderate | Easier |
| Enterprise Support | Community | Microsoft |

Choose based on your ecosystem and team skills.
