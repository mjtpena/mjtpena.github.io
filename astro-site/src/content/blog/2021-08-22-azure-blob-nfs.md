---
title: "Azure Blob NFS: Native NFS 3.0 Access to Blob Storage"
author: "Michael John Peña"
draft: false
date: 2021-08-22
tags: ["Azure", "Blob Storage", "NFS", "Linux", "File Storage"]

---

I wrote "Azure Blob NFS: Native NFS 3.0 Access to Blob Storage" to share practical, production-minded guidance on this topic.

## Enabling NFS 3.0 on Storage Account

```bash
# Create storage account with NFS 3.0 and hierarchical namespace
az storage account create \
    --name mystorageaccount \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Premium_LRS \
    --kind BlockBlobStorage \
    --enable-hierarchical-namespace true \
    --enable-nfs-v3 true \
    --default-action Deny

# NFS 3.0 requires:
# - Premium performance tier (recommended)
# - Hierarchical namespace enabled
# - BlockBlobStorage kind (for Premium) or StorageV2 (for Standard)
```

Using Terraform:

```hcl
resource "azurerm_storage_account" "nfs" {
  name                     = "mystorageaccount"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Premium"
  account_replication_type = "LRS"
  account_kind             = "BlockBlobStorage"
  is_hns_enabled           = true
  nfsv3_enabled            = true
  enable_https_traffic_only = false  # NFS requires this

  network_rules {
    default_action = "Deny"
    virtual_network_subnet_ids = [
      azurerm_subnet.nfs_subnet.id
    ]
  }
}

resource "azurerm_storage_container" "nfs_container" {
  name                  = "nfsdata"
  storage_account_name  = azurerm_storage_account.nfs.name
  container_access_type = "private"
}
```

## Configuring Network Access

```bash
# Create VNet and subnet for NFS access
az network vnet create \
    --name myVNet \
    --resource-group myResourceGroup \
    --address-prefix 10.0.0.0/16 \
    --subnet-name nfs-subnet \
    --subnet-prefix 10.0.1.0/24

# Enable service endpoint for storage
az network vnet subnet update \
    --name nfs-subnet \
    --vnet-name myVNet \
    --resource-group myResourceGroup \
    --service-endpoints Microsoft.Storage

# Add VNet rule to storage account
az storage account network-rule add \
    --account-name mystorageaccount \
    --resource-group myResourceGroup \
    --vnet-name myVNet \
    --subnet nfs-subnet

# Or use private endpoint for better security
az network private-endpoint create \
    --name myNFSEndpoint \
    --resource-group myResourceGroup \
    --vnet-name myVNet \
    --subnet nfs-subnet \
    --private-connection-resource-id $(az storage account show \
        --name mystorageaccount \
        --resource-group myResourceGroup \
        --query id -o tsv) \
    --group-id blob \
    --connection-name myNFSConnection
```

## Mounting Blob NFS

```bash
# Create container (acts as NFS export)
az storage container create \
    --name nfsdata \
    --account-name mystorageaccount \
    --auth-mode login

# Mount on Linux VM
sudo mkdir -p /mnt/blobnfs

# Mount command
sudo mount -t nfs -o sec=sys,vers=3,nolock,proto=tcp \
    mystorageaccount.blob.core.windows.net:/mystorageaccount/nfsdata \
    /mnt/blobnfs

# Add to /etc/fstab for persistence
echo "mystorageaccount.blob.core.windows.net:/mystorageaccount/nfsdata /mnt/blobnfs nfs sec=sys,vers=3,nolock,proto=tcp 0 0" | sudo tee -a /etc/fstab
```

## Working with Blob NFS

```python
# Python - File operations on mounted Blob NFS
import os
import shutil
from pathlib import Path

class BlobNFSOperations:
    def __init__(self, mount_path='/mnt/blobnfs'):
        self.mount_path = Path(mount_path)

    def create_directory_structure(self, structure):
        """Create nested directory structure"""
        for dir_path in structure:
            full_path = self.mount_path / dir_path
            full_path.mkdir(parents=True, exist_ok=True)
            print(f"Created: {full_path}")

    def write_file(self, relative_path, content):
        """Write content to file"""
        file_path = self.mount_path / relative_path

        # Ensure parent directory exists
        file_path.parent.mkdir(parents=True, exist_ok=True)

        with open(file_path, 'w') as f:
            f.write(content)

        return str(file_path)

    def read_file(self, relative_path):
        """Read file content"""
        file_path = self.mount_path / relative_path

        with open(file_path, 'r') as f:
            return f.read()

    def list_directory(self, relative_path=''):
        """List directory contents"""
        dir_path = self.mount_path / relative_path

        return {
            'directories': [d.name for d in dir_path.iterdir() if d.is_dir()],
            'files': [f.name for f in dir_path.iterdir() if f.is_file()]
        }

    def move_file(self, source, destination):
        """Move file within the mount"""
        src_path = self.mount_path / source
        dst_path = self.mount_path / destination

        dst_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src_path), str(dst_path))

    def get_file_stats(self, relative_path):
        """Get file statistics"""
        file_path = self.mount_path / relative_path
        stat = file_path.stat()

        return {
            'size': stat.st_size,
            'created': stat.st_ctime,
            'modified': stat.st_mtime,
            'mode': oct(stat.st_mode)
        }

# Usage
nfs = BlobNFSOperations()

# Create directory structure
nfs.create_directory_structure([
    'data/raw/2021/08',
    'data/processed/2021/08',
    'logs',
    'temp'
])

# Write data
nfs.write_file('data/raw/2021/08/file1.json', '{"key": "value"}')
```

## Performance Optimization

```bash
# Optimal mount options for different workloads

# High-throughput sequential reads
sudo mount -t nfs -o sec=sys,vers=3,nolock,proto=tcp,rsize=1048576,wsize=1048576 \
    mystorageaccount.blob.core.windows.net:/mystorageaccount/nfsdata \
    /mnt/blobnfs

# High IOPS random access
sudo mount -t nfs -o sec=sys,vers=3,nolock,proto=tcp,rsize=65536,wsize=65536,actimeo=30 \
    mystorageaccount.blob.core.windows.net:/mystorageaccount/nfsdata \
    /mnt/blobnfs
```

```python
# Python - Performance testing for Blob NFS
import os
import time
import tempfile
from concurrent.futures import ThreadPoolExecutor

class NFSPerformanceTester:
    def __init__(self, mount_path):
        self.mount_path = mount_path

    def test_sequential_write(self, file_size_mb=100):
        """Test sequential write performance"""
        test_file = os.path.join(self.mount_path, 'perf_test_seq.dat')
        data = b'x' * (1024 * 1024)  # 1 MB chunk

        start = time.time()
        with open(test_file, 'wb') as f:
            for _ in range(file_size_mb):
                f.write(data)
        elapsed = time.time() - start

        os.remove(test_file)

        return {
            'test': 'sequential_write',
            'size_mb': file_size_mb,
            'duration_seconds': elapsed,
            'throughput_mbps': file_size_mb / elapsed
        }

    def test_sequential_read(self, file_size_mb=100):
        """Test sequential read performance"""
        test_file = os.path.join(self.mount_path, 'perf_test_read.dat')

        # Create test file first
        with open(test_file, 'wb') as f:
            f.write(b'x' * (file_size_mb * 1024 * 1024))

        start = time.time()
        with open(test_file, 'rb') as f:
            while f.read(1024 * 1024):
                pass
        elapsed = time.time() - start

        os.remove(test_file)

        return {
            'test': 'sequential_read',
            'size_mb': file_size_mb,
            'duration_seconds': elapsed,
            'throughput_mbps': file_size_mb / elapsed
        }

    def test_random_iops(self, num_operations=1000, file_size_kb=4):
        """Test random I/O performance"""
        test_dir = os.path.join(self.mount_path, 'iops_test')
        os.makedirs(test_dir, exist_ok=True)

        data = b'x' * (file_size_kb * 1024)

        def write_file(i):
            path = os.path.join(test_dir, f'file_{i}.dat')
            with open(path, 'wb') as f:
                f.write(data)
            return path

        start = time.time()
        with ThreadPoolExecutor(max_workers=32) as executor:
            files = list(executor.map(write_file, range(num_operations)))
        elapsed = time.time() - start

        # Cleanup
        for f in files:
            os.remove(f)
        os.rmdir(test_dir)

        return {
            'test': 'random_iops',
            'operations': num_operations,
            'duration_seconds': elapsed,
            'iops': num_operations / elapsed
        }
```

## Comparing Blob NFS vs Azure Files

```markdown
| Feature              | Blob NFS              | Azure Files NFS       |
|---------------------|----------------------|----------------------|
| Protocol            | NFS 3.0              | NFS 4.1              |
| Max file size       | 4.75 TB              | 4 TB                 |
| Max storage         | 5 PB                 | 100 TB               |
| Hierarchical NS     | Required             | Native               |
| Pricing model       | Blob storage pricing | Files pricing        |
| Best for            | Data lakes, analytics| Traditional workloads|
```

## Best Practices

1. **Use Premium tier**: For production workloads requiring consistent performance
2. **Enable hierarchical namespace**: Required for NFS and better performance
3. **Configure network security**: Use service endpoints or private endpoints
4. **Tune mount options**: Match rsize/wsize to workload pattern
5. **Monitor performance**: Track latency and throughput metrics

Azure Blob NFS bridges the gap between traditional NFS workloads and cloud-native blob storage, enabling seamless migration of Linux applications without code changes.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
