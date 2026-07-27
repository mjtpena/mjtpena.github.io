---
title: "Azure Durable Functions: Orchestration Patterns"
author: Michael John Peña
draft: false
date: 2020-10-11
tags:
  - Azure
  - Functions
  - Serverless
  - Orchestration
---

Function chaining, fan-out/fan-in, human interaction, and eternal orchestrations — Durable Functions exposes a small set of patterns that cover most workflow scenarios you'd otherwise reach for Logic Apps or a worker service to handle. Once you've internalised the constraint that orchestrators must be deterministic (no `DateTime.Now`, no random, no direct I/O), the rest reads like normal async/await code that just happens to survive across hours and machine restarts.

## Function Chaining

Execute functions in sequence, passing outputs as inputs.

```csharp
[FunctionName("ChainOrchestrator")]
public static async Task<string> RunOrchestrator(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var x = await context.CallActivityAsync<string>("Step1", null);
    var y = await context.CallActivityAsync<string>("Step2", x);
    var z = await context.CallActivityAsync<string>("Step3", y);
    return z;
}

[FunctionName("Step1")]
public static string Step1([ActivityTrigger] string input) => "Result1";

[FunctionName("Step2")]
public static string Step2([ActivityTrigger] string input) => $"{input}-Result2";

[FunctionName("Step3")]
public static string Step3([ActivityTrigger] string input) => $"{input}-Result3";
```

## Fan-Out/Fan-In

Process items in parallel, then aggregate results.

```csharp
[FunctionName("FanOutFanIn")]
public static async Task<int[]> RunFanOut(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var tasks = new List<Task<int>>();

    // Fan out
    for (int i = 0; i < 10; i++)
    {
        tasks.Add(context.CallActivityAsync<int>("ProcessItem", i));
    }

    // Fan in
    int[] results = await Task.WhenAll(tasks);
    return results;
}

[FunctionName("ProcessItem")]
public static int ProcessItem([ActivityTrigger] int item)
{
    return item * item;
}
```

## Human Interaction Pattern

Wait for external events with timeout.

```csharp
[FunctionName("ApprovalWorkflow")]
public static async Task<string> RunApproval(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var requestId = context.GetInput<string>();

    // Send approval request
    await context.CallActivityAsync("SendApprovalRequest", requestId);

    // Wait for approval with timeout
    using var cts = new CancellationTokenSource();
    var timeoutTask = context.CreateTimer(
        context.CurrentUtcDateTime.AddHours(72), cts.Token);
    var approvalTask = context.WaitForExternalEvent<bool>("ApprovalEvent");

    var winner = await Task.WhenAny(timeoutTask, approvalTask);

    if (winner == approvalTask)
    {
        cts.Cancel();
        return approvalTask.Result ? "Approved" : "Rejected";
    }

    return "Timed out";
}
```

## Raising External Events

```bash
# HTTP endpoint to raise event
POST /runtime/webhooks/durabletask/instances/{instanceId}/raiseEvent/ApprovalEvent
Content-Type: application/json

true
```

## Sub-Orchestrations

Compose complex workflows from smaller orchestrations.

```csharp
[FunctionName("MainOrchestrator")]
public static async Task RunMain(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    // Call sub-orchestration
    await context.CallSubOrchestratorAsync("SubOrchestrator", "input-data");
}
```

## Eternal Orchestrations

Long-running workflows that restart themselves.

```csharp
[FunctionName("EternalOrchestrator")]
public static async Task RunEternal(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var counter = context.GetInput<int>();

    await context.CallActivityAsync("DoWork", counter);

    // Wait before next iteration
    await context.CreateTimer(
        context.CurrentUtcDateTime.AddMinutes(5), CancellationToken.None);

    // Restart with incremented counter
    context.ContinueAsNew(counter + 1);
}
```

Durable Functions make stateful serverless simple.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
