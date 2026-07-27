---
title: "Azure Data Lake Storage Gen2: Hierarchical Namespace for Big Data Analytics"
author: "Michael John Peña"
draft: false
date: 2021-08-23
tags: ["Azure", "Data Lake", "ADLS Gen2", "Big Data", "Analytics"]

---

I wrote "Azure Data Lake Storage Gen2: Hierarchical Namespace for Big Data Analytics" to share practical, production-minded guidance on this topic.

## Enabling Hierarchical Namespace

```bash
# Create storage account with HNS enabled
az storage account create \
    --name mydatalakeaccount \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Standard_LRS \
    --kind StorageV2 \
    --enable-hierarchical-namespace true

# HNS cannot be enabled on existing accounts!
# Must be specified at creation time
```

Using Terraform:

```hcl
resource "azurerm_storage_account" "datalake" {
  name                     = "mydatalakeaccount"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
  is_hns_enabled           = true

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }
}

resource "azurerm_storage_data_lake_gen2_filesystem" "main" {
  name               = "analytics"
  storage_account_id = azurerm_storage_account.datalake.id
}
```

## Working with Data Lake Gen2 SDK

```python
# Python - Azure Data Lake Storage Gen2 operations
from azure.storage.filedatalake import DataLakeServiceClient
from azure.identity import DefaultAzureCredential

class DataLakeManager:
    def __init__(self, account_name):
        self.account_url = f"https://{account_name}.dfs.core.windows.net"
        self.credential = DefaultAzureCredential()
        self.service_client = DataLakeServiceClient(
            account_url=self.account_url,
            credential=self.credential
        )

    def create_file_system(self, name, metadata=None):
        """Create a file system (container)"""
        file_system_client = self.service_client.create_file_system(
            file_system=name,
            metadata=metadata or {}
        )
        return file_system_client

    def create_directory(self, file_system, path):
        """Create a directory with all parent directories"""
        fs_client = self.service_client.get_file_system_client(file_system)
        directory_client = fs_client.create_directory(path)
        return directory_client

    def upload_file(self, file_system, remote_path, local_path):
        """Upload a file to Data Lake"""
        fs_client = self.service_client.get_file_system_client(file_system)
        file_client = fs_client.get_file_client(remote_path)

        with open(local_path, 'rb') as f:
            file_client.upload_data(f, overwrite=True)

        return file_client.url

    def upload_large_file(self, file_system, remote_path, local_path,
                          chunk_size=100*1024*1024):
        """Upload large file with chunked upload"""
        fs_client = self.service_client.get_file_system_client(file_system)
        file_client = fs_client.create_file(remote_path)

        with open(local_path, 'rb') as f:
            offset = 0
            while True:
                data = f.read(chunk_size)
                if not data:
                    break

                file_client.append_data(data, offset=offset, length=len(data))
                offset += len(data)

        file_client.flush_data(offset)
        return file_client.url

    def list_paths(self, file_system, path='/', recursive=True):
        """List all paths in a directory"""
        fs_client = self.service_client.get_file_system_client(file_system)
        paths = fs_client.get_paths(path=path, recursive=recursive)

        return [
            {
                'name': p.name,
                'is_directory': p.is_directory,
                'size': p.content_length,
                'last_modified': p.last_modified
            }
            for p in paths
        ]

    def rename_path(self, file_system, old_path, new_path):
        """Rename file or directory (atomic operation with HNS)"""
        fs_client = self.service_client.get_file_system_client(file_system)

        # Get source client
        if '.' in old_path.split('/')[-1]:
            source_client = fs_client.get_file_client(old_path)
        else:
            source_client = fs_client.get_directory_client(old_path)

        # Rename is atomic with HNS
        source_client.rename_file(f"{file_system}/{new_path}")

    def set_access_control(self, file_system, path, acl):
        """Set ACL on file or directory"""
        fs_client = self.service_client.get_file_system_client(file_system)
        path_client = fs_client.get_directory_client(path)

        path_client.set_access_control(acl=acl)
```

## Organizing Data Lake Structure

```python
# Python - Best practice data lake organization
class DataLakeOrganizer:
    def __init__(self, datalake_manager):
        self.manager = datalake_manager

    def create_medallion_architecture(self, file_system):
        """Create Bronze/Silver/Gold medallion structure"""
        structure = [
            # Bronze layer - raw data
            'bronze/sales/orders',
            'bronze/sales/customers',
            'bronze/inventory/products',
            'bronze/inventory/stock',

            # Silver layer - cleansed data
            'silver/sales/orders_clean',
            'silver/sales/customers_clean',
            'silver/inventory/products_clean',

            # Gold layer - aggregated data
            'gold/sales/daily_summary',
            'gold/sales/customer_analytics',
            'gold/inventory/stock_alerts',

            # Supporting directories
            'schemas',
            'checkpoints',
            'temp'
        ]

        for path in structure:
            self.manager.create_directory(file_system, path)

        return structure

    def create_time_partitioned_path(self, file_system, base_path,
                                      year, month, day=None):
        """Create time-partitioned directory structure"""
        if day:
            path = f"{base_path}/year={year}/month={month:02d}/day={day:02d}"
        else:
            path = f"{base_path}/year={year}/month={month:02d}"

        self.manager.create_directory(file_system, path)
        return path

    def organize_by_partition(self, file_system, base_path, partitions):
        """Create partition-based organization"""
        for partition in partitions:
            partition_path = '/'.join(
                f"{k}={v}" for k, v in partition.items()
            )
            full_path = f"{base_path}/{partition_path}"
            self.manager.create_directory(file_system, full_path)
```

## ACL Management

```csharp
// C# - Managing Access Control Lists
using Azure.Storage.Files.DataLake;
using Azure.Storage.Files.DataLake.Models;

public class ACLManager
{
    private readonly DataLakeServiceClient _serviceClient;

    public async Task SetDirectoryACLAsync(
        string fileSystem,
        string path,
        string objectId,
        RolePermissions permissions)
    {
        var fsClient = _serviceClient.GetFileSystemClient(fileSystem);
        var directoryClient = fsClient.GetDirectoryClient(path);

        // Get current ACL
        var accessControl = await directoryClient.GetAccessControlAsync();
        var acl = accessControl.Value.AccessControlList.ToList();

        // Add new ACL entry
        var newEntry = new PathAccessControlItem(
            AccessControlType.User,
            permissions,
            false,
            objectId);

        acl.Add(newEntry);

        await directoryClient.SetAccessControlListAsync(acl);
    }

    public async Task SetRecursiveACLAsync(
        string fileSystem,
        string path,
        IList<PathAccessControlItem> acl)
    {
        var fsClient = _serviceClient.GetFileSystemClient(fileSystem);
        var directoryClient = fsClient.GetDirectoryClient(path);

        // Set ACL recursively on all files and subdirectories
        await directoryClient.SetAccessControlRecursiveAsync(acl);
    }

    public async Task<AccessControlList> GetEffectivePermissionsAsync(
        string fileSystem,
        string path)
    {
        var fsClient = _serviceClient.GetFileSystemClient(fileSystem);
        var directoryClient = fsClient.GetDirectoryClient(path);

        var response = await directoryClient.GetAccessControlAsync();

        return new AccessControlList
        {
            Owner = response.Value.Owner,
            Group = response.Value.Group,
            Permissions = response.Value.Permissions,
            ACL = response.Value.AccessControlList.ToList()
        };
    }
}
```

## Integration with Analytics Services

```python
# Python - Using Data Lake with Spark (Azure Databricks/Synapse)
from pyspark.sql import SparkSession

def configure_spark_for_adls():
    """Configure Spark to access ADLS Gen2"""
    spark = SparkSession.builder \
        .appName("DataLakeAnalytics") \
        .config("spark.hadoop.fs.azure.account.auth.type", "OAuth") \
        .config("spark.hadoop.fs.azure.account.oauth.provider.type",
                "org.apache.hadoop.fs.azurebfs.oauth2.ClientCredsTokenProvider") \
        .config("spark.hadoop.fs.azure.account.oauth2.client.id", "<client-id>") \
        .config("spark.hadoop.fs.azure.account.oauth2.client.secret", "<secret>") \
        .config("spark.hadoop.fs.azure.account.oauth2.client.endpoint",
                "https://login.microsoftonline.com/<tenant-id>/oauth2/token") \
        .getOrCreate()

    return spark

# Read from Data Lake
def read_parquet_from_datalake(spark, account_name, file_system, path):
    """Read parquet files from ADLS Gen2"""
    url = f"abfss://{file_system}@{account_name}.dfs.core.windows.net/{path}"
    return spark.read.parquet(url)

# Write to Data Lake with partitioning
def write_partitioned_data(df, account_name, file_system, path,
                           partition_cols):
    """Write DataFrame with partitioning"""
    url = f"abfss://{file_system}@{account_name}.dfs.core.windows.net/{path}"

    df.write \
        .partitionBy(*partition_cols) \
        .mode("overwrite") \
        .parquet(url)
```

## Best Practices

1. **Enable HNS at creation**: Cannot be enabled later
2. **Use medallion architecture**: Bronze/Silver/Gold layers
3. **Partition wisely**: By date, region, or other common filters
4. **Implement ACLs**: For fine-grained access control
5. **Monitor storage metrics**: Track capacity and transactions

Azure Data Lake Storage Gen2 provides the foundation for modern data analytics, combining the best of blob storage scalability with the directory semantics required for efficient big data processing.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
