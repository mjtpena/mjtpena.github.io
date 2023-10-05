---
title: “CQS (Command Query Separation) in Azure Functions”
author: Michael John Peña
draft: false
date: 2022-09-20
image: /2022/09/cqs-azure-functions-featured.png
url: /blog/cqs-azure-functions/
tags:
  - csharp
  - dotnet
  - azure
  - functions
  - CQS
  - mediatr
---

## Introduction

[Azure Functions](https://azure.microsoft.com/en-au/services/functions/) made it very easy to create services on the cloud. It’s very simple to get started just like [Logic Apps](https://azure.microsoft.com/en-au/services/logic-apps/), but also extensible like a full [ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/introduction-to-aspnet-core?view=aspnetcore-6.0) application (if you’re using .NET). You also have a variety of language options to choose from, so it’s not just exclusive to C# or .NET. It uses a serverless architecture so that you don’t need to maintain any runtime dependencies, operating system patches, and infrastructure maintenance as well. You then just focus on your business requirements on the behaviour that you want to create as a “function”.

More than just getting a hosted infrastructure, Azure Functions also make it easy to integrate with other set of services within and outside Azure. This is made possible with the concept of [Triggers and Bindings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings?tabs=csharp). Triggers allow you to execute a function when the condition is met like HTTP, Queue, Timer, Event Hubs, and Event Grid. Bindings are set of Platforms or Entities that a function can integrate with seamlessly without setting up complex integration scaffolding like: Cosmos DB, Azure SQL, Event Hubs, Queues, etc.

## CQS and Azure Functions

As a focus of this blog post, I’ll discuss why and how you can use CQS or Command Query Separation in Azure Functions. But why CQS and not CQRS?

### CQS (Command Query Separation)

CQS, as coined by _Bertrand Meyer_, mentions that methods should be divided into either a Query or a Command. A query returns a result changing no state in the system. A command then performs a change of state within a system.

### CQRS (Command Query Responsibility Segregation)

CQRS is a pattern that separates read and update (including insert) operations for a data store. Very similar to CQS, it also uses a concept of Command and Queries. What makes it different though is that there is a concept of grouping commands and queries based on their responsibility. This is much applicable for applications that use DDD (Domain Driven Design) where you might have end-to-end application including user interface. This approach makes maintenance of an application like ASP.NET Core apps to be easy, even if you have a lot of teams and interdependencies with other services.

### Why use CQS in Azure Functions?

In the perspective of Azure functions, in my opinion, the concept of Responsibility Segregation doesn’t really apply. By convention, you shouldn’t end up having an Azure Function App with 100+ functions in it. An Azure Function App should already have its own domain boundary with set of functions to serve the trigger and consume a data store. So that’s why I think CQS is much appropriate to Azure Functions rather than CQRS.

One advantage of Azure Functions over the traditional MVC architecture is that each function is already a well-defined unit of work that performs a specific business logic. You don’t use the concept of a controller that routes a request on to the desired service implementation ie CRUD (Create, Read, Update, Delete.) This means that a single function can be defined to perform any operation, regardless of its input type.

At some point, your Function App might grow in to more than just 1 function. But instead of creating a separate Function App altogether, they might share the same domain / context boundary. For example, if you want to create a micro-service for your crypto wallet; create a Get Balance function, together with the Transfer Money function and Withdraw Money function. These 3 functions are bounded to the same domain of a “Wallet”. Obviously, you can create 3 different Function Apps, but it might bring some management and maintenance overhead.

But what if I don’t want to use CQS? What other options can I use?

- Creating multiple Function Apps
- Use Repository Pattern but might end up having 1 giant repo file.
- Use Event Sourcing (but can work hand in hand with CQS as well)

### How to structure your Function App?

Below is a diagram that I drew to illustrate the CQS in Azure Functions. Triggers are the ones that will serve as the ones creating requests for your Function App.

![[CQS (Command Query Separation) in Azure Functions.png]]

The trigger will act as your entry point to either perform a command or query. This shouldn’t be confused with the trigger direction. In Azure Functions, it supports either an input or output trigger - they will still classify as input to your CQS.

You will then have a set of services (functions) within the Function App that performs different operations. Each function will then reference either a command or query, and pass/retrieve in a model (or a DTO - Data Transfer Object).

A query will perform a data store consumption operator (usually a Read record) and serve it back as a response. No change in state happened in the system. However, no one is stopping you to also perform a log operation for all queries.

A command will perform a state mutation. This means that a command is not just a write/update database operation. You can also use a command to send a message to a message broker (like Kafka), publish a message to a web socket, or even create a push notification.

_As of writing, I only know how to implement this in C# and .NET. But the concept and fundamentals should apply to most languages and frameworks._

To implement CQS in Azure Functions, you need:

- [MediatR](https://github.com/jbogard/MediatR) - to structure Commands and Queries resolution
- Optional: Your data store connection mapper: Entity Framework, Dapper, etc.

You can see [this example in GitHub](https://github.com/mjtpena/AzureFunctions.Samples/tree/main/CQS). The sample uses .NET Isolated process but should be re-usable for in-process type as well. Now let’s look at how I implement this structure.

### Folder Structures

I prefer to separate each function from its own folder. Instead of creating a folder called “Commands” or “Queries”, I prefer to embed the actual files related to that function in one coherent location.

I use the nomenclature: **Noun.Verb** in order to make sure all nouns that are related is sorted alphabetically.

![img](/2022/09/cqs-azure-functions-01.png)

Then inside a function, I create at least 4 files:

![img](/2022/09/cqs-azure-functions-02.png)

1. The actual function class
2. Command or Query class
3. Handler class
4. Result class
5. Optional: Validators

Again, this is just a preference as this works best for me.

### Adding MediatR

To get started, in your Program.cs, add MediatR as a service.

```csharp

using Microsoft.Extensions.Hosting;
using MediatR;

var host = new HostBuilder()
	.ConfigureFunctionsWorkerDefaults()
	.ConfigureServices(services =>{
		services.AddMediatR(typeof(Program));
	})
.Build();

host.Run();
```

### Creating a Query

First, we create the actual function just like the one below:

```csharp

[Function(nameof(GetMoneyBalanceFunction))]
public async Task<HttpResponseData> GetMoneyBalance([HttpTrigger(AuthorizationLevel.Function, “get”, Route = “money/balance”)]
HttpRequestData req, string WalletAddress)
{
	var query = new MoneyBalanceQuery
	{
		WalletAddress = WalletAddress
	};

	var result = await _mediator.Send(query);
	var response = req.CreateResponse();

	if (result == null)
	{
		response.StatusCode = HttpStatusCode.BadRequest;
	}

	await response.WriteAsJsonAsync(result);

	return response;
}
```

This is a function that uses an HttpTrigger (just like a REST API) and returns an HTTP response.

The important line here is that we create a query object and send it to a mediator. It will then return the query result object. From there you can now return that result object as part of your HTTP response.

We then need to create the query class as below:

```csharp
public class MoneyBalanceQuery:IRequest<MoneyBalanceResult>
{
	public string? WalletAddress { get; set; }
}
```

This implements the IRequest interface of MediatR and is expecting to return an object of type MoneyBalanceResult. All properties inside this class are request parameters that are included in this query.

We then create the result class like this:

```csharp
public class MoneyBalanceResult
{
	public string? WalletAddress { get; set; }
	public decimal Balance { get; set; }
}
```

This is just a simple DTO (Data Transfer Object) that you return from a data store. Sometimes, you might also want to do some methods here, such as parsing to JSON.

Last, we then create the handler class. This is the class where your query is actually implemented to return the desired result.

```csharp
public class MoneyBalanceQueryHandler:IRequestHandler<MoneyBalanceQuery, MoneyBalanceResult>
{
	public async Task<MoneyBalanceResult> Handle(MoneyBalanceQuery request, CancellationToken cancellationToken)
	{
		//DB Operations or other external services to fetch data
		await Task.Delay(1000);

		return new MoneyBalanceResult{
			WalletAddress = request.WalletAddress,
			Balance = 7777
		};
	}
}
```

For this demo, we just return a fake value. But if you’re going to read a row in a database, this is where you’ll implement it.

Now to test the query using Curl (make sure your Functions App is running):

```shell
curl http://localhost:7071/api/money/balance
```

![img](/2022/09/cqs-azure-functions-03.png)

All files mentioned above can be found [here](https://github.com/mjtpena/AzureFunctions.Samples/tree/main/CQS/Money.Balance).

### Creating a Command

We create a function class just like below.

```csharp
[Function(nameof(MoneyTransferFunction))]
public async Task<HttpResponseData> PostMoneyTransfer([HttpTrigger(AuthorizationLevel.Function, “post”, Route = “money/transfer”)]
HttpRequestData req)
{
	var command = new MoneyTransferCommand
	{
		FromWalletAddress = “0x1...”,
		ToWalletAddress = “0x2...”,
		Amount = 777
	};

	var result = await _mediator.Send(command);

	var response = req.CreateResponse();

	await response.WriteAsJsonAsync(result);

	return response;
}
```

The idea is to create a command object, and then send it to the mediator class to resolve the expected response object.

You then create the command class with a set of input parameters. This implements the IRequest interface that accepts the command result.

```csharp
public class MoneyTransferCommand:IRequest<MoneyTransferCommandResult>
{
    public string? FromWalletAddress { get; set; }
    public string? ToWalletAddress { get; set; }
    public decimal Amount { get; set; }
}
```

In other implementation, the result is not required in a command. Wherein something like `IRequest<bool>` is enough to know if the command was successful or not. But, I still prefer to return a success flag together with a message.

```csharp
public class MoneyTransferCommandResult
{
	public bool Success { get; set; }
	public string? Message { get; set; }
}
```

You then create the handler class. Inside the handle method, you then perform all the state changes that you want to implement.

```csharp
public class MoneyTransferCommandHandler:IRequestHandler<MoneyTransferCommand, MoneyTransferCommandResult>
{
    public async Task<MoneyTransferCommandResult> Handle(MoneyTransferCommand request, CancellationToken cancellationToken)
    {
        //Command Operations: Save to DB, Send to Event Hubs, etc
        await Task.Delay(1000);
       
        return new MoneyTransferCommandResult{
            Success = true,
            Message = “Transfer successful with 0x123123123 hash”
        };
    }
}
```

All files mentioned above can be found [here](https://github.com/mjtpena/AzureFunctions.Samples/tree/main/CQS/Money.Transfer).

Testing this with curl:

```
curl -d “REQUEST PARAMS” -X POST http://localhost:7071/api/money/transfer
```

![img](/2022/09/cqs-azure-functions-04.png)

🎉 Congratulations! You now adopted CQS pattern on your Azure Functions App.

## Summary

- CQS is a pattern to separate Commands (state changes) and Queries.
- You can use MediatR to implement CQS in Azure Functions (C# and .NET).
- CQS will allow you to structure your functions app in an organized and coherent manner.

---

References:

- [command query separation - Difference between CQRS and CQS - Stack Overflow](https://stackoverflow.com/questions/34255490/difference-between-cqrs-and-cqs)
- [CommandQuerySeparation (martinfowler.com)](https://www.martinfowler.com/bliki/CommandQuerySeparation.html)
- [AzureFunctions.Samples/CQS at main · mjtpena/AzureFunctions.Samples (github.com)](https://github.com/mjtpena/AzureFunctions.Samples/tree/main/CQS)
- [CQRS pattern - Azure Architecture Center | Microsoft Learn](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
