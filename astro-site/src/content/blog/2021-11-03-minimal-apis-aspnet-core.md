---
title: "Minimal APIs in ASP.NET Core 6: Building Lightweight HTTP Services"
author: Michael John Pena
draft: false
date: 2021-11-03
tags:
  - .NET
  - ASP.NET
  - API
  - Web Development
  - Microsoft
---

Minimal APIs in ASP.NET Core 6 are the answer to the question "why do I need controllers, action filters, model binding, and routing tables just to expose a three-endpoint HTTP service?" The design is Lambda-based: `app.MapGet("/items/{id}", (int id) => GetItem(id))` is a complete endpoint—routing, parameter binding, and response serialization all handled with a single line. For microservices and serverless functions where the application does one thing, Minimal APIs reduce the project structure to `Program.cs` and the business logic, with none of the MVC ceremony. The performance advantage is measurable in benchmarks—fewer middleware layers and simpler routing translate to lower latency at high request rates. For applications that genuinely need the full MVC feature set (complex model binding, action filters, areas), the traditional controller model remains the better choice.

## Hello, Minimal API

Here's a complete, working API in a single file:

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => "Hello, World!");

app.Run();
```

That's it. No Startup.cs, no controllers, no attributes. Just code.

## Building a Complete CRUD API

Let's build a more realistic example - a todo API:

```csharp
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddDbContext<TodoDb>(opt =>
    opt.UseInMemoryDatabase("TodoList"));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Configure middleware
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Map endpoints
app.MapGet("/todos", async (TodoDb db) =>
    await db.Todos.ToListAsync());

app.MapGet("/todos/{id}", async (int id, TodoDb db) =>
    await db.Todos.FindAsync(id)
        is Todo todo
            ? Results.Ok(todo)
            : Results.NotFound());

app.MapPost("/todos", async (Todo todo, TodoDb db) =>
{
    db.Todos.Add(todo);
    await db.SaveChangesAsync();
    return Results.Created($"/todos/{todo.Id}", todo);
});

app.MapPut("/todos/{id}", async (int id, Todo inputTodo, TodoDb db) =>
{
    var todo = await db.Todos.FindAsync(id);
    if (todo is null) return Results.NotFound();

    todo.Name = inputTodo.Name;
    todo.IsComplete = inputTodo.IsComplete;
    await db.SaveChangesAsync();

    return Results.NoContent();
});

app.MapDelete("/todos/{id}", async (int id, TodoDb db) =>
{
    if (await db.Todos.FindAsync(id) is Todo todo)
    {
        db.Todos.Remove(todo);
        await db.SaveChangesAsync();
        return Results.Ok(todo);
    }
    return Results.NotFound();
});

app.Run();

// Models
public class Todo
{
    public int Id { get; set; }
    public string? Name { get; set; }
    public bool IsComplete { get; set; }
}

public class TodoDb : DbContext
{
    public TodoDb(DbContextOptions<TodoDb> options) : base(options) { }
    public DbSet<Todo> Todos => Set<Todo>();
}
```

## Parameter Binding

Minimal APIs support various binding sources:

```csharp
// Route parameters
app.MapGet("/users/{id}", (int id) => $"User {id}");

// Query strings
app.MapGet("/search", (string? q, int page = 1, int pageSize = 10) =>
    $"Searching for '{q}' on page {page}");

// Headers
app.MapGet("/headers", (
    [FromHeader(Name = "X-Custom-Header")] string customHeader) =>
    $"Header value: {customHeader}");

// Request body
app.MapPost("/users", (User user) => $"Created {user.Name}");

// Services from DI
app.MapGet("/time", (TimeProvider time) => time.GetUtcNow());

// HttpContext for advanced scenarios
app.MapGet("/context", (HttpContext context) =>
{
    var userAgent = context.Request.Headers.UserAgent;
    return $"User-Agent: {userAgent}";
});

// Combining multiple sources
app.MapPost("/items/{category}", (
    string category,
    [FromQuery] string? filter,
    [FromBody] Item item,
    [FromServices] ILogger<Program> logger) =>
{
    logger.LogInformation("Creating item in {Category}", category);
    return Results.Created($"/items/{category}/{item.Id}", item);
});

public record User(int Id, string Name, string Email);
public record Item(int Id, string Name);
```

## Results and Responses

The `Results` class provides typed responses:

```csharp
app.MapGet("/result-examples/{id}", (int id) => id switch
{
    < 0 => Results.BadRequest("ID cannot be negative"),
    0 => Results.NotFound(),
    > 1000 => Results.StatusCode(503), // Service Unavailable
    _ => Results.Ok(new { Id = id, Message = "Found" })
});

// Typed results for OpenAPI documentation
app.MapGet("/typed/{id}", Results<Ok<User>, NotFound> (int id, UserService service) =>
{
    var user = service.GetUser(id);
    return user is not null
        ? TypedResults.Ok(user)
        : TypedResults.NotFound();
});

// File results
app.MapGet("/download", () => Results.File(
    fileContents: System.Text.Encoding.UTF8.GetBytes("Hello"),
    contentType: "text/plain",
    fileDownloadName: "hello.txt"));

// Redirect
app.MapGet("/old-endpoint", () => Results.Redirect("/new-endpoint"));

// JSON with custom options
app.MapGet("/custom-json", () => Results.Json(
    new { Message = "Hello" },
    new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
```

## Route Groups

Organize related endpoints with route groups:

```csharp
var app = builder.Build();

// Group related endpoints
var todoGroup = app.MapGroup("/todos")
    .WithTags("Todo Operations");

todoGroup.MapGet("/", GetAllTodos);
todoGroup.MapGet("/{id}", GetTodo);
todoGroup.MapPost("/", CreateTodo);
todoGroup.MapPut("/{id}", UpdateTodo);
todoGroup.MapDelete("/{id}", DeleteTodo);

// Nested groups with shared configuration
var apiGroup = app.MapGroup("/api/v1")
    .RequireAuthorization();

var usersGroup = apiGroup.MapGroup("/users")
    .WithTags("Users");

usersGroup.MapGet("/", () => "List users");
usersGroup.MapGet("/{id}", (int id) => $"Get user {id}");

var ordersGroup = apiGroup.MapGroup("/orders")
    .WithTags("Orders");

ordersGroup.MapGet("/", () => "List orders");
ordersGroup.MapPost("/", (Order order) => Results.Created($"/orders/{order.Id}", order));

public record Order(int Id, string Product);
```

## Filters and Middleware

Apply cross-cutting concerns with filters:

```csharp
// Endpoint filter
app.MapGet("/filtered", () => "Hello")
    .AddEndpointFilter(async (context, next) =>
    {
        var logger = context.HttpContext.RequestServices
            .GetRequiredService<ILogger<Program>>();

        logger.LogInformation("Before endpoint");
        var result = await next(context);
        logger.LogInformation("After endpoint");

        return result;
    });

// Validation filter
app.MapPost("/users", (User user) => Results.Ok(user))
    .AddEndpointFilter(async (context, next) =>
    {
        var user = context.GetArgument<User>(0);

        if (string.IsNullOrEmpty(user.Name))
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                { "Name", new[] { "Name is required" } }
            });

        return await next(context);
    });

// Reusable filter class
public class LoggingFilter : IEndpointFilter
{
    private readonly ILogger<LoggingFilter> _logger;

    public LoggingFilter(ILogger<LoggingFilter> logger)
    {
        _logger = logger;
    }

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        _logger.LogInformation("Handling request: {Path}",
            context.HttpContext.Request.Path);

        var result = await next(context);

        _logger.LogInformation("Request completed");
        return result;
    }
}

// Apply reusable filter
app.MapGet("/with-logging", () => "Logged!")
    .AddEndpointFilter<LoggingFilter>();

public record User(int Id, string Name, string Email);
```

## Authentication and Authorization

Secure your endpoints:

```csharp
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

// Require authentication
app.MapGet("/secure", () => "Secret data")
    .RequireAuthorization();

// Specific policy
app.MapGet("/admin", () => "Admin only")
    .RequireAuthorization("AdminPolicy");

// Allow anonymous
app.MapGet("/public", () => "Public data")
    .AllowAnonymous();

// Access user claims
app.MapGet("/me", (ClaimsPrincipal user) =>
    $"Hello, {user.Identity?.Name}");

// Role-based authorization
app.MapDelete("/users/{id}", (int id) => Results.Ok())
    .RequireAuthorization(policy => policy.RequireRole("Admin"));
```

## OpenAPI/Swagger Integration

Minimal APIs integrate with OpenAPI:

```csharp
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "My API", Version = "v1" });
});

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

// Add metadata for documentation
app.MapGet("/products", () => new[] { new Product(1, "Widget") })
    .WithName("GetProducts")
    .WithDescription("Retrieves all products")
    .Produces<Product[]>(StatusCodes.Status200OK)
    .WithOpenApi();

app.MapPost("/products", (Product product) => Results.Created($"/products/{product.Id}", product))
    .WithName("CreateProduct")
    .Accepts<Product>("application/json")
    .Produces<Product>(StatusCodes.Status201Created)
    .ProducesValidationProblem()
    .WithOpenApi();

public record Product(int Id, string Name);
```

## When to Use Minimal APIs

Minimal APIs are great for:
- Microservices with few endpoints
- Quick prototypes and MVPs
- Lightweight APIs and webhooks
- Learning and teaching

Stick with controllers when you need:
- Large APIs with many endpoints
- Extensive use of filters and attributes
- Complex routing scenarios
- Existing codebases that use controllers

## Migrating from Controllers

You can mix controllers and minimal APIs:

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers(); // Keep controller support
builder.Services.AddEndpointsApiExplorer();

var app = builder.Build();

app.MapControllers(); // Map controller routes

// Add minimal API endpoints alongside
app.MapGet("/health", () => Results.Ok(new { Status = "Healthy" }));
app.MapGet("/version", () => Results.Ok(new { Version = "1.0.0" }));

app.Run();
```

Minimal APIs bring the simplicity of modern web frameworks to .NET while maintaining the performance and type safety C# developers expect.

## Resources

- [Minimal APIs Overview](https://docs.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis)
- [Tutorial: Create a minimal web API](https://docs.microsoft.com/en-us/aspnet/core/tutorials/min-web-api)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
