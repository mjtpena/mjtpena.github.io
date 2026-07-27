---
title: Deploying Blazor WebAssembly Applications on Azure
author: Michael John Peña
draft: false
date: 2021-06-02
url: /blog/blazor-webassembly-azure-deployment/
tags:
  - Azure
  - Blazor
  - WebAssembly
  - .NET

---

I wrote "2021-06-02-blazor-webassembly-azure-deployment" to share practical, production-minded guidance on this topic.

## Creating a Blazor WebAssembly Project

Let's start with a new Blazor WebAssembly project:

```bash
dotnet new blazorwasm -o BlazorAzureDemo
cd BlazorAzureDemo
```

## Project Structure

A typical Blazor WASM project includes:

```
BlazorAzureDemo/
├── wwwroot/
│   ├── css/
│   ├── index.html
│   └── favicon.ico
├── Pages/
│   ├── Index.razor
│   ├── Counter.razor
│   └── FetchData.razor
├── Shared/
│   ├── MainLayout.razor
│   └── NavMenu.razor
├── Program.cs
└── BlazorAzureDemo.csproj
```

## Deployment Option 1: Azure Static Web Apps

The most straightforward option for client-side Blazor apps:

### GitHub Actions Workflow

```yaml
name: Azure Static Web Apps CI/CD

on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main

jobs:
  build_and_deploy_job:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy Job
    steps:
      - uses: actions/checkout@v2
        with:
          submodules: true

      - name: Setup .NET
        uses: actions/setup-dotnet@v1
        with:
          dotnet-version: '6.0.x'
          include-prerelease: true

      - name: Build Blazor App
        run: dotnet publish -c Release -o publish

      - name: Deploy to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "publish/wwwroot"
          output_location: ""
```

### Static Web App Configuration

Create `staticwebapp.config.json`:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/_framework/*", "/css/*", "/*.{png,jpg,gif,ico,svg}"]
  },
  "mimeTypes": {
    ".dll": "application/octet-stream",
    ".wasm": "application/wasm",
    ".json": "application/json"
  }
}
```

## Deployment Option 2: Azure App Service

For hosted Blazor apps with ASP.NET Core backend:

### Creating Hosted Blazor Project

```bash
dotnet new blazorwasm -o BlazorHosted --hosted
```

### App Service Deployment via Azure CLI

```bash
# Create App Service Plan
az appservice plan create \
  --name blazor-asp \
  --resource-group blazor-rg \
  --sku B1 \
  --is-linux

# Create Web App
az webapp create \
  --name blazor-hosted-demo \
  --resource-group blazor-rg \
  --plan blazor-asp \
  --runtime "DOTNET|6.0"

# Deploy from local
dotnet publish -c Release
cd Server/bin/Release/net6.0/publish
zip -r deploy.zip .

az webapp deployment source config-zip \
  --resource-group blazor-rg \
  --name blazor-hosted-demo \
  --src deploy.zip
```

## Deployment Option 3: Azure Blob Storage + CDN

For cost-effective static hosting:

```bash
# Create storage account
az storage account create \
  --name blazorstoragedemo \
  --resource-group blazor-rg \
  --location australiaeast \
  --sku Standard_LRS

# Enable static website hosting
az storage blob service-properties update \
  --account-name blazorstoragedemo \
  --static-website \
  --index-document index.html \
  --404-document index.html

# Build and publish
dotnet publish -c Release -o publish

# Upload to blob storage
az storage blob upload-batch \
  --account-name blazorstoragedemo \
  --source publish/wwwroot \
  --destination '$web'
```

### Adding Azure CDN

```bash
# Create CDN profile
az cdn profile create \
  --name blazor-cdn-profile \
  --resource-group blazor-rg \
  --sku Standard_Microsoft

# Create CDN endpoint
az cdn endpoint create \
  --name blazor-cdn-endpoint \
  --profile-name blazor-cdn-profile \
  --resource-group blazor-rg \
  --origin blazorstoragedemo.z8.web.core.windows.net \
  --origin-host-header blazorstoragedemo.z8.web.core.windows.net
```

## Optimizing Blazor WASM Performance

### Enable Compression

In `Program.cs`:

```csharp
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(
        new[] { "application/octet-stream", "application/wasm" });
});
```

### Configure Lazy Loading

In your `.csproj`:

```xml
<PropertyGroup>
  <BlazorWebAssemblyLoadAllGlobalizationData>false</BlazorWebAssemblyLoadAllGlobalizationData>
</PropertyGroup>

<ItemGroup>
  <BlazorWebAssemblyLazyLoad Include="System.Xml.dll" />
  <BlazorWebAssemblyLazyLoad Include="System.Linq.Expressions.dll" />
</ItemGroup>
```

### Implement Assembly Lazy Loading

```csharp
@page "/admin"
@inject LazyAssemblyLoader AssemblyLoader

@code {
    private bool isLoaded = false;

    protected override async Task OnInitializedAsync()
    {
        var assemblies = await AssemblyLoader.LoadAssembliesAsync(
            new[] { "AdminModule.dll" });
        isLoaded = true;
    }
}
```

## Integrating with Azure Functions Backend

### Azure Function for API

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using System.Net;

public class WeatherFunction
{
    [Function("GetWeather")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "weather")]
        HttpRequestData req)
    {
        var response = req.CreateResponse(HttpStatusCode.OK);

        var forecasts = Enumerable.Range(1, 5).Select(index => new WeatherForecast
        {
            Date = DateTime.Now.AddDays(index),
            TemperatureC = Random.Shared.Next(-20, 55),
            Summary = Summaries[Random.Shared.Next(Summaries.Length)]
        }).ToArray();

        await response.WriteAsJsonAsync(forecasts);
        return response;
    }

    private static readonly string[] Summaries = new[]
    {
        "Freezing", "Bracing", "Chilly", "Cool", "Mild",
        "Warm", "Balmy", "Hot", "Sweltering", "Scorching"
    };
}
```

### Blazor Component Calling Function

```razor
@page "/weather"
@inject HttpClient Http

<h3>Weather Forecast</h3>

@if (forecasts == null)
{
    <p>Loading...</p>
}
else
{
    <table class="table">
        <thead>
            <tr>
                <th>Date</th>
                <th>Temp. (C)</th>
                <th>Summary</th>
            </tr>
        </thead>
        <tbody>
            @foreach (var forecast in forecasts)
            {
                <tr>
                    <td>@forecast.Date.ToShortDateString()</td>
                    <td>@forecast.TemperatureC</td>
                    <td>@forecast.Summary</td>
                </tr>
            }
        </tbody>
    </table>
}

@code {
    private WeatherForecast[]? forecasts;

    protected override async Task OnInitializedAsync()
    {
        forecasts = await Http.GetFromJsonAsync<WeatherForecast[]>("api/weather");
    }
}
```

## Authentication with Azure AD B2C

```csharp
// Program.cs
builder.Services.AddMsalAuthentication(options =>
{
    builder.Configuration.Bind("AzureAdB2C", options.ProviderOptions.Authentication);
    options.ProviderOptions.DefaultAccessTokenScopes.Add(
        "https://yourtenant.onmicrosoft.com/api/access_as_user");
});
```

```json
// wwwroot/appsettings.json
{
  "AzureAdB2C": {
    "Authority": "https://yourtenant.b2clogin.com/yourtenant.onmicrosoft.com/B2C_1_signupsignin",
    "ClientId": "your-client-id",
    "ValidateAuthority": false
  }
}
```

## Conclusion

Blazor WebAssembly on Azure offers multiple deployment paths, each suited for different scenarios. Azure Static Web Apps provides the simplest deployment for pure client-side apps, while Azure App Service is ideal for hosted solutions requiring server-side processing. Understanding these options allows you to choose the best fit for your application's requirements.

## References

- [Blazor WebAssembly Documentation](https://docs.microsoft.com/en-us/aspnet/core/blazor/)
- [Azure Static Web Apps with Blazor](https://docs.microsoft.com/en-us/azure/static-web-apps/deploy-blazor)

