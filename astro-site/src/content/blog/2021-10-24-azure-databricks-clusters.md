---
title: "Azure Databricks Cluster Configuration Best Practices"
description: "Azure Databricks cluster configuration is where cost and performance trade-offs become very concrete: the wrong cluster type for a workload is either money…"
author: "Michael John Peña"
draft: false
date: 2021-10-24
tags: ["Azure", "Databricks", "Spark", "Cluster Management", "Big Data"]
---

Azure Databricks cluster configuration is where cost and performance trade-offs become very concrete: the wrong cluster type for a workload is either money wasted (an oversized all-purpose cluster running a scheduled job) or time wasted (an undersized cluster that makes interactive development painful). The cluster runtime version determines the Spark version, library compatibility, and which Databricks Runtime features are available—staying one or two versions behind LTS releases is the safe production approach. Worker node count and VM SKU determine throughput; the autoscale feature adjusts worker count based on job backlog and active tasks. Memory-optimised VMs (E-series) suit wide shuffles and joins; compute-optimised VMs (F-series) suit CPU-bound transformations; GPU VMs are necessary for deep learning training. Getting the combination right before scaling a job to petabyte data volumes saves significant cost.

## Cluster Types

### All-Purpose Clusters

Interactive, shared clusters for development and exploration:

```python
# Cluster configuration via API
cluster_config = {
    "cluster_name": "dev-cluster",
    "spark_version": "9.1.x-scala2.12",
    "node_type_id": "Standard_DS3_v2",
    "num_workers": 4,
    "autotermination_minutes": 60,
    "enable_elastic_disk": True,
    "spark_conf": {
        "spark.speculation": "true"
    }
}
```

### Job Clusters

Ephemeral clusters for automated workloads:

```json
{
  "new_cluster": {
    "spark_version": "9.1.x-scala2.12",
    "node_type_id": "Standard_DS3_v2",
    "num_workers": 8,
    "spark_conf": {
      "spark.databricks.cluster.profile": "serverless"
    }
  }
}
```

## Node Selection

### Worker Node Types

Choose based on workload characteristics:

```python
# Memory-optimized for data-intensive workloads
memory_optimized = {
    "node_type_id": "Standard_E8s_v3",  # 8 cores, 64 GB RAM
    "num_workers": 4
}

# Compute-optimized for CPU-intensive workloads
compute_optimized = {
    "node_type_id": "Standard_F8s_v2",  # 8 cores, 16 GB RAM
    "num_workers": 8
}

# GPU-enabled for ML training
gpu_enabled = {
    "node_type_id": "Standard_NC6s_v3",  # 6 cores, 112 GB RAM, 1 GPU
    "num_workers": 2
}
```

### Driver Node Configuration

```python
# Use larger driver for complex workloads
cluster_config = {
    "driver_node_type_id": "Standard_DS4_v2",  # Larger driver
    "node_type_id": "Standard_DS3_v2",         # Regular workers
    "num_workers": 8
}
```

## Autoscaling

### Enable Autoscaling

```python
autoscaling_config = {
    "cluster_name": "autoscaling-cluster",
    "spark_version": "9.1.x-scala2.12",
    "node_type_id": "Standard_DS3_v2",
    "autoscale": {
        "min_workers": 2,
        "max_workers": 20
    },
    "autotermination_minutes": 30
}
```

### Optimized Autoscaling

```python
# Enable optimized autoscaling for faster scaling
optimized_autoscaling = {
    "autoscale": {
        "min_workers": 2,
        "max_workers": 20
    },
    "spark_conf": {
        "spark.databricks.cluster.profile": "serverless",
        "spark.databricks.delta.preview.enabled": "true"
    },
    "cluster_source": "UI"
}
```

## Spark Configuration

### Memory Configuration

```python
spark_memory_config = {
    "spark_conf": {
        "spark.executor.memory": "8g",
        "spark.driver.memory": "4g",
        "spark.executor.memoryOverhead": "2g",
        "spark.memory.fraction": "0.8",
        "spark.memory.storageFraction": "0.3"
    }
}
```

### Performance Optimization

```python
performance_config = {
    "spark_conf": {
        # Adaptive Query Execution
        "spark.sql.adaptive.enabled": "true",
        "spark.sql.adaptive.coalescePartitions.enabled": "true",
        "spark.sql.adaptive.skewJoin.enabled": "true",

        # Shuffle optimization
        "spark.sql.shuffle.partitions": "auto",
        "spark.databricks.io.cache.enabled": "true",

        # Delta optimization
        "spark.databricks.delta.optimizeWrite.enabled": "true",
        "spark.databricks.delta.autoCompact.enabled": "true"
    }
}
```

### Dynamic Allocation

```python
dynamic_allocation = {
    "spark_conf": {
        "spark.dynamicAllocation.enabled": "true",
        "spark.dynamicAllocation.minExecutors": "2",
        "spark.dynamicAllocation.maxExecutors": "20",
        "spark.dynamicAllocation.executorIdleTimeout": "60s"
    }
}
```

## Instance Pools

Pre-allocate instances for faster cluster startup:

```python
# Create instance pool
pool_config = {
    "instance_pool_name": "data-engineering-pool",
    "node_type_id": "Standard_DS3_v2",
    "min_idle_instances": 2,
    "max_capacity": 20,
    "idle_instance_autotermination_minutes": 30,
    "preloaded_spark_versions": ["9.1.x-scala2.12"]
}

# Use pool in cluster
cluster_with_pool = {
    "cluster_name": "pooled-cluster",
    "instance_pool_id": "pool-123456",
    "num_workers": 4
}
```

## Cluster Tags

Add tags for cost tracking and management:

```python
tagged_cluster = {
    "cluster_name": "production-etl",
    "custom_tags": {
        "Environment": "Production",
        "Team": "DataEngineering",
        "CostCenter": "DE-001",
        "Project": "DataPlatform"
    }
}
```

## Init Scripts

Run initialization scripts on cluster startup:

```python
# Global init script (workspace level)
init_script_config = {
    "init_scripts": [
        {
            "workspace": {
                "destination": "/Shared/init-scripts/install-packages.sh"
            }
        }
    ]
}

# Cluster-scoped init script
cluster_init_config = {
    "init_scripts": [
        {
            "dbfs": {
                "destination": "dbfs:/databricks/init-scripts/my-init.sh"
            }
        }
    ]
}
```

### Sample Init Script

```bash
#!/bin/bash
# /dbfs/databricks/init-scripts/install-libs.sh

# Install system packages
apt-get update
apt-get install -y libxml2-dev

# Install Python packages
/databricks/python/bin/pip install azure-identity==1.7.0
/databricks/python/bin/pip install pandas-profiling==3.1.0
```

## Environment Variables

```python
cluster_with_env = {
    "cluster_name": "env-configured-cluster",
    "spark_env_vars": {
        "PYSPARK_PYTHON": "/databricks/python3/bin/python3",
        "ENVIRONMENT": "production",
        "LOG_LEVEL": "INFO"
    }
}
```

## Monitoring Configuration

### Enable Cluster Logging

```python
logging_config = {
    "cluster_log_conf": {
        "dbfs": {
            "destination": "dbfs:/cluster-logs"
        }
    }
}
```

### Ganglia Metrics

```python
# Ganglia metrics are enabled by default
# Access via cluster UI -> Metrics tab
# Or configure to push to Azure Monitor

metrics_config = {
    "spark_conf": {
        "spark.metrics.namespace": "databricks",
        "spark.metrics.conf.*.sink.ganglia.class": "org.apache.spark.metrics.sink.GangliaSink"
    }
}
```

## Security Configuration

### Credential Passthrough

```python
# Enable Azure AD credential passthrough
credential_passthrough = {
    "spark_conf": {
        "spark.databricks.passthrough.enabled": "true"
    },
    "azure_attributes": {
        "first_on_demand": 1,
        "availability": "SPOT_WITH_FALLBACK_AZURE",
        "spot_bid_max_price": -1
    }
}
```

### Network Configuration

```python
# Cluster in VNet
vnet_cluster = {
    "cluster_name": "vnet-cluster",
    "node_type_id": "Standard_DS3_v2",
    "num_workers": 4,
    # VNet is configured at workspace level
}
```

## Terraform Configuration

```hcl
resource "databricks_cluster" "production" {
  cluster_name            = "production-cluster"
  spark_version          = "9.1.x-scala2.12"
  node_type_id           = "Standard_DS3_v2"
  autotermination_minutes = 30

  autoscale {
    min_workers = 2
    max_workers = 10
  }

  spark_conf = {
    "spark.sql.adaptive.enabled"                     = "true"
    "spark.databricks.delta.optimizeWrite.enabled"   = "true"
    "spark.databricks.delta.autoCompact.enabled"     = "true"
  }

  custom_tags = {
    Environment = "Production"
    Team        = "DataEngineering"
  }

  library {
    pypi {
      package = "azure-identity==1.7.0"
    }
  }
}
```

## Best Practices Summary

1. **Right-size nodes** - Match node type to workload characteristics
2. **Use autoscaling** - Enable for variable workloads
3. **Set autotermination** - Prevent idle clusters from running
4. **Use instance pools** - Faster startup for frequently used clusters
5. **Configure Spark properly** - Enable AQE and Delta optimizations
6. **Tag everything** - Enable cost tracking and management
7. **Use job clusters for production** - Ephemeral, reproducible clusters

## Conclusion

Proper cluster configuration balances performance, cost, and reliability. By understanding the various configuration options, you can create clusters optimized for your specific workloads.

Tomorrow, we'll explore cluster policies for governance and standardization.
