---
title: "Dataverse Business Events: Event-Driven Architecture"
author: Michael John Peña
draft: false
date: 2022-05-18
tags:
  - dataverse
  - power-platform
  - Events
  - Integration
---

## Business Events Overview

Business events provide:
- Decoupled integration
- Real-time notifications
- Webhook delivery
- Azure Service Bus integration

## Creating Custom Business Events

Define a custom business event:

```csharp
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;

public class BusinessEventService
{
    private readonly IOrganizationService _service;

    public BusinessEventService(IOrganizationService service)
    {
        _service = service;
    }

    public Guid CreateCustomBusinessEvent(string name, string description)
    {
        var businessEvent = new Entity("catalogassignment");
        businessEvent["name"] = name;
        businessEvent["description"] = description;
        businessEvent["eventtype"] = 1; // Custom
        businessEvent["isactive"] = true;

        return _service.Create(businessEvent);
    }

    public void RegisterEventSchema(Guid eventId, EventSchema schema)
    {
        var schemaEntity = new Entity("catalogeventschema");
        schemaEntity["catalogassignmentid"] = new EntityReference("catalogassignment", eventId);
        schemaEntity["schemaname"] = schema.Name;
        schemaEntity["schemadefinition"] = JsonSerializer.Serialize(schema);

        _service.Create(schemaEntity);
    }
}

public class EventSchema
{
    public string Name { get; set; }
    public string Version { get; set; }
    public List<SchemaProperty> Properties { get; set; }
}

public class SchemaProperty
{
    public string Name { get; set; }
    public string Type { get; set; }
    public bool Required { get; set; }
    public string Description { get; set; }
}
```

## Plugin to Raise Business Events

Trigger events from plugins:

```csharp
public class OrderCompletedEventPlugin : IPlugin
{
    public void Execute(IServiceProvider serviceProvider)
    {
        var context = serviceProvider.Get<IPluginExecutionContext>();
        var serviceFactory = serviceProvider.Get<IOrganizationServiceFactory>();
        var service = serviceFactory.CreateOrganizationService(context.UserId);
        var tracingService = serviceProvider.Get<ITracingService>();

        if (context.MessageName != "Update")
            return;

        var target = (Entity)context.InputParameters["Target"];
        var preImage = context.PreEntityImages["PreImage"];

        // Check if order status changed to completed
        var newStatus = target.GetAttributeValue<OptionSetValue>("statuscode")?.Value;
        var oldStatus = preImage.GetAttributeValue<OptionSetValue>("statuscode")?.Value;

        if (newStatus == 100000002 && oldStatus != 100000002) // Completed status
        {
            tracingService.Trace("Order completed, raising business event");

            // Load full order details
            var order = service.Retrieve(
                context.PrimaryEntityName,
                context.PrimaryEntityId,
                new ColumnSet(true));

            // Create event payload
            var eventPayload = new OrderCompletedEvent
            {
                OrderId = order.Id,
                OrderNumber = order.GetAttributeValue<string>("ordernumber"),
                CustomerId = order.GetAttributeValue<EntityReference>("customerid")?.Id ?? Guid.Empty,
                CustomerName = order.GetAttributeValue<EntityReference>("customerid")?.Name,
                TotalAmount = order.GetAttributeValue<Money>("totalamount")?.Value ?? 0,
                CompletedDate = DateTime.UtcNow,
                OrderLines = GetOrderLines(service, order.Id)
            };

            // Raise the business event
            RaiseBusinessEvent(service, "cr_OrderCompleted", eventPayload);
        }
    }

    private List<OrderLineEvent> GetOrderLines(IOrganizationService service, Guid orderId)
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

        var results = service.RetrieveMultiple(query);

        return results.Entities.Select(e => new OrderLineEvent
        {
            ProductId = e.GetAttributeValue<EntityReference>("productid")?.Id ?? Guid.Empty,
            ProductName = e.GetAttributeValue<EntityReference>("productid")?.Name,
            Quantity = e.GetAttributeValue<decimal>("quantity"),
            UnitPrice = e.GetAttributeValue<Money>("priceperunit")?.Value ?? 0
        }).ToList();
    }

    private void RaiseBusinessEvent(
        IOrganizationService service,
        string eventName,
        object payload)
    {
        var request = new OrganizationRequest("RaiseBusinessEvent");
        request["EventName"] = eventName;
        request["Payload"] = JsonSerializer.Serialize(payload);

        service.Execute(request);
    }
}

public class OrderCompletedEvent
{
    public Guid OrderId { get; set; }
    public string OrderNumber { get; set; }
    public Guid CustomerId { get; set; }
    public string CustomerName { get; set; }
    public decimal TotalAmount { get; set; }
    public DateTime CompletedDate { get; set; }
    public List<OrderLineEvent> OrderLines { get; set; }
}

public class OrderLineEvent
{
    public Guid ProductId { get; set; }
    public string ProductName { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}
```

## Webhook Subscription

Configure webhook endpoints:

```csharp
public class WebhookSubscriptionService
{
    private readonly IOrganizationService _service;

    public WebhookSubscriptionService(IOrganizationService service)
    {
        _service = service;
    }

    public Guid CreateWebhookSubscription(
        string eventName,
        string webhookUrl,
        string authHeader)
    {
        // Create service endpoint
        var endpoint = new Entity("serviceendpoint");
        endpoint["name"] = $"Webhook - {eventName}";
        endpoint["url"] = webhookUrl;
        endpoint["contract"] = 8; // Webhook
        endpoint["authtype"] = 5; // HttpHeader
        endpoint["authvalue"] = authHeader;
        endpoint["messageformat"] = 1; // JSON

        var endpointId = _service.Create(endpoint);

        // Register step for the event
        var step = new Entity("sdkmessageprocessingstep");
        step["name"] = $"Webhook Step - {eventName}";
        step["eventhandler"] = new EntityReference("serviceendpoint", endpointId);
        step["stage"] = 40; // Post-operation
        step["mode"] = 1; // Asynchronous
        step["rank"] = 1;

        // Get SDK message ID for the business event
        var messageId = GetSdkMessageId(eventName);
        step["sdkmessageid"] = new EntityReference("sdkmessage", messageId);

        _service.Create(step);

        return endpointId;
    }

    private Guid GetSdkMessageId(string messageName)
    {
        var query = new QueryExpression("sdkmessage")
        {
            ColumnSet = new ColumnSet("sdkmessageid"),
            Criteria = new FilterExpression
            {
                Conditions =
                {
                    new ConditionExpression("name", ConditionOperator.Equal, messageName)
                }
            }
        };

        var result = _service.RetrieveMultiple(query);
        return result.Entities.FirstOrDefault()?.Id ?? Guid.Empty;
    }
}
```

## Azure Service Bus Integration

Subscribe events to Service Bus:

```csharp
public class ServiceBusSubscription
{
    private readonly IOrganizationService _service;

    public ServiceBusSubscription(IOrganizationService service)
    {
        _service = service;
    }

    public Guid CreateServiceBusSubscription(
        string eventName,
        string serviceBusNamespace,
        string queueName,
        string sasKeyName,
        string sasKey)
    {
        // Build connection string
        var connectionString = $"Endpoint=sb://{serviceBusNamespace}.servicebus.windows.net/;" +
            $"SharedAccessKeyName={sasKeyName};" +
            $"SharedAccessKey={sasKey}";

        // Create service endpoint for Service Bus
        var endpoint = new Entity("serviceendpoint");
        endpoint["name"] = $"ServiceBus - {eventName}";
        endpoint["connectionstring"] = connectionString;
        endpoint["path"] = queueName;
        endpoint["contract"] = 7; // Queue
        endpoint["messageformat"] = 1; // JSON
        endpoint["namespaceaddress"] = $"sb://{serviceBusNamespace}.servicebus.windows.net/";

        var endpointId = _service.Create(endpoint);

        // Register the step
        RegisterEventStep(eventName, endpointId);

        return endpointId;
    }

    private void RegisterEventStep(string eventName, Guid endpointId)
    {
        var step = new Entity("sdkmessageprocessingstep");
        step["name"] = $"ServiceBus Step - {eventName}";
        step["eventhandler"] = new EntityReference("serviceendpoint", endpointId);
        step["stage"] = 40;
        step["mode"] = 1;
        step["rank"] = 1;

        var messageId = GetSdkMessageId(eventName);
        step["sdkmessageid"] = new EntityReference("sdkmessage", messageId);

        _service.Create(step);
    }

    private Guid GetSdkMessageId(string messageName)
    {
        // Implementation
        return Guid.Empty;
    }
}
```

## Consuming Events in Azure Functions

Process business events:

```csharp
public class BusinessEventProcessor
{
    private readonly ILogger<BusinessEventProcessor> _logger;

    public BusinessEventProcessor(ILogger<BusinessEventProcessor> logger)
    {
        _logger = logger;
    }

    [Function("ProcessOrderCompleted")]
    public async Task ProcessOrderCompletedAsync(
        [ServiceBusTrigger("order-completed", Connection = "ServiceBusConnection")]
        ServiceBusReceivedMessage message)
    {
        var eventData = JsonSerializer.Deserialize<DataverseBusinessEvent>(
            message.Body.ToString());

        _logger.LogInformation(
            "Processing OrderCompleted event for order {OrderId}",
            eventData.PrimaryEntityId);

        var orderEvent = JsonSerializer.Deserialize<OrderCompletedEvent>(
            eventData.Payload);

        // Process the event
        await UpdateInventoryAsync(orderEvent);
        await SendConfirmationEmailAsync(orderEvent);
        await UpdateAnalyticsAsync(orderEvent);

        _logger.LogInformation(
            "Completed processing order {OrderNumber}",
            orderEvent.OrderNumber);
    }

    private async Task UpdateInventoryAsync(OrderCompletedEvent order)
    {
        foreach (var line in order.OrderLines)
        {
            _logger.LogInformation(
                "Updating inventory for product {ProductId}, quantity: {Quantity}",
                line.ProductId, line.Quantity);
            // Update inventory system
        }
    }

    private async Task SendConfirmationEmailAsync(OrderCompletedEvent order)
    {
        _logger.LogInformation(
            "Sending confirmation email for order {OrderNumber}",
            order.OrderNumber);
        // Send email via SendGrid, etc.
    }

    private async Task UpdateAnalyticsAsync(OrderCompletedEvent order)
    {
        _logger.LogInformation(
            "Recording analytics for order {OrderNumber}",
            order.OrderNumber);
        // Update analytics/reporting system
    }
}

public class DataverseBusinessEvent
{
    public string EventName { get; set; }
    public Guid PrimaryEntityId { get; set; }
    public string PrimaryEntityName { get; set; }
    public string Payload { get; set; }
    public DateTime Timestamp { get; set; }
}
```

## Summary

Dataverse business events enable:

- Event-driven integration patterns
- Webhook and Service Bus delivery
- Custom event definitions
- Decoupled system architecture
- Real-time data synchronization

Build reactive systems that respond to business changes instantly.
