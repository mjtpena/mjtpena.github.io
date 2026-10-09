---
title: "Azure SQL Bindings for Azure Functions"
description: "Azure SQL bindings simplify serverless database applications significantly."
author: "Michael John Peña"
draft: false
date: 2022-09-30
tags: ["Azure", "Azure Functions", "SQL Database", "Serverless"]
---

## Understanding SQL Bindings

### Input Binding - Reading Data

```csharp
// Read single record by ID
public class GetCustomerFunction
{
    [FunctionName("GetCustomer")]
    public static IActionResult GetCustomer(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "customers/{id}")] HttpRequest req,
        [Sql(
            commandText: "SELECT * FROM dbo.Customers WHERE CustomerID = @Id",
            commandType: System.Data.CommandType.Text,
            parameters: "@Id={id}",
            connectionStringSetting: "SqlConnectionString")]
        IEnumerable<Customer> customers,
        ILogger log)
    {
        var customer = customers.FirstOrDefault();

        if (customer == null)
            return new NotFoundResult();

        return new OkObjectResult(customer);
    }
}

// Read multiple records
public class GetCustomersFunction
{
    [FunctionName("GetCustomers")]
    public static IActionResult GetCustomers(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "customers")] HttpRequest req,
        [Sql(
            commandText: "SELECT TOP 100 * FROM dbo.Customers ORDER BY CustomerName",
            commandType: System.Data.CommandType.Text,
            connectionStringSetting: "SqlConnectionString")]
        IEnumerable<Customer> customers,
        ILogger log)
    {
        return new OkObjectResult(customers);
    }
}

public class Customer
{
    public int CustomerID { get; set; }
    public string CustomerName { get; set; }
    public string Email { get; set; }
    public string Phone { get; set; }
    public DateTime CreatedDate { get; set; }
}
```

### Output Binding - Writing Data

```csharp
// Insert single record
public class CreateCustomerFunction
{
    [FunctionName("CreateCustomer")]
    public static async Task<IActionResult> CreateCustomer(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "customers")] HttpRequest req,
        [Sql(
            commandText: "dbo.Customers",
            connectionStringSetting: "SqlConnectionString")]
        IAsyncCollector<Customer> customers,
        ILogger log)
    {
        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        var customer = JsonConvert.DeserializeObject<Customer>(requestBody);

        customer.CreatedDate = DateTime.UtcNow;

        await customers.AddAsync(customer);
        await customers.FlushAsync();

        return new CreatedResult($"/api/customers/{customer.CustomerID}", customer);
    }
}

// Insert multiple records
public class BulkInsertCustomersFunction
{
    [FunctionName("BulkInsertCustomers")]
    public static async Task<IActionResult> BulkInsertCustomers(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "customers/bulk")] HttpRequest req,
        [Sql(
            commandText: "dbo.Customers",
            connectionStringSetting: "SqlConnectionString")]
        IAsyncCollector<Customer> customers,
        ILogger log)
    {
        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        var customerList = JsonConvert.DeserializeObject<List<Customer>>(requestBody);

        foreach (var customer in customerList)
        {
            customer.CreatedDate = DateTime.UtcNow;
            await customers.AddAsync(customer);
        }

        await customers.FlushAsync();

        return new OkObjectResult(new { inserted = customerList.Count });
    }
}
```

### Stored Procedure Binding

```csharp
// Call stored procedure with input binding
public class GetOrdersByCustomerFunction
{
    [FunctionName("GetOrdersByCustomer")]
    public static IActionResult GetOrdersByCustomer(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "customers/{customerId}/orders")] HttpRequest req,
        [Sql(
            commandText: "dbo.sp_GetCustomerOrders",
            commandType: System.Data.CommandType.StoredProcedure,
            parameters: "@CustomerID={customerId}",
            connectionStringSetting: "SqlConnectionString")]
        IEnumerable<Order> orders,
        ILogger log)
    {
        return new OkObjectResult(orders);
    }
}

// Stored procedure in SQL
/*
CREATE PROCEDURE dbo.sp_GetCustomerOrders
    @CustomerID INT
AS
BEGIN
    SELECT
        o.OrderID,
        o.OrderDate,
        o.TotalAmount,
        o.Status
    FROM dbo.Orders o
    WHERE o.CustomerID = @CustomerID
    ORDER BY o.OrderDate DESC;
END
*/
```

### Query Parameters from Request

```csharp
// Use query string parameters
public class SearchCustomersFunction
{
    [FunctionName("SearchCustomers")]
    public static IActionResult SearchCustomers(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "customers/search")] HttpRequest req,
        [Sql(
            commandText: "SELECT * FROM dbo.Customers WHERE Country = @Country AND IsActive = @IsActive",
            commandType: System.Data.CommandType.Text,
            parameters: "@Country={Query.country},@IsActive={Query.active}",
            connectionStringSetting: "SqlConnectionString")]
        IEnumerable<Customer> customers,
        ILogger log)
    {
        return new OkObjectResult(customers);
    }
}

// Call: GET /api/customers/search?country=USA&active=true
```

### Timer Trigger with SQL

```csharp
// Scheduled database cleanup
public class CleanupOldRecordsFunction
{
    [FunctionName("CleanupOldRecords")]
    public static async Task CleanupOldRecords(
        [TimerTrigger("0 0 2 * * *")] TimerInfo timer,  // Daily at 2 AM
        [Sql(
            commandText: "DELETE FROM dbo.AuditLog WHERE EventDate < DATEADD(day, -90, GETUTCDATE())",
            commandType: System.Data.CommandType.Text,
            connectionStringSetting: "SqlConnectionString")]
        IAsyncCollector<object> output,
        ILogger log)
    {
        log.LogInformation($"Cleanup function executed at: {DateTime.Now}");
        // The SQL command executes automatically
    }
}

// Scheduled data aggregation
public class DailyAggregationFunction
{
    [FunctionName("DailyAggregation")]
    public static IActionResult DailyAggregation(
        [TimerTrigger("0 0 1 * * *")] TimerInfo timer,
        [Sql(
            commandText: "dbo.sp_AggregateDaily",
            commandType: System.Data.CommandType.StoredProcedure,
            connectionStringSetting: "SqlConnectionString")]
        IEnumerable<AggregationResult> results,
        ILogger log)
    {
        foreach (var result in results)
        {
            log.LogInformation($"Aggregated {result.RecordCount} records for {result.AggregateDate}");
        }

        return new OkResult();
    }
}
```

### Queue Trigger with SQL

```csharp
// Process queue messages and save to SQL
public class ProcessOrderQueueFunction
{
    [FunctionName("ProcessOrderQueue")]
    public static async Task ProcessOrderQueue(
        [QueueTrigger("orders-queue", Connection = "StorageConnection")] OrderMessage message,
        [Sql(
            commandText: "dbo.Orders",
            connectionStringSetting: "SqlConnectionString")]
        IAsyncCollector<Order> orders,
        ILogger log)
    {
        var order = new Order
        {
            OrderID = message.OrderId,
            CustomerID = message.CustomerId,
            TotalAmount = message.Amount,
            OrderDate = DateTime.UtcNow,
            Status = "Processing"
        };

        await orders.AddAsync(order);
        await orders.FlushAsync();

        log.LogInformation($"Order {message.OrderId} saved to database");
    }
}

public class OrderMessage
{
    public int OrderId { get; set; }
    public int CustomerId { get; set; }
    public decimal Amount { get; set; }
}
```

### Configuration

```json
// local.settings.json
{
    "IsEncrypted": false,
    "Values": {
        "AzureWebJobsStorage": "UseDevelopmentStorage=true",
        "FUNCTIONS_WORKER_RUNTIME": "dotnet",
        "SqlConnectionString": "Server=myserver.database.windows.net;Database=MyDB;User Id=admin;Password=secret;Encrypt=True"
    }
}
```

```xml
<!-- Add NuGet package -->
<!-- Microsoft.Azure.WebJobs.Extensions.Sql -->
<PackageReference Include="Microsoft.Azure.WebJobs.Extensions.Sql" Version="1.0.0" />
```

### Error Handling

```csharp
public class RobustSqlFunction
{
    [FunctionName("RobustSqlOperation")]
    public static async Task<IActionResult> RobustSqlOperation(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req,
        [Sql(
            commandText: "dbo.Customers",
            connectionStringSetting: "SqlConnectionString")]
        IAsyncCollector<Customer> customers,
        ILogger log)
    {
        try
        {
            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var customer = JsonConvert.DeserializeObject<Customer>(requestBody);

            if (string.IsNullOrEmpty(customer?.CustomerName))
            {
                return new BadRequestObjectResult("CustomerName is required");
            }

            await customers.AddAsync(customer);
            await customers.FlushAsync();

            return new OkObjectResult(customer);
        }
        catch (SqlException ex) when (ex.Number == 2627)
        {
            log.LogWarning("Duplicate key violation");
            return new ConflictObjectResult("Customer already exists");
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Error creating customer");
            return new StatusCodeResult(500);
        }
    }
}
```

## Best Practices

1. **Use connection string settings** - Never hardcode connection strings
2. **Handle errors gracefully** - Implement proper exception handling
3. **Use stored procedures** - For complex queries
4. **Batch operations** - Use FlushAsync strategically
5. **Monitor performance** - Track function execution times

Azure SQL bindings simplify serverless database applications significantly.
