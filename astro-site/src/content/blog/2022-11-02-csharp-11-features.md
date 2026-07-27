---
title: "C# 11 Features: Raw String Literals, Required Members, and More"
author: Michael John Peña
draft: false
date: 2022-11-02
tags:
  - C#
  - .NET
  - Programming
  - Development

---

I wrote "C# 11 Features: Raw String Literals, Required Members, and More" to share practical, production-minded guidance on this topic.

## Raw String Literals

No more escaping nightmares. Raw string literals start and end with at least three quotes:

```csharp
// Old way - escaping everything
var json = "{\n  \"name\": \"John\",\n  \"age\": 30\n}";

// C# 11 - raw string literals
var json = """
    {
        "name": "John",
        "age": 30
    }
    """;
```

They work with interpolation too - just add more dollar signs:

```csharp
var name = "Azure";
var config = $$"""
    {
        "service": "{{name}}",
        "settings": {
            "timeout": 30
        }
    }
    """;
```

This is particularly useful for embedding SQL, JSON, or XML:

```csharp
public async Task<IEnumerable<Order>> GetOrdersAsync(string customerId)
{
    var sql = """
        SELECT o.OrderId, o.OrderDate, o.Total
        FROM Orders o
        WHERE o.CustomerId = @CustomerId
            AND o.Status = 'Active'
        ORDER BY o.OrderDate DESC
        """;

    return await connection.QueryAsync<Order>(sql, new { CustomerId = customerId });
}
```

## Required Members

Enforce initialization without constructors:

```csharp
public class Person
{
    public required string FirstName { get; init; }
    public required string LastName { get; init; }
    public int? Age { get; init; }
}

// Compiler error if required members are missing
var person = new Person
{
    FirstName = "John",
    LastName = "Doe"
};

// This won't compile:
// var invalid = new Person { FirstName = "John" }; // Missing LastName
```

This is excellent for DTOs and configuration classes:

```csharp
public class AzureStorageConfig
{
    public required string ConnectionString { get; init; }
    public required string ContainerName { get; init; }
    public int MaxRetries { get; init; } = 3;
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);
}
```

## Generic Attributes

Attributes can now use generic type parameters:

```csharp
// Before C# 11
[TypeConverter(typeof(StringConverter))]
public class OldWay { }

// C# 11
public class ValidatorAttribute<T> : Attribute where T : IValidator
{
}

[Validator<EmailValidator>]
public class EmailAddress
{
    public string Value { get; set; }
}
```

## List Patterns

Pattern matching on lists and arrays:

```csharp
public string DescribeList(int[] numbers) => numbers switch
{
    [] => "Empty",
    [var single] => $"Single: {single}",
    [var first, var second] => $"Pair: {first}, {second}",
    [var first, .., var last] => $"First: {first}, Last: {last}",
    _ => "Unknown pattern"
};

// Validation example
public bool IsValidHeader(byte[] data) => data is [0x50, 0x4B, ..];
```

Powerful for parsing and validation:

```csharp
public record CommandResult(string[] Output);

public string ParseAzureCliOutput(CommandResult result) => result.Output switch
{
    ["Error:", var message, ..] => $"Failed: {message}",
    [var status] when status.Contains("Succeeded") => "Success",
    [_, _, var resourceId, ..] => $"Resource: {resourceId}",
    [] => "No output",
    _ => "Unknown result"
};
```

## File-Scoped Types

Limit type visibility to a single file:

```csharp
// DatabaseHelper.cs
file class ConnectionStringBuilder
{
    // This class is only visible within this file
    public string Build(string server, string database)
    {
        return $"Server={server};Database={database};Integrated Security=true";
    }
}

public class DatabaseHelper
{
    private readonly ConnectionStringBuilder _builder = new();

    public string GetConnectionString(string server, string database)
        => _builder.Build(server, database);
}
```

## UTF-8 String Literals

Efficient UTF-8 encoding at compile time:

```csharp
// Before - runtime conversion
byte[] utf8Bytes = Encoding.UTF8.GetBytes("Hello World");

// C# 11 - compile-time UTF-8
ReadOnlySpan<byte> utf8Bytes = "Hello World"u8;
```

This is particularly useful for HTTP headers and protocol implementations:

```csharp
public static class HttpHeaders
{
    public static ReadOnlySpan<byte> ContentType => "Content-Type"u8;
    public static ReadOnlySpan<byte> Authorization => "Authorization"u8;
    public static ReadOnlySpan<byte> JsonMediaType => "application/json"u8;
}
```

## Extended nameof Scope

Access parameter names in attributes:

```csharp
public class ValidationAttribute : Attribute
{
    public ValidationAttribute(string parameterName) { }
}

public class Calculator
{
    // nameof can now reference method parameters
    [Validation(nameof(value))]
    public int Double([NotNull] int value) => value * 2;
}
```

## Pattern Match Span on Constant String

Match spans against constant strings:

```csharp
public bool IsAzureEndpoint(ReadOnlySpan<char> url)
{
    return url is "https://azure.microsoft.com" or
                  "https://portal.azure.com" or
                  "https://management.azure.com";
}
```

## Practical Example: Azure Function with C# 11

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

public class OrderProcessor
{
    public required IOrderService OrderService { get; init; }
    public required ILogger<OrderProcessor> Logger { get; init; }

    [Function("ProcessOrder")]
    public async Task<HttpResponseData> ProcessOrderAsync(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
    {
        var order = await req.ReadFromJsonAsync<OrderRequest>();

        var validationResult = order switch
        {
            null => "Missing order data",
            { Items: [] } => "Order must contain items",
            { Items: [var single] } when single.Quantity <= 0 => "Invalid quantity",
            { CustomerId: null or "" } => "Customer ID required",
            _ => null
        };

        if (validationResult is not null)
        {
            var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
            await badRequest.WriteAsJsonAsync(new { error = validationResult });
            return badRequest;
        }

        var result = await OrderService.ProcessAsync(order!);

        var response = req.CreateResponse(HttpStatusCode.OK);
        var json = $$"""
            {
                "orderId": "{{result.OrderId}}",
                "status": "{{result.Status}}",
                "total": {{result.Total}}
            }
            """;
        await response.WriteStringAsync(json);
        return response;
    }
}

public class OrderRequest
{
    public required string CustomerId { get; init; }
    public required OrderItem[] Items { get; init; }
}

public record OrderItem(string ProductId, int Quantity, decimal Price);
```

## Conclusion

C# 11 brings features that make everyday coding more pleasant. Raw string literals alone are worth the upgrade for anyone dealing with embedded SQL, JSON, or configuration. Combined with required members and list patterns, the language continues to evolve toward more expressive and safer code.

## Resources

- [What's New in C# 11](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-11)
- [C# Language Reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/)

