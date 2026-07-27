---
title: "Azure HPC Cache: Accelerating High-Performance Computing Workloads"
author: "Michael John Peña"
draft: false
date: 2021-08-21
tags: ["Azure", "HPC", "Cache", "High Performance Computing", "Storage"]

---

I wrote "Azure HPC Cache: Accelerating High-Performance Computing Workloads" to share practical, production-minded guidance on this topic.

## Understanding HPC Cache Architecture

HPC Cache sits between your compute nodes and storage backends, providing:
- Sub-millisecond latency for cached reads
- Aggregated throughput across multiple storage targets
- Support for NFS and Azure Blob storage backends

## Creating an HPC Cache

```bash
# Register the HPC Cache resource provider
az provider register --namespace Microsoft.StorageCache

# Create HPC Cache (requires dedicated subnet)
az hpc-cache create \
    --resource-group myResourceGroup \
    --name myhpccache \
    --location eastus \
    --cache-size-gb 3072 \
    --subnet /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/virtualNetworks/myVNet/subnets/hpcsubnet \
    --sku-name Standard_2G

# Available SKUs:
# - Standard_2G: 3-21 TB, 2 GB/s throughput
# - Standard_4G: 6-42 TB, 4 GB/s throughput
# - Standard_8G: 12-84 TB, 8 GB/s throughput
```

Using Terraform:

```hcl
resource "azurerm_hpc_cache" "main" {
  name                = "myhpccache"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  cache_size_in_gb    = 3072
  subnet_id           = azurerm_subnet.hpc.id
  sku_name            = "Standard_2G"

  default_access_policy {
    name = "default"

    access_rule {
      scope  = "default"
      access = "rw"
    }
  }
}
```

## Adding Storage Targets

### NFS Storage Target

```bash
# Add on-premises NFS storage target
az hpc-cache nfs-storage-target add \
    --resource-group myResourceGroup \
    --cache-name myhpccache \
    --name onprem-nfs \
    --nfs3-target 10.0.0.50 \
    --nfs3-usage-model WRITE_WORKLOAD_15 \
    --junction namespace-path=/onprem target-path=/exports/data
```

### Blob Storage Target

```bash
# Add Azure Blob storage target
az hpc-cache blob-storage-target add \
    --resource-group myResourceGroup \
    --cache-name myhpccache \
    --name blob-target \
    --storage-account /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/mystorageaccount \
    --container-name hpcdata \
    --virtual-namespace-path /blob
```

## Usage Models Explained

```python
# Python - Understanding HPC Cache usage models
"""
Usage models optimize caching behavior for different workloads:

READ_HEAVY_INFREQ_WRITES:
- Read-heavy workloads with infrequent writes
- Data rarely changes at source
- Best for: Reference data, media assets

READ_HEAVY_CHECK_180:
- Read-heavy with verification every 180 seconds
- Balance between freshness and performance
- Best for: Collaborative workflows

WRITE_WORKLOAD_15:
- Write-intensive workloads
- Changes sync to backend every 15 minutes
- Best for: Active development, rendering

WRITE_AROUND:
- Writes go directly to backend, bypassing cache
- Cache only serves reads
- Best for: Workloads where write speed doesn't matter
"""

USAGE_MODELS = {
    'READ_HEAVY_INFREQ_WRITES': {
        'description': 'Read-heavy, infrequent writes',
        'write_back_timer': 'Never',
        'verification_timer': 'Never',
        'use_case': 'Reference data, media assets'
    },
    'READ_HEAVY_CHECK_180': {
        'description': 'Read-heavy with 180s verification',
        'write_back_timer': '180 seconds',
        'verification_timer': '180 seconds',
        'use_case': 'Collaborative workflows'
    },
    'WRITE_WORKLOAD_15': {
        'description': 'Write-intensive, 15min sync',
        'write_back_timer': '15 minutes',
        'verification_timer': '30 seconds',
        'use_case': 'Rendering, development'
    },
    'WRITE_AROUND': {
        'description': 'Direct writes to backend',
        'write_back_timer': 'Immediate',
        'verification_timer': '30 seconds',
        'use_case': 'Write-speed agnostic workloads'
    }
}
```

## Mounting HPC Cache from Compute Nodes

```bash
# Get mount instructions
MOUNT_ADDRESSES=$(az hpc-cache show \
    --resource-group myResourceGroup \
    --name myhpccache \
    --query "mountAddresses" -o tsv)

# Mount with optimal settings for HPC
sudo mkdir -p /mnt/hpccache

# Use first available mount address
MOUNT_IP=$(echo $MOUNT_ADDRESSES | cut -d' ' -f1)

sudo mount -t nfs -o hard,proto=tcp,mountproto=tcp,retry=30 \
    $MOUNT_IP:/onprem /mnt/hpccache/onprem

sudo mount -t nfs -o hard,proto=tcp,mountproto=tcp,retry=30 \
    $MOUNT_IP:/blob /mnt/hpccache/blob
```

## Integration with Azure Batch

```csharp
// C# - Azure Batch pool with HPC Cache mount
using Microsoft.Azure.Batch;

public class HPCBatchIntegration
{
    private readonly BatchClient _batchClient;

    public async Task CreatePoolWithHPCCacheAsync(
        string poolId,
        string[] hpcCacheMountAddresses,
        string namespacePath)
    {
        var pool = _batchClient.PoolOperations.CreatePool(
            poolId: poolId,
            virtualMachineSize: "Standard_HB120rs_v2", // HPC optimized
            cloudServiceConfiguration: null,
            virtualMachineConfiguration: new VirtualMachineConfiguration(
                new ImageReference(
                    publisher: "OpenLogic",
                    offer: "CentOS-HPC",
                    sku: "7.7",
                    version: "latest"),
                nodeAgentSkuId: "batch.node.centos 7"));

        // Configure NFS mount
        pool.MountConfiguration = new List<MountConfiguration>
        {
            new MountConfiguration(
                nfsMountConfiguration: new NFSMountConfiguration(
                    source: $"{hpcCacheMountAddresses[0]}:{namespacePath}",
                    relativeMountPath: "hpccache",
                    mountOptions: "-o hard,proto=tcp,mountproto=tcp"))
        };

        pool.TargetDedicatedComputeNodes = 10;

        await pool.CommitAsync();
    }

    public CloudTask CreateHPCTask(string taskId, string commandLine)
    {
        var task = new CloudTask(taskId, commandLine)
        {
            // Task can now access /mnt/batch/tasks/fsmounts/hpccache
        };

        return task;
    }
}
```

## Monitoring HPC Cache Performance

```python
# Python - Monitor HPC Cache metrics
from azure.mgmt.monitor import MonitorManagementClient
from azure.identity import DefaultAzureCredential

class HPCCacheMonitor:
    def __init__(self, subscription_id):
        self.credential = DefaultAzureCredential()
        self.monitor = MonitorManagementClient(
            self.credential, subscription_id
        )

    def get_cache_metrics(self, cache_resource_id, hours=24):
        """Get comprehensive cache metrics"""
        from datetime import datetime, timedelta

        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)

        metrics = self.monitor.metrics.list(
            cache_resource_id,
            timespan=f"{start_time.isoformat()}/{end_time.isoformat()}",
            interval='PT1H',
            metricnames='ClientIOPS,ClientLatency,ClientReadThroughput,ClientWriteThroughput,StorageTargetLatency,StorageTargetIOPS',
            aggregation='Average,Maximum'
        )

        results = {}
        for metric in metrics.value:
            metric_values = []
            for ts in metric.timeseries:
                for data in ts.data:
                    metric_values.append({
                        'time': data.time_stamp,
                        'average': data.average,
                        'maximum': data.maximum
                    })
            results[metric.name.value] = metric_values

        return results

    def calculate_cache_hit_rate(self, cache_resource_id):
        """Calculate cache hit rate from metrics"""
        metrics = self.get_cache_metrics(cache_resource_id, hours=1)

        # Cache hit rate = Client IOPS / Storage Target IOPS
        client_iops = metrics.get('ClientIOPS', [])
        storage_iops = metrics.get('StorageTargetIOPS', [])

        if client_iops and storage_iops:
            avg_client = sum(m['average'] or 0 for m in client_iops) / len(client_iops)
            avg_storage = sum(m['average'] or 0 for m in storage_iops) / len(storage_iops)

            if avg_client > 0:
                hit_rate = 1 - (avg_storage / avg_client)
                return max(0, min(1, hit_rate))

        return None
```

## Best Practices

1. **Size cache appropriately**: Larger cache = better hit rate
2. **Choose correct usage model**: Match to workload characteristics
3. **Use dedicated subnet**: /24 minimum for HPC Cache
4. **Distribute load**: Use multiple mount addresses
5. **Monitor cache efficiency**: Track hit rates and latency

Azure HPC Cache bridges the gap between cloud compute and existing storage investments, enabling organizations to run HPC workloads in Azure while leveraging their existing data infrastructure.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
