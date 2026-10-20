---
title: "LangChain, AutoGen, CrewAI or Semantic Kernel? Choosing in January 2024"
description: "How LangChain 0.1, AutoGen 0.2, CrewAI 0.1 and Semantic Kernel 1.0 differ in maturity, control and Azure OpenAI fit, and which one I'd pick for what."
author: Michael John Peña
draft: false
date: 2024-01-12
tags:
  - AI Agents
  - LangChain
  - AutoGen
  - CrewAI
  - Semantic Kernel
  - Multi-Agent
---

Each of these frameworks has trade-offs that show up in delivery time and maintenance, not in the first demo. Feature lists don't help much here: all four frameworks in this post can call tools against Azure OpenAI. What separates them is how stable the API is, who controls the flow (your code or the model), and how much of the framework you can still trace when a run fails in production.

This is a snapshot as of mid-January 2024. All four projects are changing week to week, so I've pinned the versions I'm talking about.

## Where each framework stands this week

| | LangChain | AutoGen | CrewAI | Semantic Kernel |
|---|---|---|---|---|
| Version | `langchain` 0.1.0 (6 Jan) | `pyautogen` 0.2.6 (11 Jan) | `crewai` 0.1.24 (8 Jan) | .NET 1.0.1 (18 Dec); Python 0.4.5.dev0 (11 Jan) |
| Stability | First "stable" release | Pre-1.0, frequent point releases, no stability policy | Weeks old, releases every few days | .NET GA with a stability commitment; Python still pre-release |
| Languages | Python, JavaScript | Python | Python | C# (GA), Python and Java (pre-1.0) |
| Core idea | Composable components and agent executors | Agents that converse until done | Role-based agents working a task list | A kernel of plugins the model can call |
| Who drives the flow | You, or an `AgentExecutor` loop | The conversation between agents | A sequential task list | Your code, with the model choosing functions |
| Built-in code execution | No (via tools) | Yes (Docker or local) | No (via tools) | No (via plugins) |

Two of these are worth a closer look.

**LangChain hit 0.1.0 on 6 January.** The [v0.1.0 announcement](https://www.langchain.com/blog/langchain-v0-1-0) splits the project into `langchain-core`, `langchain-community` and partner packages such as `langchain-openai`, and introduces a versioning policy: breaking changes to the public API bump the minor version. That matters more than any feature in the release. LangChain's biggest cost for me has been churn, and for the first time there is a written rule about it.

**Semantic Kernel for .NET reached 1.0 in December.** The team's [V1.0.1 post](https://devblogs.microsoft.com/semantic-kernel/semantic-kernel-v1-0-1-has-arrived-to-help-you-build-agents/) says the core APIs won't break from here, while the planners and some connectors ship as `-preview` or `-alpha` packages marked experimental. The Python package is a different story: 0.4.5.dev0 still uses the older "skills" vocabulary (`import_skill`, `@sk_function`) that .NET has already replaced with plugins and `KernelFunction`. If you are a Python shop, you are not getting the 1.0 experience yet.

## LangChain: the widest toolbox, now with a stability promise

LangChain's strength is breadth. Vector stores, document loaders, retrievers and model providers are all there, and if you're building retrieval-augmented generation, most of the plumbing already exists. The weakness has always been the layers of abstraction you have to dig through when something misbehaves.

The 0.1 release also changed how agents are built. `initialize_agent` is deprecated in 0.1.0 in favour of constructor functions such as `create_openai_tools_agent`, which return a runnable you wrap in an `AgentExecutor`. Here is the minimal version against Azure OpenAI:

```python
# pip install langchain==0.1.0 langchain-openai==0.0.2
# export AZURE_OPENAI_API_KEY="<your-api-key>"
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool
from langchain_openai import AzureChatOpenAI

llm = AzureChatOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com/",
    azure_deployment="<your-gpt4-deployment-name>",
    api_version="2023-12-01-preview",
    temperature=0,
)


@tool
def get_order_status(order_id: str) -> str:
    """Return the status of a single order by its ID, for example ORD-1001."""
    # Placeholder: replace with a call to your order API
    fake_orders = {"ORD-1001": "shipped", "ORD-1002": "awaiting payment"}
    return fake_orders.get(order_id, "not found")


prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "You answer questions about orders using the tools provided."),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ]
)

tools = [get_order_status]
agent = create_openai_tools_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, max_iterations=5, verbose=True)

print(executor.invoke({"input": "What is the status of ORD-1002?"})["output"])
```

Two details are easy to get wrong. The tools agent sends OpenAI `tools`, not the older `functions` parameter, and Azure OpenAI only accepts that shape from API version `2023-12-01-preview` onwards (see [function calling on Azure OpenAI](https://learn.microsoft.com/azure/ai-services/openai/how-to/function-calling)). And `max_iterations` is your cost ceiling; set it deliberately rather than relying on the default of 15.

I'd choose LangChain when retrieval is the hard part of the problem and the agent is a thin layer on top. I'd avoid its agent abstractions when the flow is really a fixed sequence: LCEL chains or plain Python are easier to test.

The same announcement introduced LangGraph (0.0.x, days old), which models agent loops as an explicit graph instead of the `AgentExecutor`'s hidden loop. It is the piece to watch for multi-agent work in LangChain, but at this age I'd only prototype on it.

## AutoGen: conversations, code execution and a loop you must bound

AutoGen, from Microsoft Research, models a task as a conversation between agents. Its standout feature is built-in code execution: an `AssistantAgent` writes Python, a `UserProxyAgent` runs it, and the error output goes back into the conversation until the code works. For data analysis and scripting tasks nothing else in this list comes close.

The cost is control. The flow is whatever the conversation turns out to be, so you have to bound it: a termination check, a reply limit, and an explicit decision about where generated code runs (in 0.2.x it falls back to running on your machine if the `docker` package isn't installed). I covered those settings, plus the `register_for_llm` / `register_for_execution` split for tools, in [AutoGen 0.2 on Azure OpenAI](/blog/2024-01-10-autogen-introduction/).

I'd choose AutoGen for exploratory, code-heavy work with a human watching. I wouldn't put it in front of untrusted input with code execution switched on, and I'd pin the exact version: the move to 0.2 in November renamed config keys (`api_base` became `base_url`, `request_timeout` became `timeout`), and the project still ships point releases every few days.

## CrewAI: the clearest mental model, and the youngest code

CrewAI describes each agent with a role, a goal and a backstory, and gives each task an owner. That makes a multi-agent design easy to explain to someone who isn't an engineer, which is a real advantage when you are trying to get a prototype funded.

Underneath, though, it is very thin today. In 0.1.24 the only process is `Process.sequential`, there is no `context` parameter on a task (each task gets only the previous task's output), and the package pins LangChain to exactly 0.0.354, so it cannot share an environment with LangChain 0.1. Every agent also defaults to OpenAI directly unless you pass an Azure `llm` explicitly. The details are in [CrewAI 0.1 on Azure OpenAI](/blog/2024-01-11-crewai-introduction/).

I'd use CrewAI to prototype a role-based workflow quickly. I wouldn't build anything long-lived on it until the process model and dependency pin settle.

## Semantic Kernel: the one built for your existing codebase

Semantic Kernel takes the opposite approach to AutoGen. Your application stays in charge: you register plugins (ordinary classes with annotated methods), and the model is allowed to call them. In 1.0 the recommended route is the model's own function calling, with planners moved to separate preview packages. That is a sensible call, because native tool calling is cheaper and more predictable than asking the model to write a plan up front.

```csharp
// dotnet add package Microsoft.SemanticKernel --version 1.0.1
using System.ComponentModel;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Connectors.OpenAI;

var builder = Kernel.CreateBuilder();
builder.AddAzureOpenAIChatCompletion(
    deploymentName: "<your-gpt4-deployment-name>",
    endpoint: "https://<your-resource-name>.openai.azure.com/",
    apiKey: Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY")!);
builder.Plugins.AddFromType<OrderPlugin>();
Kernel kernel = builder.Build();

var settings = new OpenAIPromptExecutionSettings
{
    ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions
};

var result = await kernel.InvokePromptAsync(
    "What is the status of order ORD-1002?",
    new KernelArguments(settings));

Console.WriteLine(result);

public sealed class OrderPlugin
{
    private static readonly Dictionary<string, string> Orders = new()
    {
        ["ORD-1001"] = "shipped",
        ["ORD-1002"] = "awaiting payment",
    };

    [KernelFunction, Description("Return the status of a single order by its ID.")]
    public string GetOrderStatus([Description("Order ID, for example ORD-1001")] string orderId) =>
        Orders.TryGetValue(orderId, out var status) ? status : "not found";
}
```

The plugin is a normal C# class, which means dependency injection, unit tests and your existing logging all apply. That is why I think Semantic Kernel is the default for .NET teams that want to add model-driven features to an existing application, rather than build an "agent" as a separate thing. The [Semantic Kernel overview on Microsoft Learn](https://learn.microsoft.com/semantic-kernel/overview/) is the place to start.

Where it's weaker: multi-agent support is limited to the alpha `Microsoft.SemanticKernel.Experimental.Agents` package, built on the OpenAI Assistants API, with nothing comparable to AutoGen's group chat; the community and integration catalogue are smaller than LangChain's, and the Python SDK lags the C# one.

## Things I've stopped doing

- **Comparing frameworks on a toy benchmark.** Latency and token counts depend far more on your prompts, model deployment and number of turns than on the framework. A three-agent design will use more tokens than a single agent with tools, whichever library you use. Measure your own task.
- **Choosing a framework before I know the flow.** If I can write the steps down in order, I don't need a model to pick the next step. Plain code plus one or two model calls beats every framework on cost and debuggability.
- **Mixing frameworks in one process to get "the best of each".** You can register a LangChain retriever as an AutoGen function, and it works. But you now track two sets of breaking changes, and with CrewAI's exact LangChain pin you may not be able to install them together at all.

## How I'd choose today

- **.NET team adding AI to an existing application:** Semantic Kernel 1.0. It's the only one of the four with a stable API commitment on the language you're already using.
- **Python, and retrieval is the core of the problem:** LangChain 0.1, using the new agent constructors and keeping agents thin.
- **Code generation and data analysis with a human in the loop:** AutoGen, with Docker execution and a hard reply limit.
- **A role-based prototype you need to show a stakeholder this week:** CrewAI, pinned, with the expectation that you'll rewrite it.

Whichever you pick, pin the version, read the release notes before upgrading, and keep your business logic in plain functions the framework calls. That last habit is what lets you switch frameworks later without starting over. For the coordination patterns that sit underneath all four, see [multi-agent systems](/blog/2024-01-09-multi-agent-systems/).
