---
title: "Azure AI Agent Service: Building Autonomous AI Agents"
description: "Azure AI Agent Service provides the foundation for building sophisticated AI systems that can reason, plan, and act autonomously. Start with simple agents…"
author: Michael John Peña
draft: false
date: 2024-11-10
tags:
  - Azure
  - AI
  - AI Agents
  - Azure AI Agent Service
  - Automation
---

## What Makes an AI Agent?

Unlike simple chatbots, agents can:
- **Reason** about multi-step problems
- **Plan** sequences of actions
- **Execute** tasks using tools
- **Learn** from outcomes
- **Adapt** their approach

```
Traditional Chatbot:
  User → Model → Response

AI Agent:
  User → [Plan → Think → Act → Observe → Repeat] → Result
                    ↓
               Use Tools
```

## Creating Your First Agent

```python
from azure.ai.foundry import AIFoundryClient
from azure.ai.foundry.agents import (
    Agent,
    AgentConfig,
    Tool,
    ToolResult
)

client = AIFoundryClient(...)

# Define a simple tool
class CalculatorTool(Tool):
    name = "calculator"
    description = "Perform mathematical calculations. Input should be a valid math expression."

    async def execute(self, expression: str) -> ToolResult:
        try:
            # Safe evaluation of math expressions
            import ast
            import operator

            ops = {
                ast.Add: operator.add,
                ast.Sub: operator.sub,
                ast.Mult: operator.mul,
                ast.Div: operator.truediv,
                ast.Pow: operator.pow
            }

            def eval_expr(node):
                if isinstance(node, ast.Num):
                    return node.n
                elif isinstance(node, ast.BinOp):
                    return ops[type(node.op)](
                        eval_expr(node.left),
                        eval_expr(node.right)
                    )
                raise ValueError(f"Unsupported: {node}")

            tree = ast.parse(expression, mode='eval')
            result = eval_expr(tree.body)

            return ToolResult(
                success=True,
                output=str(result)
            )
        except Exception as e:
            return ToolResult(
                success=False,
                error=str(e)
            )

# Create an agent
math_agent = Agent(
    name="MathAssistant",
    model="gpt-4o",
    config=AgentConfig(
        temperature=0.1,
        max_iterations=10
    ),
    instructions="""You are a math assistant. When asked math questions:
1. Break down the problem into steps
2. Use the calculator tool for computations
3. Explain your reasoning
4. Verify your answer""",
    tools=[CalculatorTool()]
)
```

## Building a Data Engineering Agent

```python
from azure.ai.foundry.agents import Agent, Tool, ToolResult
from typing import Optional
import pyodbc

class SQLQueryTool(Tool):
    name = "sql_query"
    description = """Execute SQL queries against the data warehouse.
    Use for: SELECT queries to retrieve data.
    Do NOT use for: INSERT, UPDATE, DELETE, DROP, or any data modification."""

    def __init__(self, connection_string: str):
        self.connection_string = connection_string

    async def execute(self, query: str) -> ToolResult:
        # Safety check
        forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER"]
        if any(word in query.upper() for word in forbidden):
            return ToolResult(
                success=False,
                error="Data modification queries are not allowed"
            )

        try:
            conn = pyodbc.connect(self.connection_string)
            cursor = conn.cursor()
            cursor.execute(query)

            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchmany(100)  # Limit results

            return ToolResult(
                success=True,
                output={
                    "columns": columns,
                    "rows": [list(row) for row in rows],
                    "row_count": len(rows),
                    "truncated": len(rows) == 100
                }
            )
        except Exception as e:
            return ToolResult(
                success=False,
                error=str(e)
            )

class SchemaInspectorTool(Tool):
    name = "inspect_schema"
    description = "Get the schema (columns and types) for a database table."

    def __init__(self, connection_string: str):
        self.connection_string = connection_string

    async def execute(self, table_name: str) -> ToolResult:
        query = f"""
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '{table_name}'
        ORDER BY ORDINAL_POSITION
        """

        try:
            conn = pyodbc.connect(self.connection_string)
            cursor = conn.cursor()
            cursor.execute(query)

            columns = cursor.fetchall()
            schema = [
                {"name": col[0], "type": col[1], "nullable": col[2]}
                for col in columns
            ]

            return ToolResult(
                success=True,
                output={"table": table_name, "columns": schema}
            )
        except Exception as e:
            return ToolResult(
                success=False,
                error=str(e)
            )

# Create the data engineering agent
data_agent = Agent(
    name="DataEngineer",
    model="gpt-4o",
    config=AgentConfig(
        temperature=0.1,
        max_iterations=15
    ),
    instructions="""You are a data engineering assistant with access to a SQL data warehouse.

Your workflow:
1. When asked about data, first inspect relevant table schemas
2. Write efficient SQL queries to answer questions
3. Analyze results and provide insights
4. If a query fails, analyze the error and retry with corrections

Guidelines:
- Always inspect schema before writing complex queries
- Limit results to avoid overwhelming output
- Explain your analysis in business terms
- Suggest follow-up questions when appropriate""",
    tools=[
        SQLQueryTool(connection_string),
        SchemaInspectorTool(connection_string)
    ]
)
```

## Running Agents

```python
from azure.ai.foundry.agents import AgentRuntime, ConversationHistory

runtime = AgentRuntime(client)

async def run_data_analysis():
    # Create a conversation
    conversation = ConversationHistory()

    # First question
    result = await runtime.run(
        agent=data_agent,
        message="What were our top 5 customers by revenue last month?",
        conversation=conversation
    )

    print(f"Answer: {result.final_answer}")
    print(f"\nSteps taken:")
    for step in result.steps:
        print(f"  {step.action}: {step.description}")

    # Follow-up (conversation context is maintained)
    result = await runtime.run(
        agent=data_agent,
        message="How does that compare to the same month last year?",
        conversation=conversation
    )

    print(f"\nFollow-up answer: {result.final_answer}")

await run_data_analysis()
```

## Agent Reasoning and Planning

```python
class PlanningAgent(Agent):
    """Agent with explicit planning capabilities."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.instructions += """

Before taking action, always create a plan:
1. Understand the goal
2. List the steps needed
3. Identify what information you need
4. Execute steps one by one
5. Verify results against the goal

Format your thinking as:
GOAL: [What we're trying to achieve]
PLAN:
  1. [First step]
  2. [Second step]
  ...
EXECUTION: [Current step and results]
VERIFICATION: [Did we achieve the goal?]
"""

# The agent will now structure its reasoning
planning_agent = PlanningAgent(
    name="PlanningDataEngineer",
    model="gpt-4o",
    tools=[SQLQueryTool(conn), SchemaInspectorTool(conn)]
)
```

## Handling Failures and Retries

```python
from azure.ai.foundry.agents import RetryPolicy, ErrorHandler

class RobustAgent:
    """Agent with error handling and retries."""

    def __init__(self, agent: Agent, max_retries: int = 3):
        self.agent = agent
        self.max_retries = max_retries
        self.error_handler = ErrorHandler()

    async def run(self, message: str) -> dict:
        attempts = 0
        last_error = None

        while attempts < self.max_retries:
            try:
                result = await runtime.run(
                    agent=self.agent,
                    message=message
                )

                if result.success:
                    return result

                # Agent completed but didn't achieve goal
                message = f"""Previous attempt failed: {result.error}

Original request: {message}

Please try a different approach."""

            except Exception as e:
                last_error = e

                # Determine if retryable
                if self.error_handler.is_retryable(e):
                    attempts += 1
                    await asyncio.sleep(2 ** attempts)  # Exponential backoff
                else:
                    raise

        raise Exception(f"Failed after {attempts} attempts: {last_error}")

robust_agent = RobustAgent(data_agent, max_retries=3)
result = await robust_agent.run("Analyze customer churn patterns")
```

## Agent Memory and Context

```python
from azure.ai.foundry.agents import MemoryStore

class MemoryEnabledAgent:
    """Agent with long-term memory."""

    def __init__(self, agent: Agent, memory_store: MemoryStore):
        self.agent = agent
        self.memory = memory_store

    async def run(self, message: str, user_id: str) -> str:
        # Retrieve relevant memories
        relevant_memories = await self.memory.search(
            query=message,
            user_id=user_id,
            limit=5
        )

        # Add to context
        memory_context = "\n".join([
            f"Previous interaction ({m.timestamp}): {m.summary}"
            for m in relevant_memories
        ])

        enhanced_message = f"""Context from previous interactions:
{memory_context}

Current request: {message}"""

        # Run agent
        result = await runtime.run(
            agent=self.agent,
            message=enhanced_message
        )

        # Store this interaction
        await self.memory.store(
            user_id=user_id,
            message=message,
            response=result.final_answer,
            summary=await self.summarize_interaction(message, result)
        )

        return result.final_answer
```

Azure AI Agent Service provides the foundation for building sophisticated AI systems that can reason, plan, and act autonomously. Start with simple agents and progressively add complexity as you understand the patterns.

## Resources

- [AI Agent Service Documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/)
- [Agent Design Patterns](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/patterns)
- [Tool Development Guide](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/tools)
