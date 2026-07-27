---
title: "Azure Files: Managed File Shares in the Cloud"
author: "Michael John Peña"
draft: false
date: 2021-08-19
tags: ["Azure", "Azure Files", "File Storage", "SMB", "NFS"]
---

Azure Files is the managed file share service I reach for when an application needs shared file access and rewriting it to use blob storage isn't feasible—legacy applications expecting UNC paths, shared configuration files that multiple VMs read, or lift-and-shift migrations where the application tier assumes a shared file system. SMB 3.0 (with encryption) and NFS 4.1 (for Linux workloads) give you protocol-level compatibility without deploying a file server VM. The Standard tier (HDD) is cost-effective for shares accessed infrequently or with modest performance requirements; Premium tier (SSD) is the choice for latency-sensitive workloads or applications where file I/O is on the critical path. Azure File Sync extends this to hybrid scenarios, synchronising Azure file shares with on-premises Windows Server shares for branch office connectivity or cloud tiering of infrequently accessed files.

## Creating Azure File Shares

```bash
# Create storage account with large file shares enabled
az storage account create \
    --name mystorageaccount \
    --resource-group myResourceGroup \
    --location eastus \
    --sku Premium_LRS \
    --kind FileStorage \
    --enable-large-file-share

# Create file share
az storage share-rm create \
    --storage-account mystorageaccount \
    --resource-group myResourceGroup \
    --name myfileshare \
    --quota 1024 \
    --enabled-protocols SMB

# Create NFS file share (Premium tier)
az storage share-rm create \
    --storage-account mystorageaccount \
    --resource-group myResourceGroup \
    --name mynfsshare \
    --quota 1024 \
    --enabled-protocols NFS \
    --root-squash NoRootSquash
```

## Mounting Azure Files on Windows

```powershell
# Mount Azure Files as network drive
$storageAccountName = "mystorageaccount"
$storageAccountKey = (Get-AzStorageAccountKey -ResourceGroupName "myResourceGroup" -Name $storageAccountName)[0].Value
$shareName = "myfileshare"

# Test connectivity
Test-NetConnection -ComputerName "$storageAccountName.file.core.windows.net" -Port 445

# Create credential and mount
$credential = New-Object System.Management.Automation.PSCredential `
    -ArgumentList "Azure\$storageAccountName", (ConvertTo-SecureString -String $storageAccountKey -AsPlainText -Force)

New-PSDrive -Name Z -PSProvider FileSystem `
    -Root "\\$storageAccountName.file.core.windows.net\$shareName" `
    -Credential $credential -Persist
```

## Mounting Azure Files on Linux

```bash
# Install cifs-utils
sudo apt-get install cifs-utils

# Create mount point and credentials file
sudo mkdir -p /mnt/azurefiles

# Create credentials file
cat > ~/.smbcredentials << EOF
username=mystorageaccount
password=<storage-account-key>
EOF
chmod 600 ~/.smbcredentials

# Mount the share
sudo mount -t cifs //mystorageaccount.file.core.windows.net/myfileshare /mnt/azurefiles \
    -o credentials=~/.smbcredentials,dir_mode=0777,file_mode=0777,serverino,nosharesock,actimeo=30

# Add to /etc/fstab for persistent mount
echo "//mystorageaccount.file.core.windows.net/myfileshare /mnt/azurefiles cifs credentials=/home/user/.smbcredentials,dir_mode=0777,file_mode=0777,serverino,nosharesock,actimeo=30 0 0" | sudo tee -a /etc/fstab
```

## Azure Files with Azure AD Authentication

```csharp
// C# - Using Azure AD authentication with Azure Files
using Azure.Storage.Files.Shares;
using Azure.Identity;

public class AzureFilesService
{
    private readonly ShareClient _shareClient;

    public AzureFilesService(string accountName, string shareName)
    {
        var credential = new DefaultAzureCredential();
        var shareUri = new Uri($"https://{accountName}.file.core.windows.net/{shareName}");

        _shareClient = new ShareClient(shareUri, credential);
    }

    public async Task<ShareDirectoryClient> CreateDirectoryAsync(string path)
    {
        var directory = _shareClient.GetDirectoryClient(path);
        await directory.CreateIfNotExistsAsync();
        return directory;
    }

    public async Task UploadFileAsync(string directoryPath, string fileName, Stream content)
    {
        var directory = _shareClient.GetDirectoryClient(directoryPath);
        await directory.CreateIfNotExistsAsync();

        var file = directory.GetFileClient(fileName);
        await file.CreateAsync(content.Length);
        await file.UploadAsync(content);
    }

    public async Task<Stream> DownloadFileAsync(string directoryPath, string fileName)
    {
        var directory = _shareClient.GetDirectoryClient(directoryPath);
        var file = directory.GetFileClient(fileName);

        var download = await file.DownloadAsync();
        return download.Value.Content;
    }

    public async Task<List<string>> ListFilesAsync(string directoryPath)
    {
        var directory = _shareClient.GetDirectoryClient(directoryPath);
        var files = new List<string>();

        await foreach (var item in directory.GetFilesAndDirectoriesAsync())
        {
            files.Add(item.Name);
        }

        return files;
    }
}
```

## File Share Snapshots

```python
# Python - Managing file share snapshots
from azure.storage.fileshare import ShareServiceClient, ShareClient
from datetime import datetime

class SnapshotManager:
    def __init__(self, connection_string, share_name):
        self.service_client = ShareServiceClient.from_connection_string(
            connection_string
        )
        self.share_client = self.service_client.get_share_client(share_name)

    def create_snapshot(self, metadata=None):
        """Create a snapshot of the file share"""
        snapshot_metadata = metadata or {
            'created_by': 'backup_job',
            'timestamp': datetime.utcnow().isoformat()
        }

        snapshot = self.share_client.create_snapshot(metadata=snapshot_metadata)
        return snapshot['snapshot']

    def list_snapshots(self):
        """List all snapshots for the share"""
        snapshots = []

        for share in self.service_client.list_shares(
            include_snapshots=True
        ):
            if share.snapshot:
                snapshots.append({
                    'name': share.name,
                    'snapshot': share.snapshot,
                    'metadata': share.metadata
                })

        return snapshots

    def restore_from_snapshot(self, snapshot_time, source_path, dest_path):
        """Restore a file from a snapshot"""
        # Get snapshot share client
        snapshot_share = self.service_client.get_share_client(
            self.share_client.share_name,
            snapshot=snapshot_time
        )

        # Get source file from snapshot
        source_dir = snapshot_share.get_directory_client(
            '/'.join(source_path.split('/')[:-1])
        )
        source_file = source_dir.get_file_client(source_path.split('/')[-1])

        # Download from snapshot
        download = source_file.download_file()
        content = download.readall()

        # Upload to destination in live share
        dest_dir = self.share_client.get_directory_client(
            '/'.join(dest_path.split('/')[:-1])
        )
        dest_dir.create_directory()
        dest_file = dest_dir.get_file_client(dest_path.split('/')[-1])

        dest_file.upload_file(content)
        return dest_path

    def delete_old_snapshots(self, days_to_keep=30):
        """Delete snapshots older than specified days"""
        from datetime import timedelta

        cutoff = datetime.utcnow() - timedelta(days=days_to_keep)
        deleted = 0

        for snapshot in self.list_snapshots():
            snapshot_time = datetime.fromisoformat(
                snapshot['snapshot'].replace('Z', '+00:00')
            )

            if snapshot_time < cutoff:
                snapshot_share = self.service_client.get_share_client(
                    self.share_client.share_name,
                    snapshot=snapshot['snapshot']
                )
                snapshot_share.delete_share()
                deleted += 1

        return deleted
```

## Soft Delete and Backup

```bash
# Enable soft delete for file shares
az storage account file-service-properties update \
    --account-name mystorageaccount \
    --resource-group myResourceGroup \
    --enable-delete-retention true \
    --delete-retention-days 14

# Enable Azure Backup for file shares
az backup protection enable-for-azurefileshare \
    --vault-name myRecoveryVault \
    --resource-group myResourceGroup \
    --storage-account mystorageaccount \
    --azure-file-share myfileshare \
    --policy-name DailyBackupPolicy
```

## Performance Optimization

```csharp
// C# - Optimized file operations
public class OptimizedFileOperations
{
    private readonly ShareClient _shareClient;

    public async Task ParallelUploadDirectoryAsync(
        string localPath,
        string remotePath,
        int maxParallelism = 8)
    {
        var files = Directory.GetFiles(localPath, "*", SearchOption.AllDirectories);

        var options = new ParallelOptions { MaxDegreeOfParallelism = maxParallelism };

        await Parallel.ForEachAsync(files, options, async (file, ct) =>
        {
            var relativePath = Path.GetRelativePath(localPath, file);
            var remoteFilePath = Path.Combine(remotePath, relativePath);

            await UploadFileAsync(remoteFilePath, file);
        });
    }

    public async Task UploadLargeFileAsync(string remotePath, string localPath)
    {
        var directory = _shareClient.GetDirectoryClient(Path.GetDirectoryName(remotePath));
        await directory.CreateIfNotExistsAsync();

        var file = directory.GetFileClient(Path.GetFileName(remotePath));
        var fileInfo = new FileInfo(localPath);

        // Create file with full size
        await file.CreateAsync(fileInfo.Length);

        // Upload in 4MB chunks
        const int chunkSize = 4 * 1024 * 1024;
        long offset = 0;

        using var stream = File.OpenRead(localPath);
        var buffer = new byte[chunkSize];

        while (offset < fileInfo.Length)
        {
            var bytesRead = await stream.ReadAsync(buffer, 0, chunkSize);
            using var chunkStream = new MemoryStream(buffer, 0, bytesRead);

            await file.UploadRangeAsync(
                new HttpRange(offset, bytesRead),
                chunkStream);

            offset += bytesRead;
        }
    }
}
```

## Best Practices

1. **Choose the right tier**: Standard for general use, Premium for performance
2. **Use private endpoints**: Secure access within VNet
3. **Enable snapshots**: For point-in-time recovery
4. **Consider Azure File Sync**: For hybrid scenarios
5. **Monitor performance**: Track IOPS and throughput

Azure Files provides a seamless bridge between on-premises file servers and cloud storage, enabling organizations to modernize their file infrastructure without significant application changes.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
