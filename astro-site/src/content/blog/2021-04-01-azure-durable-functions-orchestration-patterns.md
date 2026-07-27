---
title: Azure Durable Functions Orchestration Patterns
author: Michael John Peña
draft: false
date: 2021-04-01
url: /blog/azure-durable-functions-orchestration-patterns/
tags:
  - Azure
  - Azure Functions
  - Durable Functions
  - Serverless
  - Cloud Architecture

---

I wrote "2021-04-01-azure-durable-functions-orchestration-patterns" to share practical, production-minded guidance on this topic.

## Understanding the Basics

Durable Functions introduce three key function types:

1. **Orchestrator Functions** - Define the workflow logic
2. **Activity Functions** - Perform the actual work
3. **Client Functions** - Trigger orchestrations

The magic happens through the Durable Task Framework, which handles state persistence, checkpointing, and replay automatically.

## Pattern 1: Function Chaining

The simplest pattern chains activities in sequence, where each step depends on the previous result.

```csharp
[FunctionName("ProcessOrderOrchestrator")]
public static async Task<OrderResult> RunOrchestrator(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var order = context.GetInput<Order>();

    // Step 1: Validate order
    var validatedOrder = await context.CallActivityAsync<Order>(
        "ValidateOrder", order);

    // Step 2: Reserve inventory
    var reservation = await context.CallActivityAsync<Reservation>(
        "ReserveInventory", validatedOrder);

    // Step 3: Process payment
    var payment = await context.CallActivityAsync<PaymentResult>(
        "ProcessPayment", new PaymentRequest(validatedOrder, reservation));

    // Step 4: Ship order
    var shipment = await context.CallActivityAsync<Shipment>(
        "ShipOrder", new ShipmentRequest(validatedOrder, payment));

    return new OrderResult(validatedOrder, reservation, payment, shipment);
}
```

## Pattern 2: Fan-Out/Fan-In

When you need parallel processing, fan-out/fan-in is your pattern. This is particularly useful for batch processing scenarios.

```csharp
[FunctionName("BatchProcessOrchestrator")]
public static async Task<ProcessingResult> RunOrchestrator(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var workItems = context.GetInput<List<WorkItem>>();

    // Fan-out: Start all tasks in parallel
    var parallelTasks = new List<Task<ItemResult>>();
    foreach (var item in workItems)
    {
        Task<ItemResult> task = context.CallActivityAsync<ItemResult>(
            "ProcessItem", item);
        parallelTasks.Add(task);
    }

    // Fan-in: Wait for all to complete
    ItemResult[] results = await Task.WhenAll(parallelTasks);

    // Aggregate results
    return await context.CallActivityAsync<ProcessingResult>(
        "AggregateResults", results);
}
```

## Pattern 3: Async HTTP APIs

For long-running operations, Durable Functions provide built-in HTTP polling endpoints.

```csharp
[FunctionName("StartLongRunningProcess")]
public static async Task<HttpResponseMessage> HttpStart(
    [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequestMessage req,
    [DurableClient] IDurableOrchestrationClient starter,
    ILogger log)
{
    var requestBody = await req.Content.ReadAsAsync<ProcessRequest>();

    string instanceId = await starter.StartNewAsync(
        "LongRunningOrchestrator", requestBody);

    log.LogInformation($"Started orchestration with ID = '{instanceId}'.");

    // Returns URLs for status, terminate, and send event endpoints
    return starter.CreateCheckStatusResponse(req, instanceId);
}
```

The response includes management URLs:

```json
{
  "id": "instance-id",
  "statusQueryGetUri": "http://.../instances/instance-id",
  "sendEventPostUri": "http://.../instances/instance-id/raiseEvent/{eventName}",
  "terminatePostUri": "http://.../instances/instance-id/terminate"
}
```

## Pattern 4: Monitor Pattern

The monitor pattern implements recurring processes with flexible intervals.

```csharp
[FunctionName("MonitorOrchestrator")]
public static async Task Run(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var input = context.GetInput<MonitorRequest>();
    DateTime endTime = context.CurrentUtcDateTime.AddHours(input.MaxDurationHours);

    while (context.CurrentUtcDateTime < endTime)
    {
        // Check the status
        var status = await context.CallActivityAsync<JobStatus>(
            "CheckJobStatus", input.JobId);

        if (status.IsComplete)
        {
            // Job finished - send notification
            await context.CallActivityAsync("SendNotification",
                new Notification($"Job {input.JobId} completed successfully!"));
            return;
        }

        // Not complete yet, wait before checking again
        var nextCheck = context.CurrentUtcDateTime.AddMinutes(5);
        await context.CreateTimer(nextCheck, CancellationToken.None);
    }

    // Timeout reached
    await context.CallActivityAsync("SendNotification",
        new Notification($"Job {input.JobId} monitoring timed out."));
}
```

## Pattern 5: Human Interaction

For workflows requiring human approval, use external events.

```csharp
[FunctionName("ApprovalOrchestrator")]
public static async Task<string> RunOrchestrator(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var request = context.GetInput<ApprovalRequest>();

    // Send approval request
    await context.CallActivityAsync("SendApprovalRequest", request);

    // Wait for approval event with timeout
    using (var timeoutCts = new CancellationTokenSource())
    {
        DateTime dueTime = context.CurrentUtcDateTime.AddHours(72);
        Task durableTimeout = context.CreateTimer(dueTime, timeoutCts.Token);

        Task<ApprovalResponse> approvalEvent = context.WaitForExternalEvent<ApprovalResponse>("ApprovalResponse");

        Task winner = await Task.WhenAny(approvalEvent, durableTimeout);

        if (winner == approvalEvent)
        {
            timeoutCts.Cancel();
            var response = approvalEvent.Result;

            if (response.Approved)
            {
                await context.CallActivityAsync("ProcessApproval", request);
                return "Approved";
            }
            else
            {
                await context.CallActivityAsync("HandleRejection", request);
                return "Rejected";
            }
        }
        else
        {
            await context.CallActivityAsync("HandleTimeout", request);
            return "Timed out";
        }
    }
}
```

Raise the event externally:

```csharp
[FunctionName("SubmitApproval")]
public static async Task<IActionResult> SubmitApproval(
    [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req,
    [DurableClient] IDurableOrchestrationClient client)
{
    string instanceId = req.Query["instanceId"];
    var response = await req.ReadFromJsonAsync<ApprovalResponse>();

    await client.RaiseEventAsync(instanceId, "ApprovalResponse", response);

    return new OkResult();
}
```

## Best Practices

1. **Keep orchestrators deterministic** - No I/O, random numbers, or DateTime.Now in orchestrators
2. **Use context.CurrentUtcDateTime** instead of DateTime.UtcNow
3. **Activities should be idempotent** - They may be retried
4. **Configure retry policies** for resilience

```csharp
var retryOptions = new RetryOptions(
    firstRetryInterval: TimeSpan.FromSeconds(5),
    maxNumberOfAttempts: 3)
{
    BackoffCoefficient = 2.0,
    MaxRetryInterval = TimeSpan.FromMinutes(5)
};

await context.CallActivityWithRetryAsync("UnreliableActivity", retryOptions, input);
```

## Conclusion

Durable Functions provide powerful primitives for building complex, stateful serverless applications. Whether you need simple chaining, parallel processing, or human-in-the-loop workflows, these patterns give you the building blocks for robust orchestrations. The automatic checkpointing and replay semantics mean you can focus on business logic rather than infrastructure concerns.

In my next post, I'll dive deeper into Durable Entities for actor-model patterns in serverless computing.

