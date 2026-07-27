---
title: "GitHub Copilot Preview: AI-Powered Code Completion"
author: Michael John Peña
draft: false
date: 2022-01-12
url: /blog/github-copilot-preview/
tags:
  - github
  - ai
  - copilot
  - productivity
---

GitHub Copilot in early 2022 was in a limited technical preview, available to a subset of developers who had requested access—and the developer reactions ranged from "this will replace programming" to "this is just autocomplete that sometimes writes bugs." The reality that emerged from the preview period was somewhere between those extremes: Copilot is genuinely useful for boilerplate code (writing unit test stubs, generating CRUD operations, scaffolding repetitive patterns), reduces the friction of working in unfamiliar languages or frameworks, and accelerates the "I know what I want to do but I can't remember the exact API syntax" moments. It is genuinely poor at business logic that depends on domain-specific context the model wasn't trained on, and it requires the developer to read and validate every suggestion rather than blindly accepting. The GitHub-commissioned study showing 55% faster task completion for developers using Copilot became a reference point in the industry conversation about AI-assisted development productivity.

## What is GitHub Copilot?

Copilot is an AI-powered code completion tool trained on billions of lines of public code. It understands context, comments, and function names to suggest relevant code.

## Getting Started

After getting access to the preview, install the VS Code extension:

```bash
# Install via VS Code Extensions marketplace
# Search for "GitHub Copilot"
```

## How Copilot Works

Write a comment describing what you want, and Copilot suggests the implementation:

```python
# Function to calculate the fibonacci sequence up to n terms
def fibonacci(n):
    # Copilot suggests:
    if n <= 0:
        return []
    elif n == 1:
        return [0]
    elif n == 2:
        return [0, 1]

    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    return fib
```

## Copilot for Azure Development

```csharp
// Create an Azure Blob Storage client and upload a file
// Copilot suggests:
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

public async Task UploadFileAsync(string connectionString, string containerName, string filePath)
{
    var blobServiceClient = new BlobServiceClient(connectionString);
    var containerClient = blobServiceClient.GetBlobContainerClient(containerName);

    await containerClient.CreateIfNotExistsAsync();

    var fileName = Path.GetFileName(filePath);
    var blobClient = containerClient.GetBlobClient(fileName);

    await using var fileStream = File.OpenRead(filePath);
    await blobClient.UploadAsync(fileStream, overwrite: true);
}
```

## Writing Tests with Copilot

```typescript
// Test that the user service returns correct user data
// Copilot suggests:
describe('UserService', () => {
  let userService: UserService;
  let mockRepository: jest.Mocked<UserRepository>;

  beforeEach(() => {
    mockRepository = {
      findById: jest.fn(),
      findAll: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    userService = new UserService(mockRepository);
  });

  describe('getUserById', () => {
    it('should return user when found', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com' };
      mockRepository.findById.mockResolvedValue(mockUser);

      const result = await userService.getUserById('1');

      expect(result).toEqual(mockUser);
      expect(mockRepository.findById).toHaveBeenCalledWith('1');
    });

    it('should throw error when user not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(userService.getUserById('999')).rejects.toThrow('User not found');
    });
  });
});
```

## Infrastructure as Code

```bicep
// Create a complete Azure Function App with Application Insights
// Copilot suggests:
param location string = resourceGroup().location
param functionAppName string
param storageAccountName string

resource storageAccount 'Microsoft.Storage/storageAccounts@2021-08-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${functionAppName}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
  }
}

resource hostingPlan 'Microsoft.Web/serverfarms@2021-03-01' = {
  name: '${functionAppName}-plan'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
}

resource functionApp 'Microsoft.Web/sites@2021-03-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: hostingPlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsights.properties.InstrumentationKey
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'dotnet'
        }
      ]
    }
  }
}
```

## Best Practices

1. **Write clear comments** - Copilot uses them as context
2. **Review suggestions carefully** - AI can make mistakes
3. **Use descriptive function names** - Better suggestions
4. **Iterate** - Press Tab to accept, Esc to dismiss, Alt+] for next suggestion
5. **Learn from suggestions** - Discover new patterns and APIs

GitHub Copilot is a glimpse into the future of software development where AI augments human creativity.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
