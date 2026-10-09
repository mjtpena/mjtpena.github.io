---
title: "Building Reliable Workflows with Durable Functions Orchestrations"
description: "Durable Functions provide the reliability and coordination capabilities needed for complex serverless workflows, while maintaining the cost benefits of…"
author: Michael John Peña
draft: false
date: 2020-08-25
tags:
  - Azure
  - Azure Functions
  - Durable Functions
  - Serverless
---

## What are Durable Functions?

Durable Functions extend Azure Functions with:
- **Orchestrator functions** - Define workflows
- **Activity functions** - Perform work
- **Entity functions** - Manage state
- **Client functions** - Start and interact with orchestrations

## Setting Up

```bash
# Create a function app with Durable Functions
func init DurableFunctionsApp --dotnet
cd DurableFunctionsApp

# Add Durable Functions package
dotnet add package Microsoft.Azure.WebJobs.Extensions.DurableTask
```

## Basic Orchestration Pattern

```csharp
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.DurableTask;
using Microsoft.Azure.WebJobs.Extensions.Http;

public static class OrderProcessingOrchestration
{
    [FunctionName("ProcessOrder")]
    public static async Task<OrderResult> RunOrchestrator(
        [OrchestrationTrigger] IDurableOrchestrationContext context)
    {
        var order = context.GetInput<Order>();

        // Step 1: Validate order
        var isValid = await context.CallActivityAsync<bool>("ValidateOrder", order);
        if (!isValid)
        {
            return new OrderResult { Status = "Invalid", OrderId = order.Id };
        }

        // Step 2: Reserve inventory
        var inventoryReserved = await context.CallActivityAsync<bool>("ReserveInventory", order);
        if (!inventoryReserved)
        {
            return new OrderResult { Status = "OutOfStock", OrderId = order.Id };
        }

        // Step 3: Process payment
        var paymentResult = await context.CallActivityAsync<PaymentResult>("ProcessPayment", order);
        if (!paymentResult.Success)
        {
            // Compensate - release inventory
            await context.CallActivityAsync("ReleaseInventory", order);
            return new OrderResult { Status = "PaymentFailed", OrderId = order.Id };
        }

        // Step 4: Create shipment
        var shipment = await context.CallActivityAsync<Shipment>("CreateShipment", order);

        // Step 5: Send confirmation
        await context.CallActivityAsync("SendConfirmation", new ConfirmationRequest
        {
            Order = order,
            Shipment = shipment,
            PaymentId = paymentResult.TransactionId
        });

        return new OrderResult
        {
            Status = "Completed",
            OrderId = order.Id,
            ShipmentId = shipment.Id
        };
    }

    [FunctionName("ValidateOrder")]
    public static bool ValidateOrder([ActivityTrigger] Order order, ILogger log)
    {
        log.LogInformation($"Validating order {order.Id}");
        return order.Items?.Any() == true && !string.IsNullOrEmpty(order.CustomerId);
    }

    [FunctionName("ReserveInventory")]
    public static async Task<bool> ReserveInventory(
        [ActivityTrigger] Order order,
        [CosmosDB("inventory", "items", ConnectionStringSetting = "CosmosDB")] IAsyncCollector<InventoryReservation> reservations,
        ILogger log)
    {
        log.LogInformation($"Reserving inventory for order {order.Id}");

        foreach (var item in order.Items)
        {
            await reservations.AddAsync(new InventoryReservation
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                Quantity = item.Quantity,
                ReservedAt = DateTime.UtcNow
            });
        }

        return true;
    }

    [FunctionName("ProcessPayment")]
    public static async Task<PaymentResult> ProcessPayment(
        [ActivityTrigger] Order order,
        ILogger log)
    {
        log.LogInformation($"Processing payment for order {order.Id}");

        // Call payment gateway
        await Task.Delay(1000); // Simulate payment processing

        return new PaymentResult
        {
            Success = true,
            TransactionId = Guid.NewGuid().ToString()
        };
    }
}
```

## HTTP Client to Start Orchestration

```csharp
[FunctionName("StartOrderProcessing")]
public static async Task<IActionResult> StartOrderProcessing(
    [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req,
    [DurableClient] IDurableOrchestrationClient client,
    ILogger log)
{
    var order = await JsonSerializer.DeserializeAsync<Order>(req.Body);

    string instanceId = await client.StartNewAsync("ProcessOrder", order);

    log.LogInformation($"Started orchestration with ID = '{instanceId}'.");

    return client.CreateCheckStatusResponse(req, instanceId);
}
```

## Fan-Out/Fan-In Pattern

Process multiple items in parallel:

```csharp
[FunctionName("ProcessBatchOrchestrator")]
public static async Task<BatchResult> ProcessBatch(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var batch = context.GetInput<Batch>();

    // Fan-out: Start all tasks in parallel
    var tasks = batch.Items.Select(item =>
        context.CallActivityAsync<ItemResult>("ProcessItem", item));

    // Fan-in: Wait for all to complete
    var results = await Task.WhenAll(tasks);

    // Aggregate results
    return new BatchResult
    {
        BatchId = batch.Id,
        TotalProcessed = results.Length,
        SuccessCount = results.Count(r => r.Success),
        FailedCount = results.Count(r => !r.Success),
        Results = results.ToList()
    };
}

[FunctionName("ProcessItem")]
public static async Task<ItemResult> ProcessItem(
    [ActivityTrigger] BatchItem item,
    ILogger log)
{
    log.LogInformation($"Processing item {item.Id}");

    try
    {
        // Process the item
        await Task.Delay(500);

        return new ItemResult { ItemId = item.Id, Success = true };
    }
    catch (Exception ex)
    {
        return new ItemResult { ItemId = item.Id, Success = false, Error = ex.Message };
    }
}
```

## Human Interaction Pattern

Wait for external events:

```csharp
[FunctionName("ApprovalWorkflow")]
public static async Task<string> ApprovalWorkflow(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var request = context.GetInput<ApprovalRequest>();

    // Send approval request notification
    await context.CallActivityAsync("SendApprovalRequest", request);

    // Wait for approval event with timeout
    using var cts = new CancellationTokenSource();
    var approvalTask = context.WaitForExternalEvent<ApprovalResponse>("ApprovalResponse");
    var timeoutTask = context.CreateTimer(
        context.CurrentUtcDateTime.AddHours(24),
        cts.Token);

    var winner = await Task.WhenAny(approvalTask, timeoutTask);

    if (winner == approvalTask)
    {
        cts.Cancel();
        var response = approvalTask.Result;

        if (response.Approved)
        {
            await context.CallActivityAsync("ProcessApprovedRequest", request);
            return "Approved";
        }
        else
        {
            await context.CallActivityAsync("NotifyRejection", request);
            return "Rejected";
        }
    }
    else
    {
        await context.CallActivityAsync("NotifyTimeout", request);
        return "Timeout";
    }
}

// Raise the event from HTTP
[FunctionName("SubmitApproval")]
public static async Task<IActionResult> SubmitApproval(
    [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req,
    [DurableClient] IDurableOrchestrationClient client)
{
    var instanceId = req.Query["instanceId"];
    var response = await JsonSerializer.DeserializeAsync<ApprovalResponse>(req.Body);

    await client.RaiseEventAsync(instanceId, "ApprovalResponse", response);

    return new OkResult();
}
```

## Error Handling and Retry

```csharp
[FunctionName("ResilientOrchestrator")]
public static async Task<string> ResilientOrchestrator(
    [OrchestrationTrigger] IDurableOrchestrationContext context)
{
    var retryOptions = new RetryOptions(
        firstRetryInterval: TimeSpan.FromSeconds(5),
        maxNumberOfAttempts: 3)
    {
        BackoffCoefficient = 2.0,
        MaxRetryInterval = TimeSpan.FromMinutes(1),
        RetryTimeout = TimeSpan.FromMinutes(5)
    };

    try
    {
        await context.CallActivityWithRetryAsync("UnreliableActivity", retryOptions, "input");
        return "Success";
    }
    catch (FunctionFailedException ex)
    {
        // All retries failed
        await context.CallActivityAsync("HandleFailure", ex.Message);
        return "Failed";
    }
}
```

## Monitoring Orchestrations

```csharp
[FunctionName("GetOrchestrationStatus")]
public static async Task<IActionResult> GetStatus(
    [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequest req,
    [DurableClient] IDurableOrchestrationClient client)
{
    var instanceId = req.Query["instanceId"];

    var status = await client.GetStatusAsync(instanceId, showHistory: true);

    if (status == null)
    {
        return new NotFoundResult();
    }

    return new OkObjectResult(new
    {
        status.InstanceId,
        status.RuntimeStatus,
        status.CreatedTime,
        status.LastUpdatedTime,
        status.Output
    });
}
```

Durable Functions provide the reliability and coordination capabilities needed for complex serverless workflows, while maintaining the cost benefits of serverless computing.

The constraint people miss until they trip over it: orchestrator code must be *deterministic*. No `DateTime.Now`, no random numbers, no direct HTTP calls — those go in activity functions. The orchestrator is replayed from history on every step, so any non-determinism breaks the replay model. Read the constraint list once, internalise it, and you'll save yourself a confusing afternoon.
