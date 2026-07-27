---
title: "Azure Static Web Apps Enterprise Features: Production-Ready JAMstack"
author: Michael John Pena
draft: false
date: 2021-11-06
tags:
  - Azure
  - Static Web Apps
  - JAMstack
  - Web Development
  - Enterprise

---

I wrote "Azure Static Web Apps Enterprise Features: Production-Ready JAMstack" to share practical, production-minded guidance on this topic.

## What's New for Enterprise

The Standard tier introduces:

- **Private Endpoints**: Connect to Azure services over private networks
- **Custom Authentication Providers**: Use your own identity provider
- **Increased API Timeout**: Up to 45 seconds for longer-running operations
- **More Staging Environments**: Up to 10 preview environments
- **Higher Bandwidth**: 100 GB included per app

## Setting Up an Enterprise Static Web App

Start with a React application:

```bash
# Create a new React app
npx create-react-app my-enterprise-app --template typescript
cd my-enterprise-app

# Add API folder
mkdir -p api
cd api
func init --worker-runtime node --language typescript
func new --name GetData --template "HTTP trigger"
cd ..
```

Configure the static web app in `staticwebapp.config.json`:

```json
{
  "routes": [
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    },
    {
      "route": "/admin/*",
      "allowedRoles": ["admin"]
    },
    {
      "route": "/.auth/login/github",
      "statusCode": 404
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/images/*.{png,jpg,gif}", "/api/*"]
  },
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/aad",
      "statusCode": 302
    }
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  },
  "mimeTypes": {
    ".json": "application/json",
    ".wasm": "application/wasm"
  }
}
```

## Custom Authentication with Azure AD

Configure Azure AD as your identity provider:

```json
{
  "auth": {
    "identityProviders": {
      "azureActiveDirectory": {
        "registration": {
          "openIdIssuer": "https://login.microsoftonline.com/<tenant-id>/v2.0",
          "clientIdSettingName": "AAD_CLIENT_ID",
          "clientSecretSettingName": "AAD_CLIENT_SECRET"
        },
        "userDetailsClaim": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
        "login": {
          "loginParameters": ["scope=openid profile email"]
        }
      }
    }
  },
  "routes": [
    {
      "route": "/*",
      "allowedRoles": ["authenticated"]
    }
  ]
}
```

React component handling authentication:

```tsx
// src/components/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';

interface User {
  userId: string;
  userDetails: string;
  userRoles: string[];
  claims: { typ: string; val: string }[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (provider: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUser() {
      try {
        const response = await fetch('/.auth/me');
        const data = await response.json();
        if (data.clientPrincipal) {
          setUser(data.clientPrincipal);
        }
      } catch (error) {
        console.error('Error fetching user:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, []);

  const login = (provider: string) => {
    window.location.href = `/.auth/login/${provider}?post_login_redirect_uri=${window.location.pathname}`;
  };

  const logout = () => {
    window.location.href = '/.auth/logout';
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

## Private Endpoints for Backend Services

Connect securely to Azure services:

```typescript
// api/GetData/index.ts
import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  // Using managed identity with private endpoint
  const credential = new DefaultAzureCredential();
  const blobServiceClient = new BlobServiceClient(
    // This connection goes through private endpoint
    `https://${process.env.STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
    credential
  );

  const containerClient = blobServiceClient.getContainerClient("data");

  try {
    const blobs: string[] = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      blobs.push(blob.name);
    }

    context.res = {
      status: 200,
      body: { files: blobs },
      headers: {
        "Content-Type": "application/json"
      }
    };
  } catch (error) {
    context.log.error("Error accessing blob storage:", error);
    context.res = {
      status: 500,
      body: { error: "Failed to access storage" }
    };
  }
};

export default httpTrigger;
```

Bicep template for private endpoint configuration:

```bicep
param location string = resourceGroup().location
param staticWebAppName string
param storageAccountName string
param vnetName string
param subnetName string

resource vnet 'Microsoft.Network/virtualNetworks@2021-05-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: ['10.0.0.0/16']
    }
    subnets: [
      {
        name: subnetName
        properties: {
          addressPrefix: '10.0.1.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2021-03-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    repositoryUrl: 'https://github.com/your-org/your-repo'
    branch: 'main'
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2021-06-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
  }
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2021-05-01' = {
  name: '${storageAccountName}-pe'
  location: location
  properties: {
    subnet: {
      id: vnet.properties.subnets[0].id
    }
    privateLinkServiceConnections: [
      {
        name: '${storageAccountName}-connection'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: ['blob']
        }
      }
    ]
  }
}
```

## Role-Based Access Control

Implement fine-grained access control:

```typescript
// api/shared/auth.ts
import { Context, HttpRequest } from "@azure/functions";

interface ClientPrincipal {
  userId: string;
  userRoles: string[];
  claims: { typ: string; val: string }[];
}

export function getClientPrincipal(req: HttpRequest): ClientPrincipal | null {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;

  const encoded = Buffer.from(header, "base64");
  const decoded = encoded.toString("utf8");
  return JSON.parse(decoded);
}

export function requireRole(roles: string[]) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (context: Context, req: HttpRequest) {
      const principal = getClientPrincipal(req);

      if (!principal) {
        context.res = { status: 401, body: "Unauthorized" };
        return;
      }

      const hasRole = roles.some((role) => principal.userRoles.includes(role));
      if (!hasRole) {
        context.res = { status: 403, body: "Forbidden" };
        return;
      }

      return originalMethod.apply(this, [context, req]);
    };

    return descriptor;
  };
}
```

Using the role decorator:

```typescript
// api/AdminData/index.ts
import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { requireRole, getClientPrincipal } from "../shared/auth";

class AdminHandler {
  @requireRole(["admin"])
  async handle(context: Context, req: HttpRequest): Promise<void> {
    const principal = getClientPrincipal(req);

    context.res = {
      status: 200,
      body: {
        message: "Admin data retrieved",
        user: principal?.userId,
        data: {
          totalUsers: 1250,
          activeSubscriptions: 890,
          monthlyRevenue: 125000
        }
      }
    };
  }
}

const handler = new AdminHandler();
const httpTrigger: AzureFunction = handler.handle.bind(handler);

export default httpTrigger;
```

## GitHub Actions Deployment

Enterprise-grade CI/CD pipeline:

```yaml
# .github/workflows/azure-static-web-apps.yml
name: Azure Static Web Apps CI/CD

on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches: [main]

env:
  NODE_VERSION: '16.x'

jobs:
  build_and_deploy:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy
    steps:
      - uses: actions/checkout@v2
        with:
          submodules: true

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test -- --coverage --watchAll=false

      - name: Build application
        run: npm run build
        env:
          REACT_APP_API_URL: ${{ secrets.API_URL }}
          REACT_APP_ENVIRONMENT: production

      - name: Run security scan
        uses: snyk/actions/node@master
        with:
          args: --severity-threshold=high
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

      - name: Deploy to Azure Static Web Apps
        id: deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/"
          api_location: "api"
          output_location: "build"

      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v5
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '🚀 Preview deployed to: ${{ steps.deploy.outputs.static_web_app_url }}'
            })

  close_pull_request:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    name: Close Pull Request
    steps:
      - name: Close staging environment
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: "close"
```

## Monitoring and Observability

Add Application Insights:

```typescript
// api/shared/telemetry.ts
import { TelemetryClient } from "applicationinsights";

let client: TelemetryClient | null = null;

export function getTelemetryClient(): TelemetryClient {
  if (!client) {
    const appInsights = require("applicationinsights");
    appInsights
      .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
      .setAutoDependencyCorrelation(true)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true)
      .setAutoCollectExceptions(true)
      .start();

    client = appInsights.defaultClient;
  }
  return client!;
}

export function trackEvent(name: string, properties?: Record<string, string>) {
  getTelemetryClient().trackEvent({ name, properties });
}

export function trackMetric(name: string, value: number) {
  getTelemetryClient().trackMetric({ name, value });
}
```

Azure Static Web Apps with enterprise features provides a production-ready platform for modern web applications. The combination of global distribution, managed APIs, and enterprise security makes it a compelling choice for organizations.

## Resources

- [Static Web Apps Enterprise Features](https://docs.microsoft.com/en-us/azure/static-web-apps/enterprise-edge)
- [Authentication Configuration](https://docs.microsoft.com/en-us/azure/static-web-apps/authentication-custom)
- [Private Endpoints](https://docs.microsoft.com/en-us/azure/static-web-apps/private-endpoint)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
