---
title: "Dataverse Custom APIs: Building Reusable Operations"
author: Michael John Peña
draft: false
date: 2022-05-20
tags:
  - dataverse
  - power-platform
  - api
  - csharp

---

I wrote "Dataverse Custom APIs: Building Reusable Operations" to share practical, production-minded guidance on this topic.

## Custom API vs Custom Actions

Custom APIs offer:
- Better IntelliSense support
- Strongly-typed parameters
- No workflow dependency
- Modern development experience

## Creating a Custom API

Define a custom API for order processing:

```csharp
// Define the API using code
public class CustomApiDefinition
{
    public void CreateProcessOrderApi(IOrganizationService service)
    {
        // Create the Custom API record
        var customApi = new Entity("customapi");
        customApi["uniquename"] = "cr_ProcessOrder";
        customApi["name"] = "Process Order";
        customApi["displayname"] = "Process Order";
        customApi["description"] = "Validates and processes an order";
        customApi["bindingtype"] = new OptionSetValue(0); // Global
        customApi["allowedcustomprocessingsteptype"] = new OptionSetValue(0); // None (plugin only)
        customApi["isfunction"] = false; // It's an action, not a function
        customApi["isprivate"] = false;

        var apiId = service.Create(customApi);

        // Create request parameters
        CreateRequestParameter(service, apiId, "OrderId", "Guid", true);
        CreateRequestParameter(service, apiId, "ValidateOnly", "Boolean", false);
        CreateRequestParameter(service, apiId, "Priority", "Integer", false);

        // Create response properties
        CreateResponseProperty(service, apiId, "Success", "Boolean");
        CreateResponseProperty(service, apiId, "OrderNumber", "String");
        CreateResponseProperty(service, apiId, "TotalAmount", "Decimal");
        CreateResponseProperty(service, apiId, "ErrorMessage", "String");
    }

    private void CreateRequestParameter(
        IOrganizationService service,
        Guid apiId,
        string name,
        string type,
        bool isRequired)
    {
        var parameter = new Entity("customapirequestparameter");
        parameter["customapiid"] = new EntityReference("customapi", apiId);
        parameter["uniquename"] = name;
        parameter["name"] = name;
        parameter["displayname"] = name;
        parameter["type"] = GetTypeCode(type);
        parameter["isoptional"] = !isRequired;

        service.Create(parameter);
    }

    private void CreateResponseProperty(
        IOrganizationService service,
        Guid apiId,
        string name,
        string type)
    {
        var property = new Entity("customapiresponseproperty");
        property["customapiid"] = new EntityReference("customapi", apiId);
        property["uniquename"] = name;
        property["name"] = name;
        property["displayname"] = name;
        property["type"] = GetTypeCode(type);

        service.Create(property);
    }

    private int GetTypeCode(string typeName)
    {
        return typeName switch
        {
            "Boolean" => 0,
            "DateTime" => 1,
            "Decimal" => 2,
            "Entity" => 3,
            "EntityCollection" => 4,
            "EntityReference" => 5,
            "Float" => 6,
            "Integer" => 7,
            "Money" => 8,
            "Picklist" => 9,
            "String" => 10,
            "StringArray" => 11,
            "Guid" => 12,
            _ => 10 // Default to string
        };
    }
}
```

## Implementing the Custom API Plugin

```csharp
public class ProcessOrderPlugin : IPlugin
{
    public void Execute(IServiceProvider serviceProvider)
    {
        var context = (IPluginExecutionContext)serviceProvider
            .GetService(typeof(IPluginExecutionContext));
        var trace = (ITracingService)serviceProvider
            .GetService(typeof(ITracingService));
        var serviceFactory = (IOrganizationServiceFactory)serviceProvider
            .GetService(typeof(IOrganizationServiceFactory));
        var service = serviceFactory.CreateOrganizationService(context.UserId);

        trace.Trace("ProcessOrder API called");

        try
        {
            // Get input parameters
            var orderId = (Guid)context.InputParameters["OrderId"];
            var validateOnly = context.InputParameters.Contains("ValidateOnly")
                ? (bool)context.InputParameters["ValidateOnly"]
                : false;
            var priority = context.InputParameters.Contains("Priority")
                ? (int)context.InputParameters["Priority"]
                : 1;

            trace.Trace($"Processing order {orderId}, ValidateOnly: {validateOnly}");

            // Load order
            var order = service.Retrieve(
                "salesorder",
                orderId,
                new ColumnSet(true));

            // Validate order
            var validationResult = ValidateOrder(order, service, trace);

            if (!validationResult.IsValid)
            {
                context.OutputParameters["Success"] = false;
                context.OutputParameters["ErrorMessage"] = validationResult.ErrorMessage;
                return;
            }

            if (validateOnly)
            {
                context.OutputParameters["Success"] = true;
                context.OutputParameters["OrderNumber"] = order.GetAttributeValue<string>("ordernumber");
                context.OutputParameters["TotalAmount"] = order.GetAttributeValue<Money>("totalamount")?.Value ?? 0m;
                return;
            }

            // Process the order
            var result = ProcessOrderInternal(order, priority, service, trace);

            // Set output parameters
            context.OutputParameters["Success"] = result.Success;
            context.OutputParameters["OrderNumber"] = result.OrderNumber;
            context.OutputParameters["TotalAmount"] = result.TotalAmount;
            context.OutputParameters["ErrorMessage"] = result.ErrorMessage ?? string.Empty;

            trace.Trace("ProcessOrder completed successfully");
        }
        catch (Exception ex)
        {
            trace.Trace($"Error in ProcessOrder: {ex.Message}");
            context.OutputParameters["Success"] = false;
            context.OutputParameters["ErrorMessage"] = ex.Message;
        }
    }

    private ValidationResult ValidateOrder(
        Entity order,
        IOrganizationService service,
        ITracingService trace)
    {
        trace.Trace("Validating order");

        // Check order status
        var status = order.GetAttributeValue<OptionSetValue>("statecode")?.Value;
        if (status != 0) // Active
        {
            return new ValidationResult(false, "Order must be in active state");
        }

        // Check customer
        var customer = order.GetAttributeValue<EntityReference>("customerid");
        if (customer == null)
        {
            return new ValidationResult(false, "Order must have a customer");
        }

        // Check order lines
        var lines = GetOrderLines(order.Id, service);
        if (!lines.Any())
        {
            return new ValidationResult(false, "Order must have at least one line item");
        }

        // Validate inventory for each line
        foreach (var line in lines)
        {
            var productId = line.GetAttributeValue<EntityReference>("productid")?.Id;
            var quantity = line.GetAttributeValue<decimal>("quantity");

            if (!CheckInventory(productId.Value, quantity, service))
            {
                var productName = line.GetAttributeValue<EntityReference>("productid")?.Name;
                return new ValidationResult(false,
                    $"Insufficient inventory for product: {productName}");
            }
        }

        return new ValidationResult(true, null);
    }

    private IEnumerable<Entity> GetOrderLines(Guid orderId, IOrganizationService service)
    {
        var query = new QueryExpression("salesorderdetail")
        {
            ColumnSet = new ColumnSet("productid", "quantity", "priceperunit"),
            Criteria = new FilterExpression
            {
                Conditions =
                {
                    new ConditionExpression("salesorderid", ConditionOperator.Equal, orderId)
                }
            }
        };

        return service.RetrieveMultiple(query).Entities;
    }

    private bool CheckInventory(Guid productId, decimal quantity, IOrganizationService service)
    {
        var product = service.Retrieve(
            "product",
            productId,
            new ColumnSet("quantityonhand"));

        var onHand = product.GetAttributeValue<decimal?>("quantityonhand") ?? 0;
        return onHand >= quantity;
    }

    private ProcessOrderResult ProcessOrderInternal(
        Entity order,
        int priority,
        IOrganizationService service,
        ITracingService trace)
    {
        trace.Trace($"Processing order with priority {priority}");

        // Generate order number if not exists
        var orderNumber = order.GetAttributeValue<string>("ordernumber");
        if (string.IsNullOrEmpty(orderNumber))
        {
            orderNumber = $"ORD-{DateTime.UtcNow:yyyyMMdd}-{Guid.NewGuid().ToString().Substring(0, 8)}";

            var updateOrder = new Entity("salesorder", order.Id);
            updateOrder["ordernumber"] = orderNumber;
            service.Update(updateOrder);
        }

        // Reserve inventory
        var lines = GetOrderLines(order.Id, service);
        foreach (var line in lines)
        {
            ReserveInventory(
                line.GetAttributeValue<EntityReference>("productid").Id,
                line.GetAttributeValue<decimal>("quantity"),
                service);
        }

        // Update order status
        var statusUpdate = new Entity("salesorder", order.Id);
        statusUpdate["cr_processingpriority"] = priority;
        statusUpdate["cr_processeddate"] = DateTime.UtcNow;
        service.Update(statusUpdate);

        trace.Trace($"Order processed: {orderNumber}");

        return new ProcessOrderResult
        {
            Success = true,
            OrderNumber = orderNumber,
            TotalAmount = order.GetAttributeValue<Money>("totalamount")?.Value ?? 0
        };
    }

    private void ReserveInventory(Guid productId, decimal quantity, IOrganizationService service)
    {
        var product = service.Retrieve("product", productId, new ColumnSet("quantityonhand"));
        var onHand = product.GetAttributeValue<decimal?>("quantityonhand") ?? 0;

        var update = new Entity("product", productId);
        update["quantityonhand"] = onHand - quantity;
        service.Update(update);
    }
}

public record ValidationResult(bool IsValid, string? ErrorMessage);

public record ProcessOrderResult
{
    public bool Success { get; init; }
    public string OrderNumber { get; init; }
    public decimal TotalAmount { get; init; }
    public string? ErrorMessage { get; init; }
}
```

## Calling Custom API from Power Automate

```json
{
  "type": "OpenApiConnection",
  "inputs": {
    "host": {
      "connectionName": "shared_commondataserviceforapps",
      "operationId": "PerformUnboundAction",
      "apiId": "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps"
    },
    "parameters": {
      "actionName": "cr_ProcessOrder",
      "item/OrderId": "@triggerBody()?['salesorderid']",
      "item/ValidateOnly": false,
      "item/Priority": 1
    }
  }
}
```

## Calling Custom API from Code

```csharp
public class CustomApiClient
{
    private readonly IOrganizationService _service;

    public CustomApiClient(IOrganizationService service)
    {
        _service = service;
    }

    public ProcessOrderResponse ProcessOrder(
        Guid orderId,
        bool validateOnly = false,
        int priority = 1)
    {
        var request = new OrganizationRequest("cr_ProcessOrder");
        request["OrderId"] = orderId;
        request["ValidateOnly"] = validateOnly;
        request["Priority"] = priority;

        var response = _service.Execute(request);

        return new ProcessOrderResponse
        {
            Success = (bool)response["Success"],
            OrderNumber = (string)response["OrderNumber"],
            TotalAmount = (decimal)response["TotalAmount"],
            ErrorMessage = response.Results.Contains("ErrorMessage")
                ? (string)response["ErrorMessage"]
                : null
        };
    }
}

public record ProcessOrderResponse
{
    public bool Success { get; init; }
    public string OrderNumber { get; init; }
    public decimal TotalAmount { get; init; }
    public string? ErrorMessage { get; init; }
}
```

## Calling from JavaScript/Web API

```typescript
async function processOrder(orderId: string, validateOnly: boolean = false): Promise<ProcessOrderResult> {
  const request = {
    OrderId: orderId,
    ValidateOnly: validateOnly,
    Priority: 1
  };

  const response = await fetch(
    `${Xrm.Utility.getGlobalContext().getClientUrl()}/api/data/v9.2/cr_ProcessOrder`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0'
      },
      body: JSON.stringify(request)
    }
  );

  if (!response.ok) {
    throw new Error(`API call failed: ${response.statusText}`);
  }

  return await response.json();
}

interface ProcessOrderResult {
  Success: boolean;
  OrderNumber: string;
  TotalAmount: number;
  ErrorMessage?: string;
}
```

## Summary

Dataverse Custom APIs provide:

- Clean, typed interface definitions
- Reusable business operations
- SDK and Web API accessibility
- Power Platform integration
- Better than custom actions

Build maintainable APIs that encapsulate your business logic.


