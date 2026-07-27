---
title: "Azure Functions Node.js 18: New Runtime Features"
author: Michael John Peña
draft: false
date: 2022-05-07
tags:
  - azure
  - functions
  - nodejs
  - serverless

---

I wrote "Azure Functions Node.js 18: New Runtime Features" to share practical, production-minded guidance on this topic.

## Setting Up Node.js 18

Create a new Function App with Node.js 18:

```bash
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Create new function project
func init my-functions --worker-runtime node --language typescript

# Update package.json engine
cd my-functions
```

Update your configuration:

```json
// package.json
{
  "name": "my-functions",
  "version": "1.0.0",
  "engines": {
    "node": ">=18.0.0"
  },
  "main": "dist/src/functions/*.js",
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "prestart": "npm run build",
    "start": "func start",
    "test": "jest"
  },
  "dependencies": {
    "@azure/functions": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^18.0.0",
    "typescript": "^4.9.0"
  }
}
```

## New Programming Model

Azure Functions v4 introduces a new programming model:

```typescript
// src/functions/httpTrigger.ts
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

export async function httpTrigger(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(`Http function processed request for url "${request.url}"`);

  const name = request.query.get("name") || (await request.text()) || "World";

  return {
    status: 200,
    jsonBody: {
      message: `Hello, ${name}!`,
      timestamp: new Date().toISOString(),
    },
  };
}

app.http("httpTrigger", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: httpTrigger,
});
```

## Native Fetch API

Use the built-in fetch without external dependencies:

```typescript
// src/functions/fetchData.ts
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

interface GitHubUser {
  login: string;
  name: string;
  public_repos: number;
  followers: number;
}

export async function fetchGitHubUser(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const username = request.query.get("username");

  if (!username) {
    return {
      status: 400,
      jsonBody: { error: "Username is required" },
    };
  }

  try {
    // Native fetch - no dependencies needed!
    const response = await fetch(`https://api.github.com/users/${username}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Azure-Functions",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          status: 404,
          jsonBody: { error: "User not found" },
        };
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const user: GitHubUser = await response.json();

    return {
      status: 200,
      jsonBody: {
        login: user.login,
        name: user.name,
        publicRepos: user.public_repos,
        followers: user.followers,
      },
    };
  } catch (error) {
    context.error("Failed to fetch GitHub user", error);
    return {
      status: 500,
      jsonBody: { error: "Failed to fetch user data" },
    };
  }
}

app.http("fetchGitHubUser", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "github/user",
  handler: fetchGitHubUser,
});
```

## Timer Trigger with Async Operations

```typescript
// src/functions/scheduledCleanup.ts
import { app, InvocationContext, Timer } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";

const connectionString = process.env.STORAGE_CONNECTION_STRING!;
const blobServiceClient =
  BlobServiceClient.fromConnectionString(connectionString);

export async function scheduledCleanup(
  myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  context.log("Cleanup function started", myTimer);

  const containerClient = blobServiceClient.getContainerClient("temp-files");
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7); // 7 days ago

  let deletedCount = 0;

  // Use async iterator for blobs
  for await (const blob of containerClient.listBlobsFlat()) {
    if (blob.properties.lastModified && blob.properties.lastModified < cutoffDate) {
      const blobClient = containerClient.getBlobClient(blob.name);
      await blobClient.delete();
      deletedCount++;
      context.log(`Deleted blob: ${blob.name}`);
    }
  }

  context.log(`Cleanup completed. Deleted ${deletedCount} blobs.`);
}

app.timer("scheduledCleanup", {
  schedule: "0 0 2 * * *", // Run at 2 AM daily
  handler: scheduledCleanup,
});
```

## Queue Trigger with Batching

```typescript
// src/functions/processOrders.ts
import { app, InvocationContext } from "@azure/functions";

interface Order {
  id: string;
  customerId: string;
  items: { productId: string; quantity: number }[];
  totalAmount: number;
}

export async function processOrders(
  messages: Order[],
  context: InvocationContext
): Promise<void> {
  context.log(`Processing batch of ${messages.length} orders`);

  // Process orders concurrently
  const results = await Promise.allSettled(
    messages.map(async (order) => {
      context.log(`Processing order ${order.id}`);

      // Validate order
      if (!order.items || order.items.length === 0) {
        throw new Error(`Order ${order.id} has no items`);
      }

      // Process each item
      for (const item of order.items) {
        await processOrderItem(order.id, item, context);
      }

      // Notify customer
      await sendConfirmationEmail(order, context);

      return order.id;
    })
  );

  // Log results
  const successful = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");

  context.log(`Batch complete: ${successful.length} succeeded, ${failed.length} failed`);

  if (failed.length > 0) {
    const errors = failed.map((r) =>
      r.status === "rejected" ? r.reason : "unknown"
    );
    context.error("Failed orders:", errors);
  }
}

async function processOrderItem(
  orderId: string,
  item: { productId: string; quantity: number },
  context: InvocationContext
): Promise<void> {
  // Call inventory service using native fetch
  const response = await fetch(process.env.INVENTORY_SERVICE_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId,
      productId: item.productId,
      quantity: item.quantity,
    }),
  });

  if (!response.ok) {
    throw new Error(`Inventory service error: ${response.status}`);
  }
}

async function sendConfirmationEmail(
  order: Order,
  context: InvocationContext
): Promise<void> {
  context.log(`Sending confirmation for order ${order.id}`);
  // Email logic here
}

app.storageQueue("processOrders", {
  queueName: "orders",
  connection: "STORAGE_CONNECTION_STRING",
  handler: processOrders,
});
```

## Blob Trigger with Stream Processing

```typescript
// src/functions/processImage.ts
import { app, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";

export async function processImage(
  blob: Buffer,
  context: InvocationContext
): Promise<void> {
  const blobName = context.triggerMetadata.name as string;
  context.log(`Processing image: ${blobName}, size: ${blob.length} bytes`);

  // Process the image (resize, convert, etc.)
  const processedImage = await transformImage(blob);

  // Upload to processed container
  const blobServiceClient = BlobServiceClient.fromConnectionString(
    process.env.STORAGE_CONNECTION_STRING!
  );
  const containerClient = blobServiceClient.getContainerClient("processed-images");
  const outputBlobClient = containerClient.getBlockBlobClient(
    `processed-${blobName}`
  );

  await outputBlobClient.upload(processedImage, processedImage.length, {
    blobHTTPHeaders: {
      blobContentType: "image/webp",
    },
  });

  context.log(`Processed image uploaded: processed-${blobName}`);
}

async function transformImage(buffer: Buffer): Promise<Buffer> {
  // Image processing logic here
  // In production, use sharp or similar library
  return buffer;
}

app.storageBlob("processImage", {
  path: "uploads/{name}",
  connection: "STORAGE_CONNECTION_STRING",
  handler: processImage,
});
```

## Cosmos DB Trigger

```typescript
// src/functions/cosmosDBTrigger.ts
import { app, InvocationContext } from "@azure/functions";

interface Document {
  id: string;
  type: string;
  data: any;
  _ts: number;
}

export async function cosmosDBTrigger(
  documents: Document[],
  context: InvocationContext
): Promise<void> {
  context.log(`Cosmos DB trigger received ${documents.length} documents`);

  for (const doc of documents) {
    context.log(`Document id: ${doc.id}, type: ${doc.type}`);

    switch (doc.type) {
      case "order":
        await handleOrderChange(doc, context);
        break;
      case "customer":
        await handleCustomerChange(doc, context);
        break;
      default:
        context.log(`Unknown document type: ${doc.type}`);
    }
  }
}

async function handleOrderChange(
  doc: Document,
  context: InvocationContext
): Promise<void> {
  // Sync to search index, send notifications, etc.
  context.log(`Processing order change: ${doc.id}`);
}

async function handleCustomerChange(
  doc: Document,
  context: InvocationContext
): Promise<void> {
  // Update related records, trigger workflows, etc.
  context.log(`Processing customer change: ${doc.id}`);
}

app.cosmosDB("cosmosDBTrigger", {
  connectionStringSetting: "COSMOS_CONNECTION_STRING",
  databaseName: "ecommerce",
  collectionName: "items",
  createLeaseCollectionIfNotExists: true,
  handler: cosmosDBTrigger,
});
```

## Summary

Node.js 18 in Azure Functions brings:

- New v4 programming model with cleaner syntax
- Native fetch API for HTTP requests
- Improved TypeScript support
- Better async/await patterns
- Enhanced performance and memory management

This update makes Azure Functions more aligned with modern Node.js development practices.


