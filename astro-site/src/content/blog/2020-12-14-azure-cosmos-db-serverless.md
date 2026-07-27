---
title: "Azure Cosmos DB Serverless: Pay-Per-Request NoSQL"
author: Michael John Peña
draft: false
date: 2020-12-14
tags:
  - Azure
  - Cosmos DB
  - Serverless
  - NoSQL

---

I wrote "Azure Cosmos DB Serverless: Pay-Per-Request NoSQL" to share practical, production-minded guidance on this topic.

## Serverless vs Provisioned

| Aspect | Serverless | Provisioned |
|--------|------------|-------------|
| Billing | Per request (RU) | Per hour (RU/s) |
| Min cost | $0 (when idle) | ~$24/month |
| Max throughput | 5,000 RU/s burst | Unlimited |
| Multi-region | No | Yes |
| Availability SLA | 99.9% | 99.99% |
| Best for | Dev/test, variable loads | Production, steady loads |

## Creating Serverless Account

```bash
az cosmosdb create \
    --name my-cosmos-serverless \
    --resource-group myRG \
    --locations regionName=eastus \
    --capabilities EnableServerless \
    --default-consistency-level Session
```

## Creating Database and Container

```bash
# Create database
az cosmosdb sql database create \
    --account-name my-cosmos-serverless \
    --resource-group myRG \
    --name mydb

# Create container (no throughput provisioning needed)
az cosmosdb sql container create \
    --account-name my-cosmos-serverless \
    --resource-group myRG \
    --database-name mydb \
    --name mycontainer \
    --partition-key-path /partitionKey
```

## SDK Usage (Same as Provisioned)

```csharp
using Microsoft.Azure.Cosmos;

var client = new CosmosClient(connectionString);
var container = client.GetContainer("mydb", "mycontainer");

// Create item
var item = new { id = "1", partitionKey = "pk1", name = "Test" };
await container.CreateItemAsync(item, new PartitionKey("pk1"));

// Query items
var query = new QueryDefinition("SELECT * FROM c WHERE c.partitionKey = @pk")
    .WithParameter("@pk", "pk1");

var iterator = container.GetItemQueryIterator<dynamic>(query);
while (iterator.HasMoreResults)
{
    var response = await iterator.ReadNextAsync();
    Console.WriteLine($"RU charge: {response.RequestCharge}");

    foreach (var item in response)
    {
        Console.WriteLine(item.name);
    }
}
```

## Cost Optimization

```csharp
// Track RU consumption
var response = await container.ReadItemAsync<MyItem>("id", new PartitionKey("pk"));
Console.WriteLine($"Read cost: {response.RequestCharge} RU");

var createResponse = await container.CreateItemAsync(newItem, new PartitionKey("pk"));
Console.WriteLine($"Write cost: {createResponse.RequestCharge} RU");

// Optimize queries
var query = container.GetItemQueryIterator<MyItem>(
    new QueryDefinition("SELECT c.id, c.name FROM c WHERE c.partitionKey = @pk")
        .WithParameter("@pk", "pk1"),
    requestOptions: new QueryRequestOptions
    {
        MaxItemCount = 100,
        PartitionKey = new PartitionKey("pk1")  // Avoid cross-partition
    }
);
```

## Pricing Example

| Operation | RU Cost | Price |
|-----------|---------|-------|
| Point read (1KB) | 1 RU | $0.000000282 |
| Point write (1KB) | ~5 RU | $0.00000141 |
| Query (simple) | ~3 RU | $0.000000846 |
| Query (complex) | ~50+ RU | Variable |

**Example monthly cost:**
- 10,000 reads/day = 300K reads/month = $0.085
- 1,000 writes/day = 30K writes/month = $0.042
- **Total: ~$0.13/month**

## When to Use Serverless

✅ **Good for:**
- Development and testing
- Low-traffic applications
- Bursty, unpredictable workloads
- Getting started with Cosmos DB
- Microservices with variable load

❌ **Not ideal for:**
- High-throughput production
- Multi-region requirements
- Sustained traffic > 5,000 RU/s
- Applications needing 99.99% SLA

## Migrating to Provisioned

```bash
# Cannot migrate in-place
# Export data, create provisioned account, import

# Using Data Migration Tool
dt.exe /s:CosmosDB /s.ConnectionString:"..." \
    /t:CosmosDB /t.ConnectionString:"..." /t.Throughput:1000
```

Cosmos DB Serverless: NoSQL without the commitment.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
