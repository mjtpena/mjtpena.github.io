---
title: ADLS Gen2 Access Control with ACLs - Fine-Grained Security
description: "Both work together - a user needs both RBAC permission to access the storage account AND appropriate ACL permissions on the specific path."
author: Michael John Peña
draft: false
date: 2021-04-14
url: /blog/adls-gen2-access-control-acls/
tags:
  - Azure
  - Data Lake
  - Security
  - ACLs
  - Access Control
---

## Understanding ADLS Gen2 Access Control

ADLS Gen2 has two layers of access control:

1. **RBAC (Role-Based Access Control)** - Coarse-grained, applies to entire storage account or container
2. **ACLs (Access Control Lists)** - Fine-grained, applies to individual files and directories

Both work together - a user needs both RBAC permission to access the storage account AND appropriate ACL permissions on the specific path.

## ACL Basics

### Permission Types

```
r - Read    (4) - List contents (directories) or read data (files)
w - Write   (2) - Create/delete children (directories) or write data (files)
x - Execute (1) - Traverse (directories) or execute (files)
```

### ACL Types

```
Access ACL    - Controls access to the object itself
Default ACL   - Template for new child objects (directories only)
```

## Setting Up ACLs

### Using Azure CLI

```bash
# Set ACL for a directory
az storage fs access set \
    --acl "user::rwx,group::r-x,other::---,user:user1-object-id:rwx" \
    --path "raw/sales" \
    --file-system raw \
    --account-name mydatalake

# Set default ACL (for inheritance)
az storage fs access set \
    --acl "default:user::rwx,default:group::r-x,default:other::---,default:user:user1-object-id:rwx" \
    --path "raw/sales" \
    --file-system raw \
    --account-name mydatalake

# Get current ACL
az storage fs access show \
    --path "raw/sales" \
    --file-system raw \
    --account-name mydatalake

# Recursively set ACL
az storage fs access set-recursive \
    --acl "user:user1-object-id:rwx" \
    --path "raw/sales" \
    --file-system raw \
    --account-name mydatalake
```

### Using Python

```python
from azure.storage.filedatalake import DataLakeServiceClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
service_client = DataLakeServiceClient(
    account_url="https://mydatalake.dfs.core.windows.net",
    credential=credential
)

file_system_client = service_client.get_file_system_client("raw")
directory_client = file_system_client.get_directory_client("sales")

# Get current ACL
acl = directory_client.get_access_control()
print(f"Current ACL: {acl['acl']}")
print(f"Owner: {acl['owner']}")
print(f"Group: {acl['group']}")

# Set access ACL
acl_spec = "user::rwx,group::r-x,other::---,user:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:rwx"
directory_client.set_access_control(acl=acl_spec)

# Set default ACL for inheritance
default_acl = "default:user::rwx,default:group::r-x,default:other::---"
directory_client.set_access_control(acl=f"{acl_spec},{default_acl}")

# Update specific ACE (Access Control Entry)
directory_client.update_access_control(acl="user:new-user-id:r-x")

# Remove specific ACE
directory_client.update_access_control(acl="user:user-to-remove:")
```

### Recursive ACL Operations

```python
def set_acl_recursive(file_system_client, path, acl_spec, batch_size=2000):
    """Set ACL recursively with continuation support"""
    directory_client = file_system_client.get_directory_client(path)

    continuation = None
    total_success = 0
    total_failure = 0

    while True:
        result = directory_client.set_access_control_recursive(
            acl=acl_spec,
            continuation=continuation,
            batch_size=batch_size
        )

        total_success += result.counters.directories_successful + result.counters.files_successful
        total_failure += result.counters.failure_count

        if result.continuation is None:
            break
        continuation = result.continuation

        print(f"Progress: {total_success} succeeded, {total_failure} failed")

    print(f"Completed: {total_success} succeeded, {total_failure} failed")
    return total_success, total_failure


# Update ACL recursively (preserves existing ACEs)
def update_acl_recursive(file_system_client, path, acl_spec):
    directory_client = file_system_client.get_directory_client(path)

    result = directory_client.update_access_control_recursive(acl=acl_spec)
    return result.counters


# Remove ACE recursively
def remove_acl_recursive(file_system_client, path, acl_spec):
    """Remove specific ACE from path recursively
    acl_spec format for removal: user:user-id (no permissions)
    """
    directory_client = file_system_client.get_directory_client(path)

    result = directory_client.remove_access_control_recursive(acl=acl_spec)
    return result.counters
```

## ACL Design Patterns

### Team-Based Access Pattern

```
raw/
├── sales/          # Sales team: rwx, Analytics team: r-x
├── marketing/      # Marketing team: rwx, Analytics team: r-x
├── finance/        # Finance team: rwx (restricted)
└── shared/         # All teams: r-x

curated/
├── sales_data/     # Analytics team: rwx, Sales team: r--
├── marketing_data/ # Analytics team: rwx, Marketing team: r--
└── cross_domain/   # Analytics team: rwx, All teams: r--
```

Implementation:

```python
from dataclasses import dataclass
from typing import List

@dataclass
class TeamPermission:
    team_id: str
    team_name: str
    permission: str

def configure_team_permissions(file_system_client, path: str, permissions: List[TeamPermission]):
    """Configure ACLs for team-based access"""

    # Build ACL string
    acl_entries = ["user::rwx", "group::r-x", "other::---"]

    for perm in permissions:
        acl_entries.append(f"group:{perm.team_id}:{perm.permission}")

    # Add default ACL for inheritance
    default_entries = [f"default:{entry}" for entry in acl_entries]

    full_acl = ",".join(acl_entries + default_entries)

    directory_client = file_system_client.get_directory_client(path)
    directory_client.set_access_control(acl=full_acl)

    print(f"Set ACL for {path}: {full_acl}")


# Example usage
sales_team_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
analytics_team_id = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"

permissions = [
    TeamPermission(sales_team_id, "Sales", "rwx"),
    TeamPermission(analytics_team_id, "Analytics", "r-x")
]

configure_team_permissions(file_system_client, "raw/sales", permissions)
```

### Data Zone Pattern

```python
def setup_data_lake_zones(file_system_client, config):
    """Set up standard data lake zones with appropriate permissions"""

    zones = {
        "landing": {
            "description": "Temporary landing zone for ingestion",
            "permissions": {
                "data_engineers": "rwx",
                "etl_service": "rwx"
            }
        },
        "raw": {
            "description": "Immutable raw data",
            "permissions": {
                "data_engineers": "rwx",
                "data_scientists": "r-x",
                "analysts": "r--"
            }
        },
        "curated": {
            "description": "Cleansed and validated data",
            "permissions": {
                "data_engineers": "rwx",
                "data_scientists": "rwx",
                "analysts": "r-x"
            }
        },
        "analytics": {
            "description": "Business-ready datasets",
            "permissions": {
                "data_engineers": "rwx",
                "data_scientists": "r-x",
                "analysts": "r-x",
                "business_users": "r--"
            }
        }
    }

    for zone_name, zone_config in zones.items():
        # Create directory if not exists
        try:
            dir_client = file_system_client.create_directory(zone_name)
        except Exception:
            dir_client = file_system_client.get_directory_client(zone_name)

        # Build ACL
        acl_entries = ["user::rwx", "group::---", "other::---"]

        for role, permission in zone_config["permissions"].items():
            role_id = config["roles"][role]
            acl_entries.append(f"group:{role_id}:{permission}")

        # Set both access and default ACL
        default_entries = [f"default:{e}" for e in acl_entries]
        full_acl = ",".join(acl_entries + default_entries)

        dir_client.set_access_control(acl=full_acl)
        print(f"Configured zone: {zone_name}")
```

### Project-Based Isolation

```python
def create_project_space(file_system_client, project_name, project_owner_id, team_members):
    """Create isolated project space with proper ACLs"""

    project_path = f"projects/{project_name}"

    # Create directory structure
    directories = [
        project_path,
        f"{project_path}/data",
        f"{project_path}/notebooks",
        f"{project_path}/models",
        f"{project_path}/outputs"
    ]

    for dir_path in directories:
        try:
            dir_client = file_system_client.create_directory(dir_path)
        except:
            dir_client = file_system_client.get_directory_client(dir_path)

    # Set ACL - owner has full access, team has read-write
    project_dir = file_system_client.get_directory_client(project_path)

    acl_entries = [
        "user::rwx",
        "group::---",
        "other::---",
        f"user:{project_owner_id}:rwx"
    ]

    for member_id in team_members:
        acl_entries.append(f"user:{member_id}:rwx")

    default_entries = [f"default:{e}" for e in acl_entries]
    full_acl = ",".join(acl_entries + default_entries)

    # Set recursively
    project_dir.set_access_control_recursive(acl=full_acl)

    return project_path
```

## Combining RBAC and ACLs

### RBAC Roles for ADLS Gen2

```bash
# Storage Blob Data Owner - Full access including ACL management
az role assignment create \
    --role "Storage Blob Data Owner" \
    --assignee-object-id $DATA_ADMIN_ID \
    --scope "/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT"

# Storage Blob Data Contributor - Read/Write, no ACL management
az role assignment create \
    --role "Storage Blob Data Contributor" \
    --assignee-object-id $DATA_ENGINEER_ID \
    --scope "/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT/blobServices/default/containers/curated"

# Storage Blob Data Reader - Read only
az role assignment create \
    --role "Storage Blob Data Reader" \
    --assignee-object-id $ANALYST_ID \
    --scope "/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT/blobServices/default/containers/analytics"
```

### Access Decision Flow

```
User requests access to /raw/sales/2021/data.parquet

1. Check RBAC at storage account level
   → User has "Storage Blob Data Reader" on account? Continue : Denied

2. Check RBAC at container level
   → User has role on "raw" container? Use that : Use account-level role

3. Evaluate ACL on /raw
   → Has execute (x) permission? Continue : Denied

4. Evaluate ACL on /raw/sales
   → Has execute (x) permission? Continue : Denied

5. Evaluate ACL on /raw/sales/2021
   → Has execute (x) permission? Continue : Denied

6. Evaluate ACL on /raw/sales/2021/data.parquet
   → Has read (r) permission? Allow : Denied
```

## Auditing and Compliance

### Enable Diagnostic Logging

```bash
az monitor diagnostic-settings create \
    --name datalake-access-logs \
    --resource $STORAGE_ACCOUNT_ID \
    --logs '[
        {"category": "StorageRead", "enabled": true},
        {"category": "StorageWrite", "enabled": true},
        {"category": "StorageDelete", "enabled": true}
    ]' \
    --workspace $LOG_ANALYTICS_WORKSPACE_ID
```

### Query Access Logs

```kusto
// Access denied events
StorageBlobLogs
| where TimeGenerated > ago(24h)
| where StatusCode == 403
| project TimeGenerated, CallerIpAddress, UserAgentHeader, Uri, StatusText
| order by TimeGenerated desc

// ACL modifications
StorageBlobLogs
| where TimeGenerated > ago(7d)
| where OperationName in ("SetAccessControl", "SetAccessControlRecursive")
| project TimeGenerated, CallerIpAddress, Uri, StatusCode
| order by TimeGenerated desc

// Access patterns by user
StorageBlobLogs
| where TimeGenerated > ago(7d)
| summarize
    ReadCount = countif(OperationName == "GetBlob"),
    WriteCount = countif(OperationName == "PutBlob"),
    DeleteCount = countif(OperationName == "DeleteBlob")
    by AuthenticationType, RequesterObjectId
| order by ReadCount desc
```

## Best Practices

1. **Use groups over individual users** - Easier to manage at scale
2. **Set default ACLs on directories** - Ensure consistent inheritance
3. **Minimize "other" permissions** - Default to no access
4. **Combine RBAC with ACLs** - RBAC for coarse control, ACLs for fine-grained
5. **Regular access reviews** - Audit and clean up stale permissions
6. **Document your ACL strategy** - Maintain clear ownership
7. **Use automation** - Script ACL management for consistency

## Common Pitfalls

1. **Forgetting execute on parent directories** - Need x on all ancestors
2. **Not setting default ACLs** - New files won't inherit permissions
3. **Over-permissive "other"** - Can expose data unintentionally
4. **Mixing approaches inconsistently** - Stick to a clear pattern
5. **Not considering service principals** - ETL jobs need access too

## Conclusion

ADLS Gen2 ACLs provide the fine-grained access control needed for enterprise data lakes. By combining RBAC for broad access with ACLs for path-specific permissions, you can implement sophisticated security models that meet compliance requirements while enabling productive data access. The key is planning your ACL strategy upfront and automating its implementation for consistency.
