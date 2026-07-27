---
title: "Databricks Cluster Policies for Governance and Cost Control"
author: "Michael John Peña"
draft: false
date: 2021-10-25
tags: ["Azure", "Databricks", "Governance", "Cost Management", "Policies"]

---

I wrote "Databricks Cluster Policies for Governance and Cost Control" to share practical, production-minded guidance on this topic.

Databricks cluster policies are the governance layer that prevents the classic enterprise data platform problem: data scientists spinning up 64-node GPU clusters for a five-minute notebook experiment, discovering the issue when the invoice arrives. A cluster policy is an admin-defined template that specifies which cluster configuration fields are fixed, which are bounded (min/max values), and which are unrestricted—users creating clusters through that policy can only configure within the allowed ranges. The cost control pattern: a `default-interactive` policy with max 4 workers and autoscale disabled (forces use of the minimum reasonable cluster for interactive work); a `large-batch` policy with max 16 workers, single user access mode, and autotermination after 30 minutes of inactivity. Library installation policies prevent users from installing untested packages that could destabilise shared clusters.

## Understanding Cluster Policies

Cluster policies:
- Define allowed cluster configurations
- Restrict node types and sizes
- Enforce tagging requirements
- Set default values
- Limit maximum cluster sizes

## Creating Basic Policies

### Simple Cost Control Policy

```json
{
  "cluster_type": {
    "type": "fixed",
    "value": "all-purpose"
  },
  "autotermination_minutes": {
    "type": "range",
    "minValue": 10,
    "maxValue": 120,
    "defaultValue": 30
  },
  "node_type_id": {
    "type": "allowlist",
    "values": [
      "Standard_DS3_v2",
      "Standard_DS4_v2",
      "Standard_DS5_v2"
    ],
    "defaultValue": "Standard_DS3_v2"
  },
  "num_workers": {
    "type": "range",
    "minValue": 1,
    "maxValue": 10,
    "defaultValue": 2
  }
}
```

### Autoscaling Policy

```json
{
  "spark_version": {
    "type": "regex",
    "pattern": "9\\.[0-9]+\\.x-scala2\\.12"
  },
  "autoscale.min_workers": {
    "type": "range",
    "minValue": 1,
    "maxValue": 5,
    "defaultValue": 2
  },
  "autoscale.max_workers": {
    "type": "range",
    "minValue": 2,
    "maxValue": 20,
    "defaultValue": 10
  },
  "autotermination_minutes": {
    "type": "fixed",
    "value": 30
  }
}
```

## Policy Attribute Types

### Fixed Values

```json
{
  "spark_version": {
    "type": "fixed",
    "value": "9.1.x-scala2.12",
    "hidden": true
  }
}
```

### Range Constraints

```json
{
  "num_workers": {
    "type": "range",
    "minValue": 1,
    "maxValue": 50,
    "defaultValue": 4
  }
}
```

### Allowlist

```json
{
  "node_type_id": {
    "type": "allowlist",
    "values": [
      "Standard_DS3_v2",
      "Standard_DS4_v2",
      "Standard_E4s_v3",
      "Standard_E8s_v3"
    ],
    "defaultValue": "Standard_DS3_v2"
  }
}
```

### Blocklist

```json
{
  "node_type_id": {
    "type": "blocklist",
    "values": [
      "Standard_NC6",
      "Standard_NC12",
      "Standard_NC24"
    ]
  }
}
```

### Regex Pattern

```json
{
  "spark_version": {
    "type": "regex",
    "pattern": "(9|10)\\.[0-9]+\\.x-.*"
  }
}
```

## Enterprise Policy Examples

### Development Team Policy

```json
{
  "cluster_type": {
    "type": "fixed",
    "value": "all-purpose"
  },
  "spark_version": {
    "type": "regex",
    "pattern": "9\\.[0-9]+\\.x-scala2\\.12"
  },
  "node_type_id": {
    "type": "allowlist",
    "values": [
      "Standard_DS3_v2",
      "Standard_DS4_v2"
    ],
    "defaultValue": "Standard_DS3_v2"
  },
  "num_workers": {
    "type": "range",
    "minValue": 1,
    "maxValue": 4,
    "defaultValue": 2
  },
  "autotermination_minutes": {
    "type": "range",
    "minValue": 10,
    "maxValue": 60,
    "defaultValue": 30
  },
  "custom_tags.Environment": {
    "type": "fixed",
    "value": "Development"
  },
  "custom_tags.Team": {
    "type": "fixed",
    "value": "DataEngineering"
  }
}
```

### Production ETL Policy

```json
{
  "cluster_type": {
    "type": "fixed",
    "value": "job"
  },
  "spark_version": {
    "type": "fixed",
    "value": "9.1.x-scala2.12",
    "hidden": true
  },
  "node_type_id": {
    "type": "allowlist",
    "values": [
      "Standard_E8s_v3",
      "Standard_E16s_v3"
    ]
  },
  "autoscale.min_workers": {
    "type": "range",
    "minValue": 2,
    "maxValue": 10,
    "defaultValue": 4
  },
  "autoscale.max_workers": {
    "type": "range",
    "minValue": 4,
    "maxValue": 50,
    "defaultValue": 20
  },
  "custom_tags.Environment": {
    "type": "fixed",
    "value": "Production"
  },
  "spark_conf.spark.databricks.delta.optimizeWrite.enabled": {
    "type": "fixed",
    "value": "true",
    "hidden": true
  },
  "spark_conf.spark.databricks.delta.autoCompact.enabled": {
    "type": "fixed",
    "value": "true",
    "hidden": true
  }
}
```

### Data Science Policy (with GPU)

```json
{
  "cluster_type": {
    "type": "fixed",
    "value": "all-purpose"
  },
  "spark_version": {
    "type": "regex",
    "pattern": "9\\.[0-9]+\\.x-gpu-ml-scala2\\.12"
  },
  "node_type_id": {
    "type": "allowlist",
    "values": [
      "Standard_NC6s_v3",
      "Standard_NC12s_v3"
    ],
    "defaultValue": "Standard_NC6s_v3"
  },
  "num_workers": {
    "type": "range",
    "minValue": 1,
    "maxValue": 4,
    "defaultValue": 1
  },
  "autotermination_minutes": {
    "type": "fixed",
    "value": 60
  },
  "custom_tags.UseCase": {
    "type": "fixed",
    "value": "MachineLearning"
  }
}
```

## Mandatory Tags Policy

```json
{
  "custom_tags.CostCenter": {
    "type": "regex",
    "pattern": "[A-Z]{2}-[0-9]{3}",
    "isOptional": false
  },
  "custom_tags.Project": {
    "type": "unlimited",
    "isOptional": false
  },
  "custom_tags.Owner": {
    "type": "unlimited",
    "isOptional": false
  }
}
```

## Instance Pool Policy

```json
{
  "instance_pool_id": {
    "type": "fixed",
    "value": "pool-XXXXXXXXXXXXX",
    "hidden": true
  },
  "driver_instance_pool_id": {
    "type": "fixed",
    "value": "pool-XXXXXXXXXXXXX",
    "hidden": true
  },
  "autoscale.min_workers": {
    "type": "range",
    "minValue": 2,
    "maxValue": 10
  },
  "autoscale.max_workers": {
    "type": "range",
    "minValue": 4,
    "maxValue": 30
  }
}
```

## Creating Policies via API

```python
import requests
import json

# Create policy via REST API
def create_cluster_policy(workspace_url, token, policy_name, definition):
    url = f"{workspace_url}/api/2.0/policies/clusters/create"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "name": policy_name,
        "definition": json.dumps(definition)
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()

# Example usage
policy_definition = {
    "node_type_id": {
        "type": "allowlist",
        "values": ["Standard_DS3_v2", "Standard_DS4_v2"]
    },
    "num_workers": {
        "type": "range",
        "minValue": 1,
        "maxValue": 10
    },
    "autotermination_minutes": {
        "type": "fixed",
        "value": 30
    }
}

result = create_cluster_policy(
    "https://adb-123456789.0.azuredatabricks.net",
    "dapi123...",
    "Cost Controlled Policy",
    policy_definition
)
```

## Terraform Configuration

```hcl
resource "databricks_cluster_policy" "development" {
  name = "Development Policy"

  definition = jsonencode({
    "cluster_type" : {
      "type" : "fixed",
      "value" : "all-purpose"
    },
    "node_type_id" : {
      "type" : "allowlist",
      "values" : [
        "Standard_DS3_v2",
        "Standard_DS4_v2"
      ],
      "defaultValue" : "Standard_DS3_v2"
    },
    "num_workers" : {
      "type" : "range",
      "minValue" : 1,
      "maxValue" : 4,
      "defaultValue" : 2
    },
    "autotermination_minutes" : {
      "type" : "fixed",
      "value" : 30
    },
    "custom_tags.Environment" : {
      "type" : "fixed",
      "value" : "Development"
    }
  })
}

# Assign policy to group
resource "databricks_permissions" "policy_usage" {
  cluster_policy_id = databricks_cluster_policy.development.id

  access_control {
    group_name       = "developers"
    permission_level = "CAN_USE"
  }
}
```

## Policy Assignment

### Assign to Users/Groups

```python
# Assign policy permissions
def set_policy_permissions(workspace_url, token, policy_id, permissions):
    url = f"{workspace_url}/api/2.0/permissions/cluster-policies/{policy_id}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    response = requests.put(url, headers=headers, json=permissions)
    return response.json()

permissions = {
    "access_control_list": [
        {
            "group_name": "data-engineers",
            "permission_level": "CAN_USE"
        },
        {
            "group_name": "admins",
            "permission_level": "CAN_MANAGE"
        }
    ]
}
```

## Monitoring Policy Compliance

```python
# Check cluster compliance
def get_clusters_by_policy(workspace_url, token, policy_id):
    url = f"{workspace_url}/api/2.0/clusters/list"
    headers = {"Authorization": f"Bearer {token}"}

    response = requests.get(url, headers=headers)
    clusters = response.json().get("clusters", [])

    compliant = [c for c in clusters if c.get("policy_id") == policy_id]
    non_compliant = [c for c in clusters if c.get("policy_id") != policy_id]

    return {
        "compliant": compliant,
        "non_compliant": non_compliant
    }
```

## Best Practices

1. **Start restrictive** - Begin with tight policies and loosen as needed
2. **Use default values** - Guide users to optimal configurations
3. **Hide unnecessary options** - Reduce complexity for users
4. **Require tags** - Enable cost tracking and governance
5. **Version control policies** - Store definitions in source control
6. **Audit regularly** - Review clusters against policies
7. **Document policies** - Explain the rationale for restrictions

## Conclusion

Cluster policies are essential for governing Databricks usage at scale. By implementing appropriate policies, you can control costs, enforce standards, and simplify the user experience while maintaining flexibility for different workload types.

Tomorrow, we'll compare job clusters vs all-purpose clusters for different use cases.

