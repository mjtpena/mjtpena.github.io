---
title: "Azure Functions Input/Output Bindings: Declarative Data Access"
author: Michael John Peña
draft: false
date: 2020-10-20
tags:
  - Azure
  - Functions
  - Serverless
  - Bindings

---

I wrote "Azure Functions Input/Output Bindings: Declarative Data Access" to share practical, production-minded guidance on this topic.

## Binding Types

- **Trigger**: What starts the function
- **Input**: Data to read
- **Output**: Where to write results

## Cosmos DB Bindings

```csharp
// Input binding - read document
[FunctionName("GetOrder")]
public static IActionResult GetOrder(
    [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequest req,
    [CosmosDB(
        databaseName: "orders-db",
        containerName: "orders",
        Connection = "CosmosDBConnection",
        Id = "{Query.orderId}",
        PartitionKey = "{Query.customerId}"
    )] Order order)
{
    return new OkObjectResult(order);
}

// Output binding - write document
[FunctionName("CreateOrder")]
public static IActionResult CreateOrder(
    [HttpTrigger(AuthorizationLevel.Function, "post")] Order order,
    [CosmosDB(
        databaseName: "orders-db",
        containerName: "orders",
        Connection = "CosmosDBConnection"
    )] out dynamic document)
{
    document = order;
    return new OkObjectResult(order);
}
```

## Blob Storage Bindings

```csharp
// Trigger on blob + output to another container
[FunctionName("ProcessImage")]
public static void ProcessImage(
    [BlobTrigger("uploads/{name}", Connection = "StorageConnection")] Stream inputBlob,
    [Blob("processed/{name}", FileAccess.Write, Connection = "StorageConnection")] Stream outputBlob,
    string name,
    ILogger log)
{
    log.LogInformation($"Processing blob: {name}");
    // Process and write to output
    inputBlob.CopyTo(outputBlob);
}
```

## Queue Bindings

```csharp
// Queue trigger with output to another queue
[FunctionName("ProcessMessage")]
public static void ProcessMessage(
    [QueueTrigger("input-queue", Connection = "StorageConnection")] string message,
    [Queue("output-queue", Connection = "StorageConnection")] out string outputMessage,
    ILogger log)
{
    outputMessage = $"Processed: {message}";
}

// Multiple output messages
[FunctionName("FanOut")]
public static void FanOut(
    [QueueTrigger("input-queue")] string message,
    [Queue("output-queue")] ICollector<string> outputMessages)
{
    for (int i = 0; i < 10; i++)
    {
        outputMessages.Add($"Message {i}: {message}");
    }
}
```

## Table Storage Bindings

```csharp
// Read from Table Storage
[FunctionName("GetEntity")]
public static IActionResult GetEntity(
    [HttpTrigger] HttpRequest req,
    [Table("customers", "{Query.partitionKey}", "{Query.rowKey}")] Customer customer)
{
    return new OkObjectResult(customer);
}

// Write to Table Storage
[FunctionName("SaveEntity")]
public static IActionResult SaveEntity(
    [HttpTrigger] Customer customer,
    [Table("customers")] out Customer tableEntity)
{
    tableEntity = customer;
    tableEntity.PartitionKey = customer.Region;
    tableEntity.RowKey = customer.Id;
    return new OkResult();
}
```

## Service Bus Bindings

```csharp
[FunctionName("ProcessServiceBus")]
public static async Task ProcessServiceBus(
    [ServiceBusTrigger("myqueue", Connection = "ServiceBusConnection")] string message,
    [ServiceBus("output-topic", Connection = "ServiceBusConnection")] IAsyncCollector<string> outputMessages,
    ILogger log)
{
    await outputMessages.AddAsync($"Processed: {message}");
}
```

## SignalR Bindings

```csharp
// Negotiate endpoint for SignalR clients
[FunctionName("negotiate")]
public static SignalRConnectionInfo Negotiate(
    [HttpTrigger] HttpRequest req,
    [SignalRConnectionInfo(HubName = "chat")] SignalRConnectionInfo connectionInfo)
{
    return connectionInfo;
}

// Send messages to SignalR hub
[FunctionName("broadcast")]
public static async Task Broadcast(
    [HttpTrigger] dynamic message,
    [SignalR(HubName = "chat")] IAsyncCollector<SignalRMessage> signalRMessages)
{
    await signalRMessages.AddAsync(new SignalRMessage
    {
        Target = "newMessage",
        Arguments = new[] { message }
    });
}
```

## Binding Expressions

```csharp
// Use trigger data in binding expressions
[FunctionName("DynamicBinding")]
public static void DynamicBinding(
    [QueueTrigger("orders")] Order order,
    [Blob("receipts/{OrderId}.json")] out string receipt)  // {OrderId} from trigger
{
    receipt = JsonConvert.SerializeObject(order);
}
```

Bindings let you focus on business logic, not plumbing.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
