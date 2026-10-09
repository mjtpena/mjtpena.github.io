---
title: "Hot Reload in .NET 6: Edit Code Without Restarting"
description: "This is different from traditional \"Edit and Continue\" debugging - Hot Reload works with or without the debugger attached."
author: Michael John Pena
draft: false
date: 2021-11-04
tags:
  - .NET
  - Visual Studio
  - Development
  - Productivity
---

## What is Hot Reload?

Hot Reload applies code changes to your running app without:
- Restarting the application
- Losing application state
- Navigating back to where you were testing

This is different from traditional "Edit and Continue" debugging - Hot Reload works with or without the debugger attached.

## Getting Started

Hot Reload works out of the box with `dotnet watch`:

```bash
# Create a new project
dotnet new blazorserver -n HotReloadDemo
cd HotReloadDemo

# Run with hot reload
dotnet watch
```

Now any changes you make to your code will be applied immediately.

## Supported Changes

Hot Reload supports many common code changes:

```csharp
// Changes to method bodies
public string GetGreeting(string name)
{
    // Change this line and see it update immediately
    return $"Hello, {name}! Welcome to .NET 6!";
}

// Adding new methods
public int Calculate(int a, int b)
{
    return a + b;
}

// Modifying lambda expressions
Func<int, int> square = x => x * x;
// Change to:
Func<int, int> square = x => x * x * x; // Now it's cube

// Changes to static fields and properties
public static class AppConfig
{
    public static string Version { get; } = "1.0.0"; // Change this
    public static bool DebugMode { get; } = true;
}
```

## Working with Blazor

Hot Reload shines with Blazor development:

```razor
@page "/counter"

<PageTitle>Counter</PageTitle>

<h1>Counter</h1>

@* Change this text and see it update instantly *@
<p role="status">Current count: @currentCount</p>

@* Add new styling *@
<p style="font-size: 2em; color: @(currentCount > 5 ? "green" : "red")">
    @currentCount
</p>

<button class="btn btn-primary" @onclick="IncrementCount">
    Click me
</button>

@code {
    private int currentCount = 0;

    private void IncrementCount()
    {
        // Change increment value - hot reload preserves state
        currentCount += 5; // Changed from 1 to 5
    }

    // Add a new method while running
    private void ResetCount()
    {
        currentCount = 0;
    }
}
```

The counter value is preserved when you make changes - you don't lose your test state.

## ASP.NET Core MVC and Razor Pages

Hot Reload works with traditional ASP.NET patterns too:

```csharp
// Controllers/HomeController.cs
public class HomeController : Controller
{
    public IActionResult Index()
    {
        // Modify this message
        ViewBag.Message = "Hello from Hot Reload!";
        return View();
    }

    // Add new actions while running
    public IActionResult About()
    {
        return View();
    }
}
```

```html
<!-- Views/Home/Index.cshtml -->
@{
    ViewData["Title"] = "Home Page";
}

<div class="text-center">
    <h1 class="display-4">Welcome</h1>
    <!-- Edit HTML and see changes immediately -->
    <p>@ViewBag.Message</p>
    <p>Learn about <a href="https://docs.microsoft.com/aspnet/core">
        building Web apps with ASP.NET Core
    </a>.</p>
</div>
```

## Console Applications

Hot Reload even works with console apps:

```csharp
// Program.cs
Console.WriteLine("Hot Reload Console Demo");

while (true)
{
    // Modify this method and changes apply immediately
    PrintStatus();
    Thread.Sleep(2000);
}

void PrintStatus()
{
    Console.WriteLine($"Status at {DateTime.Now:HH:mm:ss}: Running!");
    // Add more output while the app runs
    Console.WriteLine("Hot Reload is active!");
}
```

Run with:
```bash
dotnet watch run
```

## Visual Studio Integration

Visual Studio 2022 provides the best Hot Reload experience:

1. **Hot Reload Button**: Click the flame icon or press Alt+F10
2. **Apply on Save**: Enable in Options > Debugging > .NET/C++ Hot Reload
3. **Diagnostics**: See what changes were applied in the Output window

```csharp
// Visual Studio shows inline indicators when changes are applied
public class UserService
{
    public User GetUser(int id)
    {
        // This line was hot reloaded ← VS shows this indicator
        return _repository.FindById(id);
    }
}
```

## What Changes Are NOT Supported

Some changes require a restart:

```csharp
// NOT supported - requires restart:

// 1. Adding new types (classes, structs, interfaces)
public class NewClass { } // Restart required

// 2. Changing type signatures
public class User
{
    public string Name { get; set; }
    public int Age { get; set; } // Adding new property - restart
}

// 3. Modifying generic type definitions
public class Repository<T> { } // Changing constraints - restart

// 4. Changes to static constructors
static MyClass()
{
    // Modifications here - restart
}

// 5. Changes to async state machines (in some cases)
public async Task<int> ComplexAsync()
{
    // Adding new await statements may require restart
}
```

When Hot Reload can't apply changes, you'll see a notification suggesting a restart.

## Configuring Hot Reload

Fine-tune Hot Reload behavior in your project:

```xml
<!-- Properties/launchSettings.json -->
{
  "profiles": {
    "HotReloadDemo": {
      "commandName": "Project",
      "dotnetRunMessages": true,
      "launchBrowser": true,
      "hotReloadEnabled": true,
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development",
        "DOTNET_WATCH_RESTART_ON_RUDE_EDIT": "true"
      }
    }
  }
}
```

Environment variables for dotnet watch:

```bash
# Restart automatically on unsupported changes
export DOTNET_WATCH_RESTART_ON_RUDE_EDIT=true

# Suppress browser refresh
export DOTNET_WATCH_SUPPRESS_BROWSER_REFRESH=true

# Custom polling interval
export DOTNET_WATCH_POLL_INTERVAL=1000
```

## Working with CSS

CSS changes are applied instantly without Hot Reload:

```css
/* wwwroot/css/site.css */
.counter-value {
    font-size: 2em;
    color: blue; /* Change this - instant update */
    transition: color 0.3s ease;
}

.counter-value.high {
    color: green; /* Add new rules while running */
}
```

Browser Link enables CSS Hot Reload in Visual Studio:

```csharp
// In Program.cs
if (app.Environment.IsDevelopment())
{
    app.UseBrowserLink(); // Enable CSS hot reload
}
```

## Best Practices

1. **Design for Hot Reload**: Keep methods small and focused
2. **Use Dependency Injection**: Services can be modified independently
3. **Stateless Components**: Easier to hot reload without side effects
4. **Test Incrementally**: Make small changes and verify frequently

```csharp
// Good: Small, focused methods - easy to hot reload
public class OrderProcessor
{
    public decimal CalculateTotal(Order order)
    {
        return CalculateSubtotal(order) + CalculateTax(order);
    }

    private decimal CalculateSubtotal(Order order)
    {
        // Easy to modify and hot reload
        return order.Items.Sum(i => i.Price * i.Quantity);
    }

    private decimal CalculateTax(Order order)
    {
        // Independent method - changes don't affect others
        return CalculateSubtotal(order) * 0.1m;
    }
}
```

## Debugging with Hot Reload

Hot Reload works alongside the debugger:

```csharp
public void ProcessItems(List<Item> items)
{
    foreach (var item in items)
    {
        // Set breakpoint here
        var result = ProcessItem(item);

        // While stopped at breakpoint, modify ProcessItem
        // Apply Hot Reload, then continue - new code executes

        Console.WriteLine(result);
    }
}

private string ProcessItem(Item item)
{
    // Modify this while debugging
    return $"Processed: {item.Name}";
}
```

Hot Reload transforms the development experience in .NET 6. The ability to see changes instantly without losing state makes iterating on features and fixing bugs significantly faster.

## Resources

- [Hot Reload Documentation](https://docs.microsoft.com/en-us/visualstudio/debugger/hot-reload)
- [dotnet watch Documentation](https://docs.microsoft.com/en-us/dotnet/core/tools/dotnet-watch)
