---
title: "ChatGPT in Developer Workflows: Practical Applications"
author: Michael John Peña
draft: false
date: 2022-12-01
tags:
  - AI
  - ChatGPT
  - Developer Tools
  - Productivity
  - OpenAI
---

Twenty-four hours after ChatGPT launched, my developer group chats were a stream of screenshots—developers sharing prompts and responses the way we used to share Stack Overflow links. The specific use cases that crystallised quickly: explaining unfamiliar code (paste a function, ask what it does); generating boilerplate (ask for a C# repository pattern implementation for a given entity); and debugging assistance (describe the error, ask why it's happening). What was striking wasn't the capability—I'd been using GPT-3.5 through Azure OpenAI for months—it was how the conversational interface removed the prompt design overhead and made the capability immediately intuitive for developers who'd never used an LLM API directly. This is what I'd found useful in the first 24 hours, before the hype completely outpaced the practical assessment.

## Code Review Assistant

ChatGPT excels at reviewing code and suggesting improvements:

**Prompt**: "Review this code for potential issues, performance problems, and suggest improvements:"

```csharp
public async Task<List<Order>> GetOrdersForCustomer(string customerId)
{
    var orders = new List<Order>();
    using (var connection = new SqlConnection(_connectionString))
    {
        await connection.OpenAsync();
        var command = new SqlCommand(
            $"SELECT * FROM Orders WHERE CustomerId = '{customerId}'",
            connection);
        var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            orders.Add(new Order
            {
                Id = reader.GetInt32(0),
                CustomerId = reader.GetString(1),
                Total = reader.GetDecimal(2)
            });
        }
    }
    return orders;
}
```

**ChatGPT's Review**:
1. **SQL Injection vulnerability**: String concatenation allows injection attacks
2. **No using statement for command**: SqlCommand should be disposed
3. **SELECT ***: Should specify columns explicitly
4. **Magic numbers**: Column indices are fragile
5. **No error handling**: Connection failures aren't handled

**Suggested fix**:
```csharp
public async Task<List<Order>> GetOrdersForCustomerAsync(string customerId)
{
    var orders = new List<Order>();

    using var connection = new SqlConnection(_connectionString);
    await connection.OpenAsync();

    const string sql = @"
        SELECT Id, CustomerId, Total
        FROM Orders
        WHERE CustomerId = @CustomerId";

    using var command = new SqlCommand(sql, connection);
    command.Parameters.AddWithValue("@CustomerId", customerId);

    using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        orders.Add(new Order
        {
            Id = reader.GetInt32(reader.GetOrdinal("Id")),
            CustomerId = reader.GetString(reader.GetOrdinal("CustomerId")),
            Total = reader.GetDecimal(reader.GetOrdinal("Total"))
        });
    }

    return orders;
}
```

## Documentation Generation

Generate documentation from code:

**Prompt**: "Generate XML documentation and a README section for this API endpoint:"

```csharp
[HttpPost("orders")]
public async Task<ActionResult<OrderResponse>> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken cancellationToken)
{
    var order = await _orderService.CreateAsync(request, cancellationToken);
    return CreatedAtAction(nameof(GetOrder), new { id = order.Id }, order);
}
```

**ChatGPT generates**:
```csharp
/// <summary>
/// Creates a new order in the system.
/// </summary>
/// <param name="request">The order creation request containing customer and item details.</param>
/// <param name="cancellationToken">Cancellation token for the operation.</param>
/// <returns>
/// Returns 201 Created with the new order details on success.
/// Returns 400 Bad Request if the request is invalid.
/// Returns 404 Not Found if referenced items don't exist.
/// </returns>
/// <response code="201">Order created successfully</response>
/// <response code="400">Invalid request data</response>
/// <response code="404">Referenced resource not found</response>
[HttpPost("orders")]
[ProducesResponseType(typeof(OrderResponse), StatusCodes.Status201Created)]
[ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
public async Task<ActionResult<OrderResponse>> CreateOrder(...)
```

## Test Generation

**Prompt**: "Generate xUnit tests for this service method:"

```csharp
public class PricingService
{
    public decimal CalculateDiscount(decimal subtotal, string customerTier)
    {
        return customerTier switch
        {
            "Gold" => subtotal * 0.15m,
            "Silver" => subtotal * 0.10m,
            "Bronze" => subtotal * 0.05m,
            _ => 0
        };
    }
}
```

**ChatGPT generates**:
```csharp
public class PricingServiceTests
{
    private readonly PricingService _sut = new();

    [Theory]
    [InlineData(100, "Gold", 15)]
    [InlineData(100, "Silver", 10)]
    [InlineData(100, "Bronze", 5)]
    [InlineData(200, "Gold", 30)]
    public void CalculateDiscount_ReturnsCorrectDiscount_ForKnownTiers(
        decimal subtotal, string tier, decimal expectedDiscount)
    {
        // Act
        var result = _sut.CalculateDiscount(subtotal, tier);

        // Assert
        Assert.Equal(expectedDiscount, result);
    }

    [Theory]
    [InlineData("Unknown")]
    [InlineData("")]
    [InlineData(null)]
    public void CalculateDiscount_ReturnsZero_ForUnknownTiers(string tier)
    {
        // Arrange
        var subtotal = 100m;

        // Act
        var result = _sut.CalculateDiscount(subtotal, tier);

        // Assert
        Assert.Equal(0, result);
    }

    [Fact]
    public void CalculateDiscount_HandlesZeroSubtotal()
    {
        // Act
        var result = _sut.CalculateDiscount(0, "Gold");

        // Assert
        Assert.Equal(0, result);
    }

    [Fact]
    public void CalculateDiscount_HandlesLargeSubtotals()
    {
        // Arrange
        var largeSubtotal = 1_000_000m;

        // Act
        var result = _sut.CalculateDiscount(largeSubtotal, "Gold");

        // Assert
        Assert.Equal(150_000m, result);
    }
}
```

## Learning New Technologies

**Prompt**: "I'm a C# developer who's never used Rust. Explain ownership and borrowing with examples that relate to C# concepts I already know."

ChatGPT provides analogies:
- "Think of Rust ownership like C#'s `using` statement, but enforced at compile time for everything"
- "Borrowing is similar to passing by reference in C#, but with compiler-enforced rules about mutability"

## SQL Query Optimization

**Prompt**: "This query is slow. Suggest optimizations and explain why:"

```sql
SELECT *
FROM Orders o
JOIN Customers c ON o.CustomerId = c.Id
JOIN Products p ON o.ProductId = p.Id
WHERE o.OrderDate > '2022-01-01'
ORDER BY o.OrderDate DESC
```

ChatGPT identifies issues and provides:
1. Replace SELECT * with specific columns
2. Suggest indexes on OrderDate, CustomerId, ProductId
3. Explain query execution plan implications
4. Provide optimized version with covering index suggestions

## Regex Generation

**Prompt**: "Write a regex that validates Australian phone numbers in formats like 0412 345 678, 04-1234-5678, or +61412345678"

```python
import re

pattern = r'^(?:\+61|0)(?:4\d{2}|\d)[\s-]?\d{3}[\s-]?\d{3}$'

# Test cases
test_numbers = [
    "0412 345 678",   # Valid
    "04-1234-5678",   # Valid
    "+61412345678",   # Valid
    "0412345678",     # Valid
    "1234567890",     # Invalid
]

for number in test_numbers:
    match = re.match(pattern, number)
    print(f"{number}: {'Valid' if match else 'Invalid'}")
```

## Error Message Interpretation

**Prompt**: "What does this Azure error mean and how do I fix it?

`Microsoft.Azure.WebJobs.Host: Error indexing method 'Functions.ProcessOrder'. Microsoft.Azure.WebJobs.Extensions.Storage: Storage account connection string 'AzureWebJobsStorage' does not exist.`"

ChatGPT explains:
1. The Azure Function can't find the storage connection string
2. Check local.settings.json for local development
3. Check Azure Portal Application Settings for deployed functions
4. Provides exact configuration to add

## Architecture Discussions

**Prompt**: "I'm designing a system for processing 10,000 orders per minute. I'm considering Azure Service Bus vs Event Hubs. What are the tradeoffs?"

ChatGPT provides a thoughtful comparison considering:
- Throughput requirements
- Message ordering needs
- Consumer patterns
- Cost implications
- Complexity tradeoffs

## Best Practices I've Learned

1. **Be specific**: "Write Python code" vs "Write Python 3.10 code using async/await"
2. **Provide context**: Include relevant background information
3. **Iterate**: Ask follow-up questions to refine
4. **Verify**: Always test generated code
5. **Learn**: Ask "why" to understand the reasoning

## Conclusion

ChatGPT is already proving valuable in daily development work. It's not replacing developers - it's augmenting our capabilities. The key is learning to work with it effectively: providing good context, verifying outputs, and using it for learning, not just copying.

## Resources

- [ChatGPT](https://chat.openai.com/)
- [Prompt Engineering Guide](https://platform.openai.com/docs/guides/completion/prompt-design)
