---
title: C# 10 Preview Features for Modern Development
author: Michael John Peña
draft: false
date: 2021-06-05
url: /blog/csharp-10-preview-features/
tags:
  - C#
  - .NET
  - Programming
  - Preview
---

C# 10 is the language release I've been most anticipating in a long time. Record structs, global usings, file-scoped namespaces, extended property patterns—these aren't dramatic paradigm shifts, but they're exactly the quality-of-life improvements that accumulate into significantly cleaner code across a large codebase. The boilerplate reduction is real: global usings alone removed the repetitive `using` block from the top of several hundred files in one project I migrated. This post covers the features that are ready in Preview 4 and the ones that change how I'll structure C# projects from November onward.

## Record Structs

C# 9 introduced records as reference types. C# 10 extends this to value types:

```csharp
// Record struct - value type with value equality
public record struct Point(int X, int Y);

// Readonly record struct - immutable value type
public readonly record struct ImmutablePoint(int X, int Y);

// Usage
var p1 = new Point(3, 4);
var p2 = new Point(3, 4);

Console.WriteLine(p1 == p2);  // True - value equality
Console.WriteLine(p1.GetHashCode() == p2.GetHashCode());  // True

// With mutation syntax
var p3 = p1 with { X = 5 };
Console.WriteLine(p3);  // Point { X = 5, Y = 4 }
```

### When to Use Record Structs

```csharp
// Good for small, immutable data
public readonly record struct Money(decimal Amount, string Currency);
public readonly record struct GeoCoordinate(double Latitude, double Longitude);
public readonly record struct DateRange(DateOnly Start, DateOnly End);

// Using in collections
var prices = new List<Money>
{
    new(100.00m, "USD"),
    new(85.50m, "EUR"),
    new(130.00m, "AUD")
};
```

## Global Using Directives

Reduce repetitive using statements across files:

```csharp
// GlobalUsings.cs - applies to entire project
global using System;
global using System.Collections.Generic;
global using System.Linq;
global using System.Threading.Tasks;
global using Microsoft.Extensions.Logging;
global using Azure.Storage.Blobs;
global using Newtonsoft.Json;
```

### Project File Configuration

```xml
<!-- In .csproj file -->
<ItemGroup>
  <Using Include="System" />
  <Using Include="System.Collections.Generic" />
  <Using Include="System.Linq" />
  <Using Include="System.Threading.Tasks" />
  <Using Include="Microsoft.Extensions.Logging" />

  <!-- With alias -->
  <Using Include="System.Text.Json" Alias="Json" />

  <!-- Static using -->
  <Using Include="System.Math" Static="true" />
</ItemGroup>
```

## File-Scoped Namespaces

Reduce indentation by one level:

```csharp
// Before C# 10
namespace MyCompany.Services.Weather
{
    public class WeatherService
    {
        public async Task<Forecast> GetForecastAsync(string location)
        {
            // Implementation with extra indentation
        }
    }
}

// C# 10 - file-scoped namespace
namespace MyCompany.Services.Weather;

public class WeatherService
{
    public async Task<Forecast> GetForecastAsync(string location)
    {
        // One less level of indentation
    }
}
```

## Constant Interpolated Strings

String interpolation now works with constants:

```csharp
public static class ApiRoutes
{
    private const string Base = "/api/v1";

    // Now valid in C# 10!
    public const string Products = $"{Base}/products";
    public const string Orders = $"{Base}/orders";
    public const string Customers = $"{Base}/customers";
}

// Usage
[HttpGet(ApiRoutes.Products)]
public async Task<IActionResult> GetProducts() => Ok(await _service.GetAllAsync());
```

## Extended Property Patterns

Simplified nested property patterns:

```csharp
public record Address(string Street, string City, string Country);
public record Customer(string Name, Address Address);

// Before C# 10
if (customer is { Address: { Country: "Australia" } })
{
    ApplyAustralianTax(customer);
}

// C# 10 - extended property pattern
if (customer is { Address.Country: "Australia" })
{
    ApplyAustralianTax(customer);
}

// Multiple nested properties
if (order is { Customer.Address.Country: "USA", Total: > 100 })
{
    ApplyFreeShipping(order);
}
```

## Sealed Record ToString

Prevent derived records from overriding ToString:

```csharp
public record Person(string Name)
{
    public sealed override string ToString() => $"Person: {Name}";
}

public record Employee(string Name, string Department) : Person(Name)
{
    // Cannot override ToString - it's sealed in base
}
```

## Improved Lambda Expressions

### Natural Type for Lambdas

```csharp
// C# 10 can infer delegate types
var add = (int a, int b) => a + b;  // Inferred as Func<int, int, int>
var print = (string s) => Console.WriteLine(s);  // Inferred as Action<string>

// Explicit return type
var parse = (string s) => int.Parse(s);  // Func<string, int>
var tryParse = int (string s) => int.TryParse(s, out var result) ? result : 0;
```

### Lambda Attributes

```csharp
// Attributes on lambdas
var handler = [Authorize] async (HttpContext context) =>
{
    await context.Response.WriteAsync("Hello, authenticated user!");
};

// Attributes on parameters
var greet = ([FromQuery] string name) => $"Hello, {name}!";
```

## CallerArgumentExpression

Capture the expression passed as an argument:

```csharp
public static class Guard
{
    public static void NotNull<T>(
        T? value,
        [CallerArgumentExpression("value")] string? expression = null)
    {
        if (value is null)
        {
            throw new ArgumentNullException(expression);
        }
    }

    public static void Positive(
        int value,
        [CallerArgumentExpression("value")] string? expression = null)
    {
        if (value <= 0)
        {
            throw new ArgumentException(
                $"'{expression}' must be positive, but was {value}");
        }
    }
}

// Usage
public void ProcessOrder(Order? order, int quantity)
{
    Guard.NotNull(order);  // Throws: "order"
    Guard.Positive(quantity);  // Throws: "'quantity' must be positive..."

    // Process...
}
```

## Improved Struct Initialization

Parameterless constructors and field initializers in structs:

```csharp
public struct Configuration
{
    public string Server { get; set; } = "localhost";
    public int Port { get; set; } = 8080;
    public bool UseSSL { get; set; } = true;

    // Parameterless constructor now allowed
    public Configuration()
    {
        // Additional initialization if needed
    }

    public Configuration(string server, int port)
    {
        Server = server;
        Port = port;
    }
}

// Usage
var config1 = new Configuration();  // Uses defaults
var config2 = new Configuration("api.example.com", 443);
```

## With Expressions for Structs

Non-destructive mutation for structs:

```csharp
public struct Rectangle
{
    public int Width { get; init; }
    public int Height { get; init; }

    public int Area => Width * Height;
}

var rect1 = new Rectangle { Width = 10, Height = 5 };
var rect2 = rect1 with { Width = 20 };

Console.WriteLine(rect2.Width);   // 20
Console.WriteLine(rect2.Height);  // 5 (unchanged)
```

## Interpolated String Handlers

Custom handling for interpolated strings:

```csharp
[InterpolatedStringHandler]
public ref struct LogInterpolatedStringHandler
{
    private readonly StringBuilder _builder;
    private readonly bool _isEnabled;

    public LogInterpolatedStringHandler(
        int literalLength,
        int formattedCount,
        ILogger logger,
        LogLevel level,
        out bool isEnabled)
    {
        _isEnabled = isEnabled = logger.IsEnabled(level);
        _builder = isEnabled ? new StringBuilder(literalLength) : null!;
    }

    public void AppendLiteral(string s)
    {
        if (_isEnabled) _builder.Append(s);
    }

    public void AppendFormatted<T>(T value)
    {
        if (_isEnabled) _builder.Append(value);
    }

    public string GetFormattedText() => _builder?.ToString() ?? string.Empty;
}

// Usage - the string is only built if logging is enabled
logger.LogInformation($"Processing order {orderId} with {itemCount} items");
```

## Generic Attributes

Use generics in attribute declarations:

```csharp
// C# 10 allows generic attributes
public class ValidatorAttribute<T> : Attribute where T : IValidator
{
    public Type ValidatorType => typeof(T);
}

// Usage
[Validator<OrderValidator>]
public class Order
{
    public int Id { get; set; }
    public decimal Total { get; set; }
}

// Retrieve at runtime
var attribute = typeof(Order).GetCustomAttribute<ValidatorAttribute<OrderValidator>>();
```

## Putting It All Together

Here's a complete example using multiple C# 10 features:

```csharp
// GlobalUsings.cs
global using System;
global using System.Collections.Generic;
global using System.Linq;
global using System.Threading.Tasks;

// Models.cs
namespace MyApp.Models;

public readonly record struct Money(decimal Amount, string Currency);

public record Customer(string Name, string Email)
{
    public List<Order> Orders { get; init; } = new();
}

public record Order(int Id, Money Total, DateTime CreatedAt);

// Services.cs
namespace MyApp.Services;

public class OrderService
{
    public async Task<Order> CreateOrderAsync(Customer customer, Money total)
    {
        Guard.NotNull(customer);
        Guard.Positive((int)total.Amount);

        var order = new Order(
            Id: GenerateId(),
            Total: total,
            CreatedAt: DateTime.UtcNow);

        // Notify if high-value customer
        if (customer is { Orders.Count: > 10 })
        {
            await NotifyVipOrderAsync(customer, order);
        }

        return order;
    }

    private int GenerateId() => Random.Shared.Next();
    private Task NotifyVipOrderAsync(Customer c, Order o) => Task.CompletedTask;
}
```

## Conclusion

C# 10 brings features that significantly reduce boilerplate and improve code expressiveness. Record structs provide value-type semantics with record convenience, global usings clean up file headers, and file-scoped namespaces reduce indentation. These incremental improvements compound to make C# development more enjoyable and productive.

## References

- [C# 10 Features](https://docs.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-10)
- [.NET Blog C# Announcements](https://devblogs.microsoft.com/dotnet/)
