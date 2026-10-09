---
title: "Dataverse Plugins: Server-Side Business Logic"
author: Michael John Peña
draft: false
date: 2022-05-19
tags:
  - dataverse
  - power-platform
  - Plugins
  - csharp
---

## Plugin Development Basics

Set up a plugin project:

```xml
<!-- Plugin.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net462</TargetFramework>
    <SignAssembly>true</SignAssembly>
    <AssemblyOriginatorKeyFile>key.snk</AssemblyOriginatorKeyFile>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.CrmSdk.CoreAssemblies" Version="9.0.2.*" />
    <PackageReference Include="Microsoft.CrmSdk.Workflow" Version="9.0.2.*" />
  </ItemGroup>
</Project>
```

## Basic Plugin Structure

```csharp
using Microsoft.Xrm.Sdk;
using System;

namespace MyPlugins
{
    public class AccountValidationPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            // Get execution context
            var context = (IPluginExecutionContext)serviceProvider
                .GetService(typeof(IPluginExecutionContext));

            // Get tracing service for debugging
            var tracingService = (ITracingService)serviceProvider
                .GetService(typeof(ITracingService));

            // Get organization service factory
            var serviceFactory = (IOrganizationServiceFactory)serviceProvider
                .GetService(typeof(IOrganizationServiceFactory));

            // Create organization service
            var service = serviceFactory.CreateOrganizationService(context.UserId);

            tracingService.Trace("Plugin execution started");

            try
            {
                // Ensure we have a target entity
                if (!context.InputParameters.Contains("Target"))
                    return;

                var target = context.InputParameters["Target"] as Entity;
                if (target == null)
                    return;

                // Execute business logic
                ValidateAccount(target, tracingService);

                tracingService.Trace("Plugin execution completed successfully");
            }
            catch (InvalidPluginExecutionException)
            {
                throw; // Re-throw validation exceptions
            }
            catch (Exception ex)
            {
                tracingService.Trace($"Error: {ex.Message}");
                throw new InvalidPluginExecutionException(
                    $"An error occurred in the plugin: {ex.Message}", ex);
            }
        }

        private void ValidateAccount(Entity account, ITracingService trace)
        {
            trace.Trace("Validating account data");

            // Validate account name
            var name = account.GetAttributeValue<string>("name");
            if (string.IsNullOrWhiteSpace(name))
            {
                throw new InvalidPluginExecutionException(
                    "Account name is required.");
            }

            if (name.Length < 3)
            {
                throw new InvalidPluginExecutionException(
                    "Account name must be at least 3 characters.");
            }

            // Validate revenue
            var revenue = account.GetAttributeValue<Money>("revenue");
            if (revenue != null && revenue.Value < 0)
            {
                throw new InvalidPluginExecutionException(
                    "Revenue cannot be negative.");
            }

            // Validate email format
            var email = account.GetAttributeValue<string>("emailaddress1");
            if (!string.IsNullOrEmpty(email) && !IsValidEmail(email))
            {
                throw new InvalidPluginExecutionException(
                    "Please enter a valid email address.");
            }

            trace.Trace("Account validation passed");
        }

        private bool IsValidEmail(string email)
        {
            try
            {
                var addr = new System.Net.Mail.MailAddress(email);
                return addr.Address == email;
            }
            catch
            {
                return false;
            }
        }
    }
}
```

## Pre-Operation Plugin

Modify data before it's saved:

```csharp
public class OrderCalculationPlugin : IPlugin
{
    public void Execute(IServiceProvider serviceProvider)
    {
        var context = (IPluginExecutionContext)serviceProvider
            .GetService(typeof(IPluginExecutionContext));
        var trace = (ITracingService)serviceProvider
            .GetService(typeof(ITracingService));

        if (context.Stage != 20) // Pre-operation
            return;

        if (!context.InputParameters.Contains("Target"))
            return;

        var target = (Entity)context.InputParameters["Target"];

        // Calculate order totals
        CalculateOrderTotals(target, context, trace);
    }

    private void CalculateOrderTotals(
        Entity order,
        IPluginExecutionContext context,
        ITracingService trace)
    {
        var serviceFactory = (IOrganizationServiceFactory)context
            .GetType()
            .GetProperty("ServiceProvider")
            .GetValue(context);

        trace.Trace("Calculating order totals");

        decimal subtotal = 0;
        decimal discount = 0;
        decimal tax = 0;

        // If updating, get existing line items
        if (context.MessageName == "Update")
        {
            var orderId = order.Id != Guid.Empty
                ? order.Id
                : ((EntityReference)context.InputParameters["Target"]).Id;

            // Query line items
            // Calculate totals from lines
        }

        // Get discount percentage
        var discountPercent = order.GetAttributeValue<decimal?>("discountpercentage") ?? 0;
        discount = subtotal * (discountPercent / 100);

        // Calculate tax (example: 10%)
        var taxRate = 0.10m;
        tax = (subtotal - discount) * taxRate;

        // Set calculated fields
        order["discountamount"] = new Money(discount);
        order["tax"] = new Money(tax);
        order["totalamount"] = new Money(subtotal - discount + tax);

        trace.Trace($"Calculated totals - Subtotal: {subtotal}, Discount: {discount}, Tax: {tax}");
    }
}
```

## Post-Operation Plugin

Execute logic after data is saved:

```csharp
public class OpportunityWonPlugin : IPlugin
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

        if (context.Stage != 40) // Post-operation
            return;

        var target = (Entity)context.InputParameters["Target"];
        var preImage = context.PreEntityImages.Contains("PreImage")
            ? context.PreEntityImages["PreImage"]
            : null;

        // Check if opportunity was just won
        var newStatus = target.GetAttributeValue<OptionSetValue>("statecode")?.Value;
        var oldStatus = preImage?.GetAttributeValue<OptionSetValue>("statecode")?.Value;

        if (newStatus == 1 && oldStatus != 1) // Won
        {
            trace.Trace("Opportunity won - executing post-win actions");

            // Create follow-up task
            CreateFollowUpTask(service, target, context);

            // Update account statistics
            UpdateAccountStatistics(service, target, trace);

            // Send notification
            SendWinNotification(service, target, trace);
        }
    }

    private void CreateFollowUpTask(
        IOrganizationService service,
        Entity opportunity,
        IPluginExecutionContext context)
    {
        var task = new Entity("task");
        task["subject"] = "Follow up on won opportunity";
        task["description"] = $"Congratulations on winning this opportunity! " +
            $"Please follow up with the customer to ensure smooth onboarding.";
        task["regardingobjectid"] = opportunity.ToEntityReference();
        task["ownerid"] = opportunity.GetAttributeValue<EntityReference>("ownerid");
        task["scheduledend"] = DateTime.Now.AddDays(7);
        task["prioritycode"] = new OptionSetValue(2); // High

        service.Create(task);
    }

    private void UpdateAccountStatistics(
        IOrganizationService service,
        Entity opportunity,
        ITracingService trace)
    {
        var accountRef = opportunity.GetAttributeValue<EntityReference>("parentaccountid");
        if (accountRef == null) return;

        var account = service.Retrieve(
            "account",
            accountRef.Id,
            new ColumnSet("numberofemployees", "revenue"));

        // Update won opportunities count (custom field)
        var currentWon = account.GetAttributeValue<int?>("cr_wonopportunities") ?? 0;

        var updateAccount = new Entity("account", accountRef.Id);
        updateAccount["cr_wonopportunities"] = currentWon + 1;

        service.Update(updateAccount);

        trace.Trace($"Updated account statistics for {accountRef.Name}");
    }

    private void SendWinNotification(
        IOrganizationService service,
        Entity opportunity,
        ITracingService trace)
    {
        // Create email notification
        var email = new Entity("email");
        email["subject"] = $"Opportunity Won: {opportunity.GetAttributeValue<string>("name")}";
        email["description"] = $"Great news! The opportunity has been won.\n\n" +
            $"Value: {opportunity.GetAttributeValue<Money>("estimatedvalue")?.Value:C}";

        // Get owner email
        var ownerRef = opportunity.GetAttributeValue<EntityReference>("ownerid");

        var from = new Entity("activityparty");
        from["partyid"] = new EntityReference("systemuser", Guid.Empty); // System

        var to = new Entity("activityparty");
        to["partyid"] = ownerRef;

        email["from"] = new EntityCollection(new[] { from });
        email["to"] = new EntityCollection(new[] { to });
        email["regardingobjectid"] = opportunity.ToEntityReference();

        var emailId = service.Create(email);

        // Send the email
        var sendRequest = new OrganizationRequest("SendEmail");
        sendRequest["EmailId"] = emailId;
        sendRequest["IssueSend"] = true;
        service.Execute(sendRequest);

        trace.Trace("Win notification sent");
    }
}
```

## Plugin with External Service Call

Integrate with external APIs:

```csharp
public class AddressValidationPlugin : IPlugin
{
    private readonly string _apiKey;

    public AddressValidationPlugin(string unsecureConfig, string secureConfig)
    {
        // Get API key from secure configuration
        _apiKey = secureConfig;
    }

    public void Execute(IServiceProvider serviceProvider)
    {
        var context = (IPluginExecutionContext)serviceProvider
            .GetService(typeof(IPluginExecutionContext));
        var trace = (ITracingService)serviceProvider
            .GetService(typeof(ITracingService));

        var target = (Entity)context.InputParameters["Target"];

        // Get address fields
        var street = target.GetAttributeValue<string>("address1_line1");
        var city = target.GetAttributeValue<string>("address1_city");
        var state = target.GetAttributeValue<string>("address1_stateorprovince");
        var postal = target.GetAttributeValue<string>("address1_postalcode");
        var country = target.GetAttributeValue<string>("address1_country");

        if (string.IsNullOrEmpty(street) && string.IsNullOrEmpty(city))
            return;

        trace.Trace("Validating address with external service");

        try
        {
            var validatedAddress = ValidateAddressAsync(
                street, city, state, postal, country).Result;

            if (validatedAddress != null)
            {
                // Update with validated/standardized address
                target["address1_line1"] = validatedAddress.Street;
                target["address1_city"] = validatedAddress.City;
                target["address1_stateorprovince"] = validatedAddress.State;
                target["address1_postalcode"] = validatedAddress.PostalCode;
                target["address1_country"] = validatedAddress.Country;
                target["address1_latitude"] = validatedAddress.Latitude;
                target["address1_longitude"] = validatedAddress.Longitude;

                trace.Trace("Address validated and standardized");
            }
        }
        catch (Exception ex)
        {
            trace.Trace($"Address validation failed: {ex.Message}");
            // Don't block the operation, just log the error
        }
    }

    private async Task<ValidatedAddress> ValidateAddressAsync(
        string street, string city, string state, string postal, string country)
    {
        using var client = new HttpClient();
        client.DefaultRequestHeaders.Add("X-API-Key", _apiKey);

        var request = new
        {
            street,
            city,
            state,
            postalCode = postal,
            country
        };

        var response = await client.PostAsJsonAsync(
            "https://api.addressvalidation.com/validate",
            request);

        if (response.IsSuccessStatusCode)
        {
            return await response.Content.ReadFromJsonAsync<ValidatedAddress>();
        }

        return null;
    }
}

public class ValidatedAddress
{
    public string Street { get; set; }
    public string City { get; set; }
    public string State { get; set; }
    public string PostalCode { get; set; }
    public string Country { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}
```

## Plugin Registration

Register plugins using the Plugin Registration Tool or code:

```csharp
// Registration helper
public class PluginRegistration
{
    public void RegisterAccountValidationPlugin(IOrganizationService service)
    {
        // Register assembly
        var assembly = new Entity("pluginassembly");
        assembly["name"] = "MyPlugins";
        assembly["content"] = Convert.ToBase64String(File.ReadAllBytes("MyPlugins.dll"));
        assembly["isolationmode"] = new OptionSetValue(2); // Sandbox
        assembly["sourcetype"] = new OptionSetValue(0); // Database

        var assemblyId = service.Create(assembly);

        // Register plugin type
        var pluginType = new Entity("plugintype");
        pluginType["name"] = "MyPlugins.AccountValidationPlugin";
        pluginType["typename"] = "MyPlugins.AccountValidationPlugin";
        pluginType["friendlyname"] = "Account Validation Plugin";
        pluginType["pluginassemblyid"] = new EntityReference("pluginassembly", assemblyId);

        var typeId = service.Create(pluginType);

        // Register step
        var step = new Entity("sdkmessageprocessingstep");
        step["name"] = "Account Validation - Create";
        step["plugintypeid"] = new EntityReference("plugintype", typeId);
        step["sdkmessageid"] = GetMessageId(service, "Create");
        step["sdkmessagefilterid"] = GetFilterId(service, "account", "Create");
        step["stage"] = new OptionSetValue(20); // Pre-operation
        step["mode"] = new OptionSetValue(0); // Synchronous
        step["rank"] = 1;

        service.Create(step);
    }

    private EntityReference GetMessageId(IOrganizationService service, string messageName)
    {
        // Query sdkmessage table
        return new EntityReference("sdkmessage", Guid.Empty);
    }

    private EntityReference GetFilterId(
        IOrganizationService service, string entity, string message)
    {
        // Query sdkmessagefilter table
        return new EntityReference("sdkmessagefilter", Guid.Empty);
    }
}
```

## Summary

Dataverse plugins provide:

- Server-side validation and logic
- Pre and post-operation execution
- External service integration
- Transaction participation
- Secure configuration storage

Build robust business logic that enforces data integrity and automates processes.
