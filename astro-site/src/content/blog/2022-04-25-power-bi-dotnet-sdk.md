---
title: "Power BI .NET SDK: Building C# Applications with Power BI"
author: Michael John Peña
draft: false
date: 2022-04-25
tags:
  - Power BI
  - .NET
  - C#
  - SDK
  - Development
---

## Getting Started

```bash
dotnet add package Microsoft.PowerBI.Api
dotnet add package Microsoft.Identity.Client
```

## Authentication

```csharp
using Microsoft.Identity.Client;
using Microsoft.PowerBI.Api;
using Microsoft.Rest;

public class PowerBIService
{
    private readonly IConfidentialClientApplication _authApp;
    private readonly string[] _scopes = new[] { "https://analysis.windows.net/powerbi/api/.default" };

    public PowerBIService(IConfiguration config)
    {
        _authApp = ConfidentialClientApplicationBuilder
            .Create(config["AzureAd:ClientId"])
            .WithClientSecret(config["AzureAd:ClientSecret"])
            .WithAuthority(new Uri($"https://login.microsoftonline.com/{config["AzureAd:TenantId"]}"))
            .Build();
    }

    private async Task<PowerBIClient> GetClientAsync()
    {
        var authResult = await _authApp.AcquireTokenForClient(_scopes).ExecuteAsync();
        var tokenCredentials = new TokenCredentials(authResult.AccessToken, "Bearer");
        return new PowerBIClient(new Uri("https://api.powerbi.com"), tokenCredentials);
    }
}
```

## Common Operations

### Workspace Management

```csharp
public async Task<IList<Group>> GetWorkspacesAsync()
{
    using var client = await GetClientAsync();
    var groups = await client.Groups.GetGroupsAsync();
    return groups.Value;
}

public async Task<Group> CreateWorkspaceAsync(string name)
{
    using var client = await GetClientAsync();
    var request = new GroupCreationRequest { Name = name };
    return await client.Groups.CreateGroupAsync(request);
}

public async Task AddUserToWorkspaceAsync(Guid workspaceId, string email, string role)
{
    using var client = await GetClientAsync();
    var user = new GroupUser
    {
        EmailAddress = email,
        GroupUserAccessRight = role // "Admin", "Member", "Contributor", "Viewer"
    };
    await client.Groups.AddGroupUserAsync(workspaceId, user);
}
```

### Dataset Operations

```csharp
public async Task<IList<Dataset>> GetDatasetsAsync(Guid workspaceId)
{
    using var client = await GetClientAsync();
    var datasets = await client.Datasets.GetDatasetsInGroupAsync(workspaceId);
    return datasets.Value;
}

public async Task RefreshDatasetAsync(Guid workspaceId, string datasetId)
{
    using var client = await GetClientAsync();
    await client.Datasets.RefreshDatasetInGroupAsync(workspaceId, datasetId);
}

public async Task<IList<Refresh>> GetRefreshHistoryAsync(Guid workspaceId, string datasetId)
{
    using var client = await GetClientAsync();
    var history = await client.Datasets.GetRefreshHistoryInGroupAsync(workspaceId, datasetId);
    return history.Value;
}
```

### Report Operations

```csharp
public async Task<Report> CloneReportAsync(
    Guid sourceWorkspaceId,
    Guid reportId,
    Guid targetWorkspaceId,
    string newName)
{
    using var client = await GetClientAsync();
    var request = new CloneReportRequest
    {
        Name = newName,
        TargetWorkspaceId = targetWorkspaceId
    };
    return await client.Reports.CloneReportInGroupAsync(sourceWorkspaceId, reportId, request);
}

public async Task<Stream> ExportReportAsync(Guid workspaceId, Guid reportId)
{
    using var client = await GetClientAsync();
    return await client.Reports.ExportReportInGroupAsync(workspaceId, reportId);
}
```

### Embed Token Generation

```csharp
public async Task<EmbedToken> GenerateEmbedTokenAsync(
    Guid workspaceId,
    Guid reportId,
    string datasetId,
    string username = null,
    string[] roles = null)
{
    using var client = await GetClientAsync();

    var tokenRequest = new GenerateTokenRequestV2
    {
        Reports = new List<GenerateTokenRequestV2Report>
        {
            new GenerateTokenRequestV2Report(reportId)
        },
        Datasets = new List<GenerateTokenRequestV2Dataset>
        {
            new GenerateTokenRequestV2Dataset(datasetId)
        }
    };

    if (!string.IsNullOrEmpty(username) && roles?.Length > 0)
    {
        tokenRequest.Identities = new List<EffectiveIdentity>
        {
            new EffectiveIdentity(
                username,
                datasets: new List<string> { datasetId },
                roles: roles.ToList()
            )
        };
    }

    return await client.EmbedToken.GenerateTokenAsync(tokenRequest);
}
```

## Complete Service Example

```csharp
public interface IPowerBIService
{
    Task<IList<Group>> GetWorkspacesAsync();
    Task<EmbedConfig> GetReportEmbedConfigAsync(Guid workspaceId, Guid reportId, string username);
    Task RefreshDatasetAsync(Guid workspaceId, string datasetId);
}

public class PowerBIServiceImpl : IPowerBIService, IDisposable
{
    private readonly IConfidentialClientApplication _authApp;
    private readonly IMemoryCache _cache;
    private readonly ILogger<PowerBIServiceImpl> _logger;

    public async Task<EmbedConfig> GetReportEmbedConfigAsync(
        Guid workspaceId,
        Guid reportId,
        string username)
    {
        using var client = await GetClientAsync();

        var report = await client.Reports.GetReportInGroupAsync(workspaceId, reportId);

        var tokenRequest = new GenerateTokenRequestV2
        {
            Reports = new List<GenerateTokenRequestV2Report>
            {
                new GenerateTokenRequestV2Report(reportId)
            },
            Datasets = new List<GenerateTokenRequestV2Dataset>
            {
                new GenerateTokenRequestV2Dataset(report.DatasetId)
            },
            Identities = new List<EffectiveIdentity>
            {
                new EffectiveIdentity(
                    username,
                    datasets: new List<string> { report.DatasetId },
                    roles: new List<string> { "ViewerRole" }
                )
            }
        };

        var token = await client.EmbedToken.GenerateTokenAsync(tokenRequest);

        return new EmbedConfig
        {
            ReportId = report.Id.ToString(),
            EmbedUrl = report.EmbedUrl,
            Token = token.Token,
            TokenExpiry = token.Expiration
        };
    }

    public void Dispose()
    {
        // Cleanup resources
    }
}
```

## Dependency Injection Setup

```csharp
// Program.cs or Startup.cs
builder.Services.AddSingleton<IPowerBIService, PowerBIServiceImpl>();

// With options
builder.Services.AddOptions<PowerBIOptions>()
    .Bind(builder.Configuration.GetSection("PowerBI"));

public class PowerBIOptions
{
    public string TenantId { get; set; }
    public string ClientId { get; set; }
    public string ClientSecret { get; set; }
    public string WorkspaceId { get; set; }
}
```

## Best Practices

```yaml
resource_management:
  - Use 'using' statements for PowerBIClient
  - Implement IDisposable for services
  - Cache tokens appropriately

error_handling:
  - Handle HttpOperationException
  - Implement retry for transient failures
  - Log detailed error information

performance:
  - Batch operations when possible
  - Use async/await consistently
  - Cache frequently accessed data
```

## Conclusion

The Power BI .NET SDK provides:
- Strongly-typed API access
- Simplified authentication
- Full Power BI API coverage
- Easy integration with .NET applications

## Resources

- [SDK NuGet Package](https://www.nuget.org/packages/Microsoft.PowerBI.Api)
- [SDK Documentation](https://docs.microsoft.com/en-us/power-bi/developer/embedded/)
