---
title: "C# 10 Features: Writing Cleaner, More Expressive Code"
description: "C# 10 continues the trend of making the language more expressive while reducing boilerplate. Combined with .NET 6's performance improvements, it's a great…"
author: Michael John Pena
draft: false
date: 2021-11-02
tags:
  - C#
  - .NET
  - Programming
  - Development
---

## Record Structs

C# 9 introduced records as reference types. C# 10 extends this to value types:

```csharp
// Record struct - value type with value equality
public record struct Point(int X, int Y);

// Readonly record struct - immutable value type
public readonly record struct ImmutablePoint(int X, int Y);

// Usage
var p1 = new Point(10, 20);
var p2 = new Point(10, 20);
Console.WriteLine(p1 == p2); // True - value equality

// Record structs can be mutable
var p3 = new Point(5, 5);
p3.X = 10; // Allowed for non-readonly record struct

// Readonly record structs are immutable
var p4 = new ImmutablePoint(5, 5);
// p4.X = 10; // Compiler error
```

## Struct Improvements

Structs gain parameterless constructors and field initializers:

```csharp
public struct Configuration
{
    // Field initializers
    public string Environment { get; init; } = "Development";
    public int Timeout { get; init; } = 30;
    public bool EnableLogging { get; init; } = true;

    // Parameterless constructor
    public Configuration()
    {
        // Can add additional logic
        Console.WriteLine("Configuration initialized");
    }
}

// Usage
var config = new Configuration();
Console.WriteLine(config.Environment); // "Development"
Console.WriteLine(config.Timeout);     // 30

var prodConfig = new Configuration
{
    Environment = "Production",
    Timeout = 60
};
```

## Global Using Directives

Eliminate repetitive using statements across your codebase:

```csharp
// GlobalUsings.cs - place at project root
global using System;
global using System.Collections.Generic;
global using System.IO;
global using System.Linq;
global using System.Net.Http;
global using System.Threading;
global using System.Threading.Tasks;
global using Microsoft.Extensions.DependencyInjection;
global using Microsoft.Extensions.Logging;

// Now every file in the project has access to these namespaces
```

Or configure in your project file:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <Using Include="System.Text.Json" />
    <Using Include="Microsoft.EntityFrameworkCore" />
    <Using Include="MyCompany.Common" />
  </ItemGroup>
</Project>
```

## File-Scoped Namespaces

Save one level of indentation in every file:

```csharp
// Before - C# 9 and earlier
namespace MyCompany.MyProject.Services
{
    public class OrderService
    {
        private readonly IOrderRepository _repository;

        public OrderService(IOrderRepository repository)
        {
            _repository = repository;
        }

        public async Task<Order> GetOrderAsync(int id)
        {
            return await _repository.GetByIdAsync(id);
        }
    }
}

// After - C# 10 file-scoped namespace
namespace MyCompany.MyProject.Services;

public class OrderService
{
    private readonly IOrderRepository _repository;

    public OrderService(IOrderRepository repository)
    {
        _repository = repository;
    }

    public async Task<Order> GetOrderAsync(int id)
    {
        return await _repository.GetByIdAsync(id);
    }
}
```

## Extended Property Patterns

Pattern matching gets more concise for nested properties:

```csharp
public record Address(string City, string Country, string PostalCode);
public record Person(string Name, Address Address);

// Before - C# 9
bool IsFromSeattle(Person person) => person is
{
    Address: { City: "Seattle" }
};

// After - C# 10 extended property patterns
bool IsFromSeattleV2(Person person) => person is
{
    Address.City: "Seattle"
};

// More complex example
bool IsAustralianMetro(Person person) => person is
{
    Address.Country: "Australia",
    Address.City: "Sydney" or "Melbourne" or "Brisbane"
};

// In switch expressions
string GetShippingZone(Person person) => person switch
{
    { Address.Country: "Australia", Address.PostalCode: [>= '0' and <= '2', ..] } => "NSW/ACT",
    { Address.Country: "Australia", Address.PostalCode: ['3', ..] } => "Victoria",
    { Address.Country: "Australia" } => "Other AU",
    { Address.Country: "New Zealand" } => "NZ",
    _ => "International"
};
```

## Constant Interpolated Strings

Interpolated strings can now be constants when all components are constants:

```csharp
const string Scheme = "https";
const string Host = "api.example.com";
const string Version = "v1";

// This now works in C# 10
const string BaseUrl = $"{Scheme}://{Host}/{Version}";

// Useful for attributes
[Route($"{Version}/[controller]")]
public class UsersController : ControllerBase
{
    // Controller implementation
}

// And in switch expressions
string GetEndpoint(string resource) => resource switch
{
    "users" => $"{BaseUrl}/users",
    "orders" => $"{BaseUrl}/orders",
    _ => throw new ArgumentException($"Unknown resource: {resource}")
};
```

## Lambda Improvements

Lambdas gain natural types, attributes, and explicit return types:

```csharp
// Natural type - compiler infers delegate type
var square = (int x) => x * x;
var greet = () => "Hello, World!";

// Explicit return type
var parse = object (string s) => int.Parse(s);

// Attributes on lambdas
var validate = [Required][StringLength(100)] (string input) =>
    !string.IsNullOrEmpty(input);

// Method group improvements
var numbers = new[] { 1, 2, 3, 4, 5 };
var doubled = numbers.Select(Double); // Natural type inference

static int Double(int x) => x * 2;

// Useful for minimal APIs
app.MapGet("/users", [Authorize] async (UserService service) =>
    await service.GetAllUsersAsync());
```

## CallerArgumentExpression

Capture the expression passed to a parameter:

```csharp
using System.Runtime.CompilerServices;

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

    public static void InRange(
        int value,
        int min,
        int max,
        [CallerArgumentExpression("value")] string? expression = null)
    {
        if (value < min || value > max)
        {
            throw new ArgumentOutOfRangeException(
                expression,
                $"Value {value} must be between {min} and {max}");
        }
    }
}

// Usage
public void ProcessOrder(Order? order, int quantity)
{
    Guard.NotNull(order);  // Exception: "order"
    Guard.InRange(quantity, 1, 100);  // Exception: "quantity"

    // Process the order...
}
```

## Async Method Builders

Custom async method builders for specialized scenarios:

```csharp
// Attribute to specify custom builder
[AsyncMethodBuilder(typeof(PoolingAsyncValueTaskMethodBuilder<>))]
public async ValueTask<int> ComputeAsync()
{
    await Task.Delay(100);
    return 42;
}

// Useful for high-performance scenarios where you want to pool
// the state machine allocations
```

## Enhanced #line Directives

Better source mapping for code generators:

```csharp
// Supports column numbers and character spans
#line (1, 1) - (1, 10) "generated.cs"
var x = 10;

// Useful for source generators and transpilers
// to provide accurate debugging information
```

## Putting It All Together

Here's a complete example showcasing multiple C# 10 features:

```csharp
global using System.Text.Json;

namespace MyApp.Models;

public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money Zero(string currency) => new(0, currency);

    public Money Add(Money other) => other switch
    {
        { Currency: var c } when c == Currency => this with { Amount = Amount + other.Amount },
        _ => throw new InvalidOperationException($"Cannot add {other.Currency} to {Currency}")
    };
}

public record Order(int Id, Money Total, Address ShippingAddress)
{
    public bool IsInternational => ShippingAddress.Country is not "Australia";

    public string GetShippingTier() => this switch
    {
        { Total.Amount: > 100, ShippingAddress.Country: "Australia" } => "Free",
        { ShippingAddress.Country: "Australia" } => "Standard",
        _ => "International"
    };
}

public record Address(string Street, string City, string Country);
```

C# 10 continues the trend of making the language more expressive while reducing boilerplate. Combined with .NET 6's performance improvements, it's a great time to be a C# developer.

## Resources

- [C# 10 Documentation](https://docs.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-10)
- [C# Language Reference](https://docs.microsoft.com/en-us/dotnet/csharp/language-reference/)
