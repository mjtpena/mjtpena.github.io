---
title: "CrewAI Introduction: Role-Based Multi-Agent Framework"
author: Michael John Peña
draft: false
date: 2024-01-11
tags:
  - CrewAI
  - AI Agents
  - Multi-Agent
  - Python
  - LangChain
---

I started experimenting with CrewAI because I wanted clearer role definitions in multi-agent workflows. CrewAI's focus on roles, goals, and agent backstories makes collaboration between agents more predictable and testable.

## CrewAI Philosophy

CrewAI models agent collaboration like a real team:
- **Agents** have roles, goals, and backstories
- **Tasks** are specific assignments with expected outputs
- **Crews** coordinate agents to complete workflows
- **Tools** extend agent capabilities

## Installation

```bash
pip install crewai crewai-tools
```

## Basic Concepts

### Defining Agents

```python
from crewai import Agent, Task, Crew, Process
from langchain_openai import AzureChatOpenAI

# Configure LLM
llm = AzureChatOpenAI(
    azure_deployment="gpt-4-turbo",
    azure_endpoint="https://your-resource.openai.azure.com/",
    api_version="2024-02-15-preview"
)

# Define agents with roles
researcher = Agent(
    role="Senior Research Analyst",
    goal="Uncover cutting-edge developments in AI and data science",
    backstory="""You work at a leading tech think tank.
    Your expertise lies in identifying emerging trends and technologies.
    You have a knack for dissecting complex data and presenting
    actionable insights.""",
    verbose=True,
    allow_delegation=False,
    llm=llm
)

writer = Agent(
    role="Tech Content Strategist",
    goal="Craft compelling content on tech advancements",
    backstory="""You are a renowned Content Strategist, known for
    your insightful and engaging articles. You transform complex
    concepts into compelling narratives.""",
    verbose=True,
    allow_delegation=True,
    llm=llm
)

editor = Agent(
    role="Senior Editor",
    goal="Ensure content quality and accuracy",
    backstory="""You are an experienced editor with an eye for detail.
    You ensure all content is accurate, well-structured, and
    engaging for the target audience.""",
    verbose=True,
    allow_delegation=False,
    llm=llm
)
```

### Defining Tasks

```python
# Define tasks for the agents
research_task = Task(
    description="""Conduct comprehensive research on the latest
    advancements in AI agents and multi-agent systems.
    Focus on:
    - Key frameworks and tools
    - Real-world applications
    - Challenges and limitations
    - Future trends

    Your final report should be detailed and include references.""",
    expected_output="A comprehensive research report on AI agents",
    agent=researcher
)

writing_task = Task(
    description="""Using the research report, write an engaging
    blog post about AI agents for a technical audience.

    The post should:
    - Be approximately 1500 words
    - Include practical examples
    - Have clear sections with headers
    - Be accessible yet technically accurate""",
    expected_output="A polished blog post draft",
    agent=writer,
    context=[research_task]  # Depends on research task
)

editing_task = Task(
    description="""Review and edit the blog post for:
    - Technical accuracy
    - Grammar and style
    - Flow and readability
    - SEO optimization

    Provide the final polished version.""",
    expected_output="Final edited blog post ready for publication",
    agent=editor,
    context=[writing_task]
)
```

### Creating and Running a Crew

```python
# Assemble the crew
content_crew = Crew(
    agents=[researcher, writer, editor],
    tasks=[research_task, writing_task, editing_task],
    process=Process.sequential,  # Tasks run in order
    verbose=True
)

# Execute the crew
result = content_crew.kickoff()
print(result)
```

## Advanced Patterns

### Hierarchical Process

A manager agent coordinates the crew:

```python
from crewai import Crew, Process

# Create a crew with hierarchical process
hierarchical_crew = Crew(
    agents=[researcher, writer, editor],
    tasks=[research_task, writing_task, editing_task],
    process=Process.hierarchical,
    manager_llm=llm,  # LLM for the manager
    verbose=True
)

# The manager will:
# - Analyze the tasks
# - Assign work to appropriate agents
# - Review outputs
# - Coordinate handoffs
```

### Custom Tools

Extend agent capabilities with tools:

```python
from crewai_tools import (
    SerperDevTool,
    WebsiteSearchTool,
    FileReadTool,
    DirectoryReadTool
)
from crewai import Agent
from langchain.tools import tool

# Built-in tools
search_tool = SerperDevTool()
web_tool = WebsiteSearchTool()
file_tool = FileReadTool()

# Custom tool
@tool("Database Query Tool")
def query_database(query: str) -> str:
    """Execute a database query and return results.

    Args:
        query: SQL query to execute

    Returns:
        Query results as formatted string
    """
    # Implementation
    return "Query results..."

@tool("API Caller")
def call_api(endpoint: str, method: str = "GET") -> str:
    """Call an external API.

    Args:
        endpoint: API endpoint URL
        method: HTTP method (GET, POST, etc.)

    Returns:
        API response
    """
    import requests
    response = requests.request(method, endpoint)
    return response.text

# Assign tools to agents
data_analyst = Agent(
    role="Data Analyst",
    goal="Analyze data and provide insights",
    backstory="Expert in data analysis and SQL",
    tools=[query_database, search_tool],
    llm=llm
)

api_integrator = Agent(
    role="API Integration Specialist",
    goal="Integrate with external services",
    backstory="Expert in API integrations",
    tools=[call_api, web_tool],
    llm=llm
)
```

### Task Dependencies and Context

```python
# Tasks can depend on other tasks
task1 = Task(
    description="Gather initial data",
    expected_output="Raw data collection",
    agent=researcher
)

task2 = Task(
    description="Analyze the gathered data",
    expected_output="Analysis report",
    agent=data_analyst,
    context=[task1]  # Uses output from task1
)

task3 = Task(
    description="Visualize the analysis results",
    expected_output="Visualization and dashboard",
    agent=writer,
    context=[task2]  # Uses output from task2
)

# Parallel tasks that both depend on task1
task4 = Task(
    description="Create executive summary",
    expected_output="One-page summary",
    agent=editor,
    context=[task1, task2]  # Uses both outputs
)
```

### Callbacks and Monitoring

```python
from crewai import Task

def task_callback(output):
    """Called when a task completes."""
    print(f"Task completed!")
    print(f"Output: {output.raw_output[:200]}...")

    # Log to monitoring system
    log_task_completion(output)

def step_callback(step_output):
    """Called after each agent step."""
    print(f"Step: {step_output}")

research_task = Task(
    description="Research AI trends",
    expected_output="Research report",
    agent=researcher,
    callback=task_callback
)

# Crew-level callbacks
crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    step_callback=step_callback,
    verbose=True
)
```

## Practical Example: Customer Support Analysis

```python
from crewai import Agent, Task, Crew, Process
from crewai_tools import FileReadTool

# Tools
file_reader = FileReadTool()

# Agents
data_collector = Agent(
    role="Data Collection Specialist",
    goal="Gather and organize customer support data",
    backstory="""You specialize in collecting and organizing
    customer feedback data from various sources.""",
    tools=[file_reader],
    llm=llm
)

sentiment_analyst = Agent(
    role="Sentiment Analysis Expert",
    goal="Analyze customer sentiment and emotions",
    backstory="""You are an expert in understanding customer
    emotions and sentiment from their communications.""",
    llm=llm
)

trend_analyst = Agent(
    role="Trend Analysis Specialist",
    goal="Identify patterns and trends in support tickets",
    backstory="""You excel at finding patterns in data
    and identifying emerging issues before they escalate.""",
    llm=llm
)

report_writer = Agent(
    role="Business Intelligence Reporter",
    goal="Create actionable reports for stakeholders",
    backstory="""You transform complex analysis into clear,
    actionable business recommendations.""",
    llm=llm
)

# Tasks
collect_task = Task(
    description="""Read and organize the customer support tickets
    from the provided files. Categorize by:
    - Issue type
    - Product area
    - Customer segment
    - Urgency level""",
    expected_output="Organized dataset of support tickets",
    agent=data_collector
)

sentiment_task = Task(
    description="""Analyze the sentiment of each ticket:
    - Overall sentiment (positive/neutral/negative)
    - Emotion detection (frustrated, confused, satisfied)
    - Urgency indicators
    - Escalation risk""",
    expected_output="Sentiment analysis report",
    agent=sentiment_analyst,
    context=[collect_task]
)

trend_task = Task(
    description="""Identify trends in the support data:
    - Common issues
    - Emerging problems
    - Seasonal patterns
    - Product-specific trends
    - Customer segment patterns""",
    expected_output="Trend analysis report",
    agent=trend_analyst,
    context=[collect_task, sentiment_task]
)

report_task = Task(
    description="""Create an executive report including:
    - Key findings summary
    - Critical issues requiring immediate attention
    - Trend visualizations (describe)
    - Recommendations for improvement
    - Metrics and KPIs""",
    expected_output="Executive report with recommendations",
    agent=report_writer,
    context=[sentiment_task, trend_task]
)

# Crew
support_analysis_crew = Crew(
    agents=[data_collector, sentiment_analyst, trend_analyst, report_writer],
    tasks=[collect_task, sentiment_task, trend_task, report_task],
    process=Process.sequential,
    verbose=True
)

# Run
result = support_analysis_crew.kickoff()
```

## CrewAI vs AutoGen

| Aspect | CrewAI | AutoGen |
|--------|--------|---------|
| Metaphor | Role-playing crew | Conversable agents |
| Structure | Tasks and processes | Conversations |
| Coordination | Sequential/Hierarchical | GroupChat/Custom |
| Tools | Built-in tool system | Function registration |
| Learning Curve | Lower | Higher |
| Flexibility | Moderate | High |
| Best For | Structured workflows | Open-ended problems |

## Best Practices

1. **Define clear roles**: Each agent should have a distinct specialty
2. **Specific goals**: Goals should be measurable and achievable
3. **Rich backstories**: Help agents stay in character
4. **Task dependencies**: Use context to share information between tasks
5. **Appropriate tools**: Only give agents the tools they need
6. **Monitor execution**: Use callbacks to track progress

## Conclusion

CrewAI makes multi-agent systems accessible through its role-based metaphor. The framework excels at structured workflows where you can clearly define roles, tasks, and dependencies. Start with sequential processes, then explore hierarchical patterns as your use cases become more complex.
