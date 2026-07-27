---
title: Pulumi for Azure Infrastructure as Code
author: Michael John Peña
draft: false
date: 2021-06-10
url: /blog/pulumi-azure-infrastructure/
tags:
  - Pulumi
  - Azure
  - Infrastructure as Code
  - C#
---

Pulumi is the infrastructure-as-code choice for teams where "I don't want to learn another DSL" is a genuine constraint. You write infrastructure in C#, TypeScript, Python, or Go—real languages with type systems, IDEs, loops, and conditionals—and Pulumi's provider handles the translation to Azure Resource Manager. For .NET teams already fluent in C#, the productivity gain over Bicep or Terraform HCL is real: `var storageAccount = new StorageAccount("sa", ...)` is immediately readable without learning HCL syntax. The trade-off is that the Pulumi Azure provider tracks the Azure API closely but sometimes lags behind AzureRM Terraform or Bicep for brand-new services. For teams comfortable with C# and the Pulumi model, it's a compelling choice.

## Getting Started with Pulumi

### Installation

```bash
# Install Pulumi CLI
brew install pulumi

# Or on Windows
choco install pulumi

# Login to Pulumi
pulumi login

# Create new Azure C# project
pulumi new azure-csharp
```

### Project Structure

```
MyAzureInfra/
├── Pulumi.yaml           # Project configuration
├── Pulumi.dev.yaml       # Dev stack configuration
├── Pulumi.prod.yaml      # Prod stack configuration
├── Program.cs            # Main entry point
├── MyStack.cs            # Infrastructure definition
└── MyAzureInfra.csproj   # C# project file
```

## Basic Pulumi Configuration

### Pulumi.yaml

```yaml
name: my-azure-infra
runtime: dotnet
description: Azure infrastructure for my application
```

### Program.cs

```csharp
using System.Threading.Tasks;
using Pulumi;

class Program
{
    static Task<int> Main() => Deployment.RunAsync<MyStack>();
}
```

## Defining Azure Resources

### Basic Resource Group and App Service

```csharp
using Pulumi;
using Pulumi.AzureNative.Resources;
using Pulumi.AzureNative.Web;
using Pulumi.AzureNative.Web.Inputs;

class MyStack : Stack
{
    public MyStack()
    {
        var config = new Config();
        var environment = config.Require("environment");
        var location = config.Get("location") ?? "AustraliaEast";

        // Resource Group
        var resourceGroup = new ResourceGroup("rg", new ResourceGroupArgs
        {
            ResourceGroupName = $"rg-myapp-{environment}",
            Location = location,
            Tags =
            {
                { "Environment", environment },
                { "ManagedBy", "Pulumi" }
            }
        });

        // App Service Plan
        var appServicePlan = new AppServicePlan("asp", new AppServicePlanArgs
        {
            Name = $"asp-myapp-{environment}",
            ResourceGroupName = resourceGroup.Name,
            Location = resourceGroup.Location,
            Kind = "Linux",
            Reserved = true,
            Sku = new SkuDescriptionArgs
            {
                Name = environment == "prod" ? "S1" : "B1",
                Tier = environment == "prod" ? "Standard" : "Basic"
            }
        });

        // App Service
        var appService = new WebApp("app", new WebAppArgs
        {
            Name = $"app-myapp-{environment}",
            ResourceGroupName = resourceGroup.Name,
            Location = resourceGroup.Location,
            ServerFarmId = appServicePlan.Id,
            HttpsOnly = true,
            SiteConfig = new SiteConfigArgs
            {
                LinuxFxVersion = "DOTNETCORE|6.0",
                AlwaysOn = environment == "prod",
                Http20Enabled = true,
                MinTlsVersion = "1.2"
            },
            Identity = new ManagedServiceIdentityArgs
            {
                Type = Pulumi.AzureNative.Web.ManagedServiceIdentityType.SystemAssigned
            }
        });

        // Outputs
        this.ResourceGroupName = resourceGroup.Name;
        this.AppServiceUrl = appService.DefaultHostName.Apply(h => $"https://{h}");
        this.AppServicePrincipalId = appService.Identity.Apply(i => i?.PrincipalId ?? "");
    }

    [Output]
    public Output<string> ResourceGroupName { get; set; }

    [Output]
    public Output<string> AppServiceUrl { get; set; }

    [Output]
    public Output<string?> AppServicePrincipalId { get; set; }
}
```

## SQL Database Infrastructure

```csharp
using Pulumi;
using Pulumi.AzureNative.Sql;
using Pulumi.AzureNative.Sql.Inputs;

public class SqlInfrastructure
{
    public Server SqlServer { get; }
    public Database Database { get; }

    public SqlInfrastructure(
        string name,
        Input<string> resourceGroupName,
        Input<string> location,
        string environment,
        Config config)
    {
        var adminUsername = config.RequireSecret("sqlAdminUsername");
        var adminPassword = config.RequireSecret("sqlAdminPassword");

        // SQL Server
        SqlServer = new Server($"sql-{name}", new ServerArgs
        {
            ServerName = $"sql-{name}-{environment}",
            ResourceGroupName = resourceGroupName,
            Location = location,
            AdministratorLogin = adminUsername,
            AdministratorLoginPassword = adminPassword,
            Version = "12.0",
            MinimalTlsVersion = "1.2"
        });

        // Database
        Database = new Database($"sqldb-{name}", new DatabaseArgs
        {
            DatabaseName = $"sqldb-{name}-{environment}",
            ServerName = SqlServer.Name,
            ResourceGroupName = resourceGroupName,
            Location = location,
            Sku = new SkuArgs
            {
                Name = environment == "prod" ? "S1" : "Basic",
                Tier = environment == "prod" ? "Standard" : "Basic"
            },
            MaxSizeBytes = environment == "prod" ? 53687091200 : 2147483648
        });

        // Firewall rule for Azure services
        var firewallRule = new FirewallRule("allow-azure", new FirewallRuleArgs
        {
            FirewallRuleName = "AllowAzureServices",
            ServerName = SqlServer.Name,
            ResourceGroupName = resourceGroupName,
            StartIpAddress = "0.0.0.0",
            EndIpAddress = "0.0.0.0"
        });
    }
}
```

## Key Vault with Secrets

```csharp
using Pulumi;
using Pulumi.AzureNative.KeyVault;
using Pulumi.AzureNative.KeyVault.Inputs;
using Pulumi.AzureNative.Authorization;

public class KeyVaultInfrastructure
{
    public Vault KeyVault { get; }

    public KeyVaultInfrastructure(
        string name,
        Input<string> resourceGroupName,
        Input<string> location,
        string tenantId,
        string environment,
        Output<string?> appServicePrincipalId)
    {
        KeyVault = new Vault($"kv-{name}", new VaultArgs
        {
            VaultName = $"kv-{name}-{environment}",
            ResourceGroupName = resourceGroupName,
            Location = location,
            Properties = new VaultPropertiesArgs
            {
                TenantId = tenantId,
                Sku = new SkuArgs
                {
                    Family = SkuFamily.A,
                    Name = Pulumi.AzureNative.KeyVault.SkuName.Standard
                },
                EnableSoftDelete = true,
                SoftDeleteRetentionInDays = 7,
                EnablePurgeProtection = environment == "prod",
                AccessPolicies = new[]
                {
                    // App Service access
                    new AccessPolicyEntryArgs
                    {
                        TenantId = tenantId,
                        ObjectId = appServicePrincipalId!,
                        Permissions = new PermissionsArgs
                        {
                            Secrets = new[]
                            {
                                SecretPermissions.Get,
                                SecretPermissions.List
                            }
                        }
                    }
                }
            }
        });
    }

    public Secret AddSecret(
        string name,
        Input<string> value,
        Input<string> resourceGroupName)
    {
        return new Secret(name, new SecretArgs
        {
            SecretName = name,
            VaultName = KeyVault.Name,
            ResourceGroupName = resourceGroupName,
            Properties = new SecretPropertiesArgs
            {
                Value = value
            }
        });
    }
}
```

## Component Resources

```csharp
using Pulumi;
using Pulumi.AzureNative.Resources;
using Pulumi.AzureNative.Web;

public class WebAppComponentArgs
{
    public Input<string> ResourceGroupName { get; set; } = null!;
    public Input<string> Location { get; set; } = null!;
    public string Environment { get; set; } = null!;
    public Dictionary<string, Input<string>> AppSettings { get; set; } = new();
}

public class WebAppComponent : ComponentResource
{
    public Output<string> Url { get; private set; }
    public Output<string?> PrincipalId { get; private set; }

    public WebAppComponent(
        string name,
        WebAppComponentArgs args,
        ComponentResourceOptions? options = null)
        : base("mycompany:azure:WebAppComponent", name, options)
    {
        var plan = new AppServicePlan($"{name}-plan", new AppServicePlanArgs
        {
            Name = $"asp-{name}-{args.Environment}",
            ResourceGroupName = args.ResourceGroupName,
            Location = args.Location,
            Kind = "Linux",
            Reserved = true,
            Sku = new Pulumi.AzureNative.Web.Inputs.SkuDescriptionArgs
            {
                Name = "B1",
                Tier = "Basic"
            }
        }, new CustomResourceOptions { Parent = this });

        var appSettings = args.AppSettings
            .Select(kvp => new NameValuePairArgs
            {
                Name = kvp.Key,
                Value = kvp.Value
            })
            .ToList();

        var app = new WebApp($"{name}-app", new WebAppArgs
        {
            Name = $"app-{name}-{args.Environment}",
            ResourceGroupName = args.ResourceGroupName,
            Location = args.Location,
            ServerFarmId = plan.Id,
            HttpsOnly = true,
            SiteConfig = new SiteConfigArgs
            {
                LinuxFxVersion = "DOTNETCORE|6.0",
                AppSettings = appSettings
            },
            Identity = new ManagedServiceIdentityArgs
            {
                Type = ManagedServiceIdentityType.SystemAssigned
            }
        }, new CustomResourceOptions { Parent = this });

        Url = app.DefaultHostName.Apply(h => $"https://{h}");
        PrincipalId = app.Identity.Apply(i => i?.PrincipalId);

        RegisterOutputs(new Dictionary<string, object?>
        {
            { "url", Url },
            { "principalId", PrincipalId }
        });
    }
}
```

## Using Components in Stack

```csharp
using Pulumi;
using Pulumi.AzureNative.Resources;

class MyStack : Stack
{
    public MyStack()
    {
        var config = new Config();
        var environment = config.Require("environment");

        var resourceGroup = new ResourceGroup("rg", new ResourceGroupArgs
        {
            ResourceGroupName = $"rg-myapp-{environment}",
            Location = "AustraliaEast"
        });

        // Use component for API
        var apiComponent = new WebAppComponent("api", new WebAppComponentArgs
        {
            ResourceGroupName = resourceGroup.Name,
            Location = resourceGroup.Location,
            Environment = environment,
            AppSettings = new Dictionary<string, Input<string>>
            {
                { "ASPNETCORE_ENVIRONMENT", "Production" }
            }
        });

        // Use component for Web
        var webComponent = new WebAppComponent("web", new WebAppComponentArgs
        {
            ResourceGroupName = resourceGroup.Name,
            Location = resourceGroup.Location,
            Environment = environment,
            AppSettings = new Dictionary<string, Input<string>>
            {
                { "ApiUrl", apiComponent.Url }
            }
        });

        this.ApiUrl = apiComponent.Url;
        this.WebUrl = webComponent.Url;
    }

    [Output]
    public Output<string> ApiUrl { get; set; }

    [Output]
    public Output<string> WebUrl { get; set; }
}
```

## Stack References

```csharp
// Networking stack (deployed separately)
class NetworkingStack : Stack
{
    [Output]
    public Output<string> VNetId { get; set; }

    [Output]
    public Output<string> SubnetId { get; set; }
}

// Application stack referencing networking
class ApplicationStack : Stack
{
    public ApplicationStack()
    {
        var config = new Config();
        var environment = config.Require("environment");

        // Reference another stack
        var networkingStack = new StackReference($"myorg/networking/{environment}");
        var subnetId = networkingStack.GetOutput("SubnetId").Apply(id => id.ToString());

        // Use the subnet from networking stack
        var appService = new WebApp("app", new WebAppArgs
        {
            // ... other config
            VirtualNetworkSubnetId = subnetId
        });
    }
}
```

## Deployment Commands

```bash
# Preview changes
pulumi preview

# Deploy to dev
pulumi up --stack dev

# Deploy to prod
pulumi up --stack prod

# View outputs
pulumi stack output

# Destroy resources
pulumi destroy
```

## Conclusion

Pulumi brings the power of general-purpose programming languages to infrastructure as code. For .NET developers, using C# for Azure infrastructure means familiar tooling, strong typing, refactoring support, and the ability to create reusable components. The learning curve is minimal for developers already comfortable with Azure and C#.

## References

- [Pulumi Azure Native Provider](https://www.pulumi.com/registry/packages/azure-native/)
- [Pulumi C# Documentation](https://www.pulumi.com/docs/intro/languages/dotnet/)
