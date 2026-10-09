---
title: "GitHub Codespaces: Cloud Development with Azure Integration"
description: "GitHub Codespaces provides browser-accessible, cloud-hosted VS Code development environments where the development container (with all tools, extensions…"
author: Michael John Peña
draft: false
date: 2022-05-03
tags:
  - GitHub
  - codespaces
  - Azure
  - developer-tools
---

GitHub Codespaces provides browser-accessible, cloud-hosted VS Code development environments where the development container (with all tools, extensions, and language runtimes pre-installed according to the repository's devcontainer.json) starts in seconds—eliminating the "works on my machine" problem and enabling contributors to start coding in a repository without any local setup. The Azure integration dimension: Codespaces can be configured to authenticate to Azure services (via GitHub OIDC federation or stored Azure credentials in GitHub Secrets) so that the development environment in the Codespace can run `az` CLI commands, execute Terraform plans against Azure, or connect to Azure-hosted databases—making the cloud development workflow from Codespace to Azure seamless. For open-source projects, Codespaces enables contributors to try the development environment without installing anything locally; for enterprise teams, it enforces consistent development environment standards across the team without requiring everyone to follow a setup script correctly.

## What is GitHub Codespaces?

Codespaces creates a complete development environment in the cloud, including a VS Code editor, terminal, debugger, and extensions. Everything runs in a container, ensuring consistency across team members.

## Devcontainer Configuration

Configure your development environment using devcontainer.json:

```json
{
  "name": "Azure Development",
  "image": "mcr.microsoft.com/devcontainers/dotnet:0-6.0",
  "features": {
    "ghcr.io/devcontainers/features/azure-cli:1": {},
    "ghcr.io/devcontainers/features/node:1": {
      "version": "18"
    },
    "ghcr.io/devcontainers/features/docker-in-docker:2": {}
  },
  "customizations": {
    "vscode": {
      "extensions": [
        "ms-azuretools.vscode-azurefunctions",
        "ms-azuretools.vscode-azureresourcegroups",
        "ms-azuretools.vscode-cosmosdb",
        "ms-dotnettools.csharp",
        "ms-vscode.azure-account"
      ],
      "settings": {
        "terminal.integrated.defaultProfile.linux": "bash",
        "editor.formatOnSave": true
      }
    }
  },
  "postCreateCommand": "dotnet restore && npm install",
  "forwardPorts": [5000, 5001, 7071],
  "remoteUser": "vscode"
}
```

## Custom Docker Image

For more control, create a custom Dockerfile:

```dockerfile
# .devcontainer/Dockerfile
FROM mcr.microsoft.com/devcontainers/dotnet:0-6.0

# Install Azure CLI
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash

# Install Azure Functions Core Tools
RUN curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg \
    && mv microsoft.gpg /etc/apt/trusted.gpg.d/microsoft.gpg \
    && sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/microsoft-ubuntu-$(lsb_release -cs)-prod $(lsb_release -cs) main" > /etc/apt/sources.list.d/dotnetdev.list' \
    && apt-get update \
    && apt-get install -y azure-functions-core-tools-4

# Install Azurite (Storage Emulator)
RUN npm install -g azurite

# Install additional tools
RUN apt-get install -y jq httpie

# Configure Azure CLI extensions
RUN az extension add --name azure-devops \
    && az extension add --name containerapp

USER vscode
```

## Secrets Management

Configure secrets for Azure authentication:

```bash
# In Codespaces, secrets are available as environment variables
# Configure these in repository settings or organization level

# Using Azure Service Principal
export AZURE_CLIENT_ID="your-client-id"
export AZURE_CLIENT_SECRET="your-client-secret"
export AZURE_TENANT_ID="your-tenant-id"
export AZURE_SUBSCRIPTION_ID="your-subscription-id"
```

Then use them in your application:

```csharp
using Azure.Identity;
using Azure.ResourceManager;

public class AzureService
{
    private readonly ArmClient _armClient;

    public AzureService()
    {
        // DefaultAzureCredential will use environment variables in Codespaces
        var credential = new DefaultAzureCredential();
        _armClient = new ArmClient(credential);
    }

    public async Task<IEnumerable<string>> ListResourceGroupsAsync()
    {
        var subscription = await _armClient.GetDefaultSubscriptionAsync();
        var resourceGroups = subscription.GetResourceGroups();

        var names = new List<string>();
        await foreach (var rg in resourceGroups)
        {
            names.Add(rg.Data.Name);
        }
        return names;
    }
}
```

## Azure Functions Development

Develop Azure Functions directly in Codespaces:

```csharp
// HttpTriggerFunction.cs
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

public class HttpTriggerFunction
{
    private readonly ILogger<HttpTriggerFunction> _logger;

    public HttpTriggerFunction(ILogger<HttpTriggerFunction> logger)
    {
        _logger = logger;
    }

    [Function("ProcessOrder")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
    {
        _logger.LogInformation("Processing order request");

        var order = await req.ReadFromJsonAsync<Order>();

        // Process the order
        var result = await ProcessOrderAsync(order);

        var response = req.CreateResponse(HttpStatusCode.OK);
        await response.WriteAsJsonAsync(result);
        return response;
    }

    private async Task<OrderResult> ProcessOrderAsync(Order order)
    {
        // Business logic here
        return new OrderResult { OrderId = Guid.NewGuid(), Status = "Processed" };
    }
}
```

Run locally in Codespaces:

```bash
# Start Azurite for local storage emulation
azurite --silent --location /tmp/azurite &

# Run the function
cd src/FunctionApp
func start --port 7071
```

## Port Forwarding

Access your running applications from outside Codespaces:

```json
{
  "forwardPorts": [5000, 5001, 7071, 10000, 10001, 10002],
  "portsAttributes": {
    "5000": {
      "label": "Web API",
      "onAutoForward": "notify"
    },
    "7071": {
      "label": "Azure Functions",
      "onAutoForward": "openBrowser"
    },
    "10000": {
      "label": "Azurite Blob",
      "onAutoForward": "silent"
    }
  }
}
```

## Prebuilds for Faster Startup

Configure prebuilds to reduce Codespace creation time:

```yaml
# .github/workflows/codespaces-prebuild.yml
name: Codespaces Prebuild

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  prebuild:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup .NET
        uses: actions/setup-dotnet@v3
        with:
          dotnet-version: '6.0.x'

      - name: Restore dependencies
        run: dotnet restore

      - name: Build
        run: dotnet build --no-restore
```

## Integration with Azure DevOps

Connect Codespaces to Azure DevOps for CI/CD:

```yaml
# azure-pipelines.yml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

stages:
  - stage: Build
    jobs:
      - job: BuildJob
        steps:
          - task: UseDotNet@2
            inputs:
              version: '6.0.x'

          - task: DotNetCoreCLI@2
            inputs:
              command: 'build'
              projects: '**/*.csproj'

          - task: DotNetCoreCLI@2
            inputs:
              command: 'publish'
              publishWebProjects: true
              arguments: '--output $(Build.ArtifactStagingDirectory)'

          - publish: $(Build.ArtifactStagingDirectory)
            artifact: WebApp

  - stage: Deploy
    dependsOn: Build
    jobs:
      - deployment: DeployToAzure
        environment: 'production'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureWebApp@1
                  inputs:
                    azureSubscription: 'Azure-Connection'
                    appName: 'my-web-app'
                    package: '$(Pipeline.Workspace)/WebApp/*.zip'
```

## Cost Optimization

Configure machine types based on project needs:

```json
{
  "hostRequirements": {
    "cpus": 4,
    "memory": "8gb",
    "storage": "32gb"
  }
}
```

## Summary

GitHub Codespaces transforms cloud development by providing:

- Instant, reproducible development environments
- Deep VS Code integration with full debugging support
- Seamless Azure service connectivity
- Cost-effective machine sizing
- Prebuild optimization for faster startup

Combined with Azure services, Codespaces enables true cloud-native development workflows.

---

References:
- [GitHub Codespaces Documentation](https://docs.github.com/en/codespaces)
- [Devcontainer Specification](https://containers.dev/)
- [Azure Development with Codespaces](https://docs.microsoft.com/en-us/azure/developer/github/codespaces)
