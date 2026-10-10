---
title: "CrewAI 0.1 on Azure OpenAI: Roles, Tasks and Current Limits"
description: "A practical look at CrewAI 0.1.x with Azure OpenAI: how agents, tasks and sequential crews work, what's missing today, and when to choose it."
author: Michael John Peña
draft: false
date: 2024-01-11
tags:
  - CrewAI
  - AI Agents
  - Multi-Agent
  - Azure OpenAI
  - Python
---

I started experimenting with CrewAI because I wanted clearer role definitions in multi-agent workflows. Most multi-agent demos I see are one long conversation, and it's hard to tell which agent is responsible for what or why a run went sideways. CrewAI's focus on roles, goals and agent backstories makes the collaboration more predictable and easier to test, but it is also a very young project. Here's what it actually does today, how to point it at Azure OpenAI, and where I'd hold back.

## What CrewAI is, as of January 2024

CrewAI is an open-source Python framework by João Moura. The [first release (0.1.0) landed on PyPI on 14 November 2023](https://pypi.org/project/crewai/#history), and the current version as I write this is 0.1.24, with new releases arriving every few days. It sits on top of LangChain: every agent is a LangChain ReAct-style agent executor, and the package pins `langchain` to exactly 0.0.354. That pin matters, because LangChain 0.1.0 shipped on 6 January and you can't install both in the same environment.

The model is deliberately simple. There are four concepts:

- **Agent**: a `role`, a `goal`, a `backstory`, an optional `llm`, and a list of tools. These three strings are written straight into the agent's prompt.
- **Task**: a `description` and the `agent` that owns it. Optionally, a narrower list of tools for that task.
- **Crew**: a list of agents and tasks plus a `process` that decides how tasks run.
- **Process**: the execution strategy. In 0.1.24 the enum has exactly one value, `Process.sequential`. `hierarchical` and `consensual` appear in the [0.1.24 source](https://pypi.org/project/crewai/0.1.24/) (`crewai/process.py` in the sdist) only as commented-out TODOs.

That last point is worth stating plainly, because blog posts and videos already talk about manager agents and hierarchical crews. In the version you can install today, a crew runs its tasks in the order you list them. Nothing more.

## Wiring it to Azure OpenAI

By default every `Agent` creates its own `ChatOpenAI(model_name="gpt-4")`, which means it goes to OpenAI directly and needs `OPENAI_API_KEY`. If your organisation's data must stay in your Azure tenant, you need to pass an Azure model to every agent explicitly. Forgetting one agent is an easy way to send prompts somewhere you didn't intend.

```bash
pip install crewai==0.1.24
export AZURE_OPENAI_API_KEY="<your-api-key>"
```

Pin the version. With this release cadence, an unpinned install next week will behave differently.

```python
from langchain_community.chat_models import AzureChatOpenAI

llm = AzureChatOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com/",
    azure_deployment="<your-gpt-4-deployment>",
    openai_api_version="2023-05-15",
    temperature=0.2,
)
```

`langchain-community` comes in as a dependency of LangChain 0.0.354, so this import needs nothing extra installed. The class is deprecated in favour of `AzureChatOpenAI` in the new `langchain-openai` package, so the first run prints a `LangChainDeprecationWarning`; it still works with the 0.0.354 pin, and I'd rather live with the warning than add another fast-moving package to an already pinned stack. Any GPT-4 deployment works; GPT-4 Turbo (`1106-preview`) is [still a preview model on Azure OpenAI](https://learn.microsoft.com/azure/ai-services/openai/whats-new), so check that it's available in your region before you standardise on it. I keep the temperature low: the agents parse their own ReAct-format output, and creative formatting from the model shows up as parsing retries.

## A three-agent crew

Here's a complete crew that researches a topic, drafts a post, and edits it. It reuses the `llm` defined above.

```python
from crewai import Agent, Task, Crew, Process

researcher = Agent(
    role="Senior Research Analyst",
    goal="Find the key facts, frameworks and open problems in a technical topic",
    backstory="You work at a technology think tank and are known for "
              "separating established facts from speculation.",
    llm=llm,
    allow_delegation=False,
    memory=False,
    verbose=True,
)

writer = Agent(
    role="Technical Writer",
    goal="Turn research notes into a clear article for engineers",
    backstory="You write for practitioners and avoid marketing language.",
    llm=llm,
    allow_delegation=False,
    memory=False,
    verbose=True,
)

editor = Agent(
    role="Senior Editor",
    goal="Make the article accurate, well structured and concise",
    backstory="You have edited technical publications for years and cut "
              "anything that isn't supported by the research.",
    llm=llm,
    allow_delegation=False,
    memory=False,
    verbose=True,
)

research = Task(
    description="Research multi-agent LLM frameworks. List the main frameworks, "
                "how they coordinate agents, and their known limitations. "
                "Return bullet-point notes.",
    agent=researcher,
)

draft = Task(
    description="Write a 600-word article for engineers based on the research "
                "notes provided as context. Use short sections with headings.",
    agent=writer,
)

edit = Task(
    description="Edit the draft provided as context. Fix unclear sentences, "
                "remove unsupported claims and return the final article.",
    agent=editor,
)

crew = Crew(
    agents=[researcher, writer, editor],
    tasks=[research, draft, edit],
    process=Process.sequential,
    verbose=2,
)

result = crew.kickoff()
print(result)
```

`kickoff()` returns a plain string: the output of the last task.

### How context actually flows

There is no `context` parameter on `Task` in this version. The sequential process passes the output of the previous task into the next one, appended to the description under "This is the context you are working with". Only the immediately preceding output is passed. If the editor needed the original research notes as well as the draft, it wouldn't get them. You'd have to have the writer include them in its output, or run separate crews and stitch the results together yourself.

That's why the task descriptions above say "provided as context". Writing descriptions that expect the hand-off makes the chain more reliable than hoping the model notices the appended text.

## Tools and delegation

Tools are ordinary LangChain tools. Anything from `langchain_community.tools`, or your own function decorated with `@tool`, can go in an agent's `tools` list. This fragment adds a file-reading tool to an analyst:

```python
from pathlib import Path

from crewai import Agent
from langchain.tools import tool


@tool("Read support tickets")
def read_tickets(path: str) -> str:
    """Read a UTF-8 text file of support tickets and return its contents."""
    return Path(path.strip()).read_text(encoding="utf-8")[:8000]


analyst = Agent(
    role="Support Analyst",
    goal="Identify the most common customer issues in support tickets",
    backstory="You triage support queues and spot recurring problems early.",
    tools=[read_tickets],
    llm=llm,
    allow_delegation=False,
    memory=False,
)
```

Two behaviours are easy to miss:

- **Tool results are cached per crew.** The crew's cache handler stores each tool call by tool name and input, so the same call made twice returns the stored result. That saves money on repeated searches, but it's wrong for tools whose answer changes between calls.
- **Delegation is on by default.** `allow_delegation` defaults to `True`. When it's on, the agent gets two extra tools, "Delegate work to co-worker" and "Ask question to co-worker", and has to call them with a pipe-separated string: `coworker|task|context`. Models get that format wrong often enough that I switch delegation off unless I specifically want it.

Memory is also on by default. `memory=True` attaches a LangChain `ConversationSummaryMemory`, which uses the same LLM to summarise the conversation. That means extra model calls you'll pay for. For single-pass pipelines like the one above, I'd turn it off with `memory=False`, which is why every agent in this post sets it.

## CrewAI next to AutoGen

I covered [AutoGen yesterday](/blog/2024-01-10-autogen-introduction/), and the difference is mostly about how you think about the problem:

| Aspect | CrewAI 0.1.x | AutoGen |
|---|---|---|
| Mental model | A team with roles working through assigned tasks | Agents that talk to each other |
| Coordination | Sequential task list | Two-agent chats and `GroupChat` with a manager |
| Hand-off | Previous task output appended to the next task | Shared conversation history |
| Code execution | Not built in; only through tools | Built-in code execution, Docker optional |
| Maturity | Weeks old, frequent breaking changes | Larger community, research-backed |
| Underlying stack | LangChain (pinned) | Its own `openai`-based client |

My rule of thumb: if you can write the workflow down as a numbered list of steps with an owner for each, CrewAI's model fits and is easier to read. If the agents need to negotiate, iterate or write and run code until something works, AutoGen is the better fit today. There's a broader comparison in [AI agent frameworks compared](/blog/2024-01-12-agent-frameworks-comparison/), and the coordination patterns themselves are in [multi-agent systems](/blog/2024-01-09-multi-agent-systems/).

## When I wouldn't use it

- **Anything going to production soon.** With an exact LangChain pin and releases every few days, you take on real upgrade risk. Pin everything and expect to rewrite parts.
- **Workflows that aren't really sequential.** If tasks need to fan out, run in parallel or loop, the current process model can't express that. You'll end up orchestrating crews from your own code, and by then the framework isn't adding much.
- **Deterministic pipelines.** If each step is a fixed prompt with a fixed input, you don't need agents at all. A plain chain of model calls is cheaper, faster and much easier to debug.
- **Cost-sensitive runs.** Default memory, delegation and ReAct reasoning all add model calls. A three-agent crew on GPT-4 can easily use several times the tokens of the same work done as three direct prompts. Per task, the extra calls come from each iteration of the ReAct loop (one model call per thought and tool step), one `ConversationSummaryMemory` summarisation call per agent run when memory is on, and the round-trips whenever an agent delegates to a co-worker. Run once with `verbose=2`, or attach a LangChain callback handler to count calls, before you scale anything up.

## Where it's worth your time

CrewAI's real contribution is the shape it puts on the problem: role, goal and backstory per agent, one owner per task, and a visible order of execution. That makes a multi-agent prototype much easier to explain to a stakeholder and to reason about when it fails. I'd use it today to prototype role-based workflows on Azure OpenAI, with every agent given an explicit `llm`, delegation and memory switched off until you need them, and the version pinned. I wouldn't build anything long-lived on it until the process model and APIs settle.
