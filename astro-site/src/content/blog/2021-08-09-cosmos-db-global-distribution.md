---
title: "Cosmos DB Global Distribution: Building Planet-Scale Applications"
description: "Global distribution in Cosmos DB provides the foundation for building truly global, resilient applications that serve users with consistent low latency…"
author: "Michael John Peña"
draft: false
date: 2021-08-09
tags: ["Azure", "Cosmos DB", "Global Distribution", "Multi-Region", "High Availability"]
---

## Adding Regions to Your Account

```bash
# Add multiple regions to Cosmos DB account
az cosmosdb update \
    --resource-group myResourceGroup \
    --name mycosmosaccount \
    --locations regionName=eastus failoverPriority=0 isZoneRedundant=true \
    --locations regionName=westus failoverPriority=1 isZoneRedundant=true \
    --locations regionName=northeurope failoverPriority=2 isZoneRedundant=false \
    --locations regionName=southeastasia failoverPriority=3 isZoneRedundant=false
```

Using Terraform:

```hcl
resource "azurerm_cosmosdb_account" "global" {
  name                = "mycosmosaccount"
  location            = "East US"
  resource_group_name = azurerm_resource_group.example.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = "eastus"
    failover_priority = 0
    zone_redundant    = true
  }

  geo_location {
    location          = "westus"
    failover_priority = 1
    zone_redundant    = true
  }

  geo_location {
    location          = "northeurope"
    failover_priority = 2
    zone_redundant    = false
  }

  geo_location {
    location          = "southeastasia"
    failover_priority = 3
    zone_redundant    = false
  }
}
```

## Configuring Preferred Regions in SDK

```csharp
// C# - Configure preferred regions for optimal routing
using Microsoft.Azure.Cosmos;

public class GlobalCosmosClient
{
    public static CosmosClient CreateClient()
    {
        var options = new CosmosClientOptions
        {
            // List regions in order of preference
            ApplicationPreferredRegions = new List<string>
            {
                Regions.EastUS,
                Regions.WestUS,
                Regions.NorthEurope,
                Regions.SoutheastAsia
            },

            // Enable automatic region discovery
            LimitToEndpoint = false,

            // Connection settings for global distribution
            ConnectionMode = ConnectionMode.Direct,
            MaxRetryAttemptsOnRateLimitedRequests = 9,
            MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30)
        };

        return new CosmosClient(
            Environment.GetEnvironmentVariable("COSMOS_ENDPOINT"),
            Environment.GetEnvironmentVariable("COSMOS_KEY"),
            options
        );
    }
}
```

## Dynamic Region Selection Based on User Location

```javascript
// Node.js - Dynamic region selection
const { CosmosClient } = require("@azure/cosmos");

class RegionAwareCosmosClient {
    constructor() {
        this.regionMapping = {
            'US': ['East US', 'West US'],
            'EU': ['North Europe', 'West Europe'],
            'APAC': ['Southeast Asia', 'East Asia'],
            'AU': ['Australia East', 'Australia Southeast']
        };
    }

    getClientForRegion(userRegion) {
        const preferredRegions = this.regionMapping[userRegion] ||
                                 this.regionMapping['US'];  // Default to US

        return new CosmosClient({
            endpoint: process.env.COSMOS_ENDPOINT,
            key: process.env.COSMOS_KEY,
            connectionPolicy: {
                preferredLocations: preferredRegions,
                enableEndpointDiscovery: true
            }
        });
    }

    async getDataWithOptimalRouting(userRegion, containerId, query) {
        const client = this.getClientForRegion(userRegion);
        const container = client
            .database(process.env.COSMOS_DATABASE)
            .container(containerId);

        const startTime = Date.now();
        const { resources, diagnostics } = await container.items
            .query(query)
            .fetchAll();

        console.log(`Query completed in ${Date.now() - startTime}ms`);
        console.log(`Routed to region: ${diagnostics?.clientSideRequestStatistics?.locationEndpointsContacted}`);

        return resources;
    }
}
```

## Monitoring Global Distribution

```python
# Python - Monitor replication lag and region health
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential
from azure.mgmt.cosmosdb import CosmosDBManagementClient
import time

class GlobalDistributionMonitor:
    def __init__(self, subscription_id, resource_group, account_name):
        self.credential = DefaultAzureCredential()
        self.mgmt_client = CosmosDBManagementClient(
            self.credential, subscription_id
        )
        self.resource_group = resource_group
        self.account_name = account_name

    def get_region_status(self):
        """Get status of all regions"""
        account = self.mgmt_client.database_accounts.get(
            self.resource_group,
            self.account_name
        )

        regions = []
        for location in account.locations:
            regions.append({
                'name': location.location_name,
                'failover_priority': location.failover_priority,
                'is_zone_redundant': location.is_zone_redundant,
                'provisioning_state': location.provisioning_state,
                'document_endpoint': location.document_endpoint
            })

        return sorted(regions, key=lambda x: x['failover_priority'])

    def measure_replication_lag(self, write_region_client, read_region_client,
                                 database_name, container_name):
        """Measure replication lag between regions"""
        write_container = write_region_client \
            .get_database_client(database_name) \
            .get_container_client(container_name)

        read_container = read_region_client \
            .get_database_client(database_name) \
            .get_container_client(container_name)

        # Write a test document
        test_doc = {
            'id': f'replication-test-{int(time.time())}',
            'partitionKey': 'test',
            'timestamp': time.time(),
            'data': 'replication lag test'
        }

        write_start = time.time()
        write_container.create_item(test_doc)
        write_time = time.time() - write_start

        # Poll read region until document appears
        read_start = time.time()
        max_wait = 30  # seconds

        while time.time() - read_start < max_wait:
            try:
                read_container.read_item(
                    test_doc['id'],
                    partition_key='test'
                )
                replication_lag = time.time() - read_start
                break
            except:
                time.sleep(0.1)
        else:
            replication_lag = None  # Exceeded max wait

        # Cleanup
        write_container.delete_item(test_doc['id'], partition_key='test')

        return {
            'write_latency_ms': write_time * 1000,
            'replication_lag_ms': replication_lag * 1000 if replication_lag else None
        }
```

## Automatic Failover Configuration

```bash
# Enable automatic failover
az cosmosdb update \
    --resource-group myResourceGroup \
    --name mycosmosaccount \
    --enable-automatic-failover true

# Manually trigger failover for testing
az cosmosdb failover-priority-change \
    --resource-group myResourceGroup \
    --name mycosmosaccount \
    --failover-policies "westus=0" "eastus=1" "northeurope=2"
```

## Best Practices

1. **Enable zone redundancy**: For production regions, always enable
2. **Test failover regularly**: Validate your disaster recovery plan
3. **Configure SDK timeouts**: Account for cross-region latency
4. **Monitor replication metrics**: Watch for lag spikes
5. **Use service-managed failover**: Unless you need manual control

Global distribution in Cosmos DB provides the foundation for building truly global, resilient applications that serve users with consistent low latency regardless of their location.
