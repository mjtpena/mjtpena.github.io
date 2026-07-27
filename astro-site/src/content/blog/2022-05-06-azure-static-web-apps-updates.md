---
title: "Azure Static Web Apps: New Features at Build 2022"
author: Michael John Peña
draft: false
date: 2022-05-06
tags:
  - azure
  - static-web-apps
  - jamstack
  - serverless

---

I wrote "Azure Static Web Apps: New Features at Build 2022" to share practical, production-minded guidance on this topic.

## New Features Overview

Build 2022 brings several enhancements:
- Stable APIs using Azure Functions
- Enterprise edge support
- Improved authentication options
- Split environment configurations

## Project Setup

Create a new Static Web App with React and Azure Functions:

```bash
# Create React app
npx create-react-app my-swa-app --template typescript
cd my-swa-app

# Create API folder
mkdir api
cd api
func init --worker-runtime node --language typescript
func new --name GetProducts --template "HTTP trigger"
```

## API Implementation

Create a products API with Azure Functions:

```typescript
// api/GetProducts/index.ts
import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { CosmosClient } from "@azure/cosmos";

const cosmosClient = new CosmosClient(process.env.COSMOS_CONNECTION_STRING!);
const database = cosmosClient.database("ecommerce");
const container = database.container("products");

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  const category = req.query.category;
  const page = parseInt(req.query.page || "1");
  const pageSize = 20;

  let query = "SELECT * FROM c WHERE c.type = 'product'";
  const parameters: any[] = [];

  if (category) {
    query += " AND c.category = @category";
    parameters.push({ name: "@category", value: category });
  }

  query += " ORDER BY c.createdAt DESC";
  query += ` OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}`;

  const { resources: products } = await container.items
    .query({ query, parameters })
    .fetchAll();

  context.res = {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
    body: {
      products,
      page,
      pageSize,
      hasMore: products.length === pageSize,
    },
  };
};

export default httpTrigger;
```

## Authentication Configuration

Configure authentication providers:

```json
// staticwebapp.config.json
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
      "route": "/.auth/login/aad",
      "statusCode": 404
    }
  ],
  "auth": {
    "identityProviders": {
      "azureActiveDirectory": {
        "userDetailsClaim": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
        "registration": {
          "openIdIssuer": "https://login.microsoftonline.com/<tenant-id>/v2.0",
          "clientIdSettingName": "AAD_CLIENT_ID",
          "clientSecretSettingName": "AAD_CLIENT_SECRET"
        },
        "login": {
          "loginParameters": ["scope=openid profile email"]
        }
      },
      "customOpenIdConnectProviders": {
        "okta": {
          "registration": {
            "clientIdSettingName": "OKTA_CLIENT_ID",
            "clientCredential": {
              "clientSecretSettingName": "OKTA_CLIENT_SECRET"
            },
            "openIdConnectConfiguration": {
              "wellKnownOpenIdConfiguration": "https://dev-xxxxx.okta.com/.well-known/openid-configuration"
            }
          },
          "login": {
            "nameClaimType": "name",
            "scopes": ["openid", "profile", "email"]
          }
        }
      }
    }
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
  }
}
```

## React Frontend with Authentication

```tsx
// src/components/UserProfile.tsx
import React, { useEffect, useState } from "react";

interface UserInfo {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
  claims: { typ: string; val: string }[];
}

export const UserProfile: React.FC = () => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUser() {
      try {
        const response = await fetch("/.auth/me");
        const data = await response.json();
        if (data.clientPrincipal) {
          setUser(data.clientPrincipal);
        }
      } catch (error) {
        console.error("Failed to fetch user", error);
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, []);

  if (loading) return <div>Loading...</div>;

  if (!user) {
    return (
      <div className="auth-buttons">
        <a href="/.auth/login/aad" className="btn btn-primary">
          Login with Azure AD
        </a>
        <a href="/.auth/login/github" className="btn btn-secondary">
          Login with GitHub
        </a>
      </div>
    );
  }

  return (
    <div className="user-profile">
      <h2>Welcome, {user.userDetails}</h2>
      <p>Provider: {user.identityProvider}</p>
      <p>Roles: {user.userRoles.join(", ")}</p>
      <a href="/.auth/logout" className="btn btn-outline">
        Logout
      </a>
    </div>
  );
};
```

## Products Component

```tsx
// src/components/ProductList.tsx
import React, { useEffect, useState } from "react";

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  category: string;
}

interface ProductsResponse {
  products: Product[];
  page: number;
  hasMore: boolean;
}

export const ProductList: React.FC<{ category?: string }> = ({ category }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchProducts = async (pageNum: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pageNum.toString() });
      if (category) params.append("category", category);

      const response = await fetch(`/api/GetProducts?${params}`);
      const data: ProductsResponse = await response.json();

      setProducts((prev) =>
        pageNum === 1 ? data.products : [...prev, ...data.products]
      );
      setHasMore(data.hasMore);
    } catch (error) {
      console.error("Failed to fetch products", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    fetchProducts(1);
  }, [category]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchProducts(nextPage);
  };

  return (
    <div className="product-list">
      <div className="products-grid">
        {products.map((product) => (
          <div key={product.id} className="product-card">
            <img src={product.imageUrl} alt={product.name} />
            <h3>{product.name}</h3>
            <p>{product.description}</p>
            <span className="price">${product.price.toFixed(2)}</span>
          </div>
        ))}
      </div>
      {hasMore && (
        <button onClick={loadMore} disabled={loading} className="load-more">
          {loading ? "Loading..." : "Load More"}
        </button>
      )}
    </div>
  );
};
```

## GitHub Actions Deployment

```yaml
# .github/workflows/azure-static-web-apps.yml
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
  build_and_deploy:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          REACT_APP_API_URL: "/api"

      - name: Build API
        run: |
          cd api
          npm ci
          npm run build

      - name: Deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/"
          api_location: "api"
          output_location: "build"

  close_pull_request:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - name: Close Pull Request
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: "close"
```

## Enterprise Edge Configuration

Enable enterprise-grade CDN:

```bicep
resource staticWebApp 'Microsoft.Web/staticSites@2022-03-01' = {
  name: 'my-swa'
  location: 'eastus2'
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    repositoryUrl: 'https://github.com/org/repo'
    branch: 'main'
    buildProperties: {
      appLocation: '/'
      apiLocation: 'api'
      outputLocation: 'build'
    }
    enterpriseGradeCdnStatus: 'Enabled'
  }
}

resource customDomain 'Microsoft.Web/staticSites/customDomains@2022-03-01' = {
  parent: staticWebApp
  name: 'www.contoso.com'
  properties: {
    validationMethod: 'cname-delegation'
  }
}
```

## Summary

Azure Static Web Apps at Build 2022 offers:

- Stable Azure Functions integration for APIs
- Enhanced authentication with custom providers
- Enterprise edge for global distribution
- Improved configuration options
- Seamless GitHub/Azure DevOps integration

It remains an excellent choice for JAMstack applications with serverless backends.


