---
title: "Azure NetApp Files: Enterprise File Storage"
author: Michael John Peña
draft: false
date: 2020-12-18
tags:
  - Azure
  - NetApp
  - Storage
  - Files

---

I wrote "Azure NetApp Files: Enterprise File Storage" to share practical, production-minded guidance on this topic.

## Service Tiers

| Tier | Throughput | Use Case |
|------|------------|----------|
| Standard | 16 MB/s per TB | General file shares |
| Premium | 64 MB/s per TB | Databases, analytics |
| Ultra | 128 MB/s per TB | SAP HANA, HPC |

## Creating NetApp Account

```bash
# Create NetApp account
az netappfiles account create \
    --resource-group myRG \
    --location eastus \
    --name my-netapp-account

# Create capacity pool
az netappfiles pool create \
    --resource-group myRG \
    --account-name my-netapp-account \
    --name my-pool \
    --size 4 \
    --service-level Premium

# Create volume
az netappfiles volume create \
    --resource-group myRG \
    --account-name my-netapp-account \
    --pool-name my-pool \
    --name my-volume \
    --location eastus \
    --vnet my-vnet \
    --subnet netapp-subnet \
    --protocol-types NFSv3 \
    --usage-threshold 1024
```

## NFS Mount

```bash
# Mount NFSv3 volume
sudo mount -t nfs -o rw,hard,rsize=65536,wsize=65536,vers=3 \
    10.0.1.4:/my-volume /mnt/netapp

# Add to fstab for persistence
echo "10.0.1.4:/my-volume /mnt/netapp nfs rw,hard,rsize=65536,wsize=65536,vers=3 0 0" | sudo tee -a /etc/fstab
```

## SMB Mount

```bash
# Create SMB volume
az netappfiles volume create \
    --resource-group myRG \
    --account-name my-netapp-account \
    --pool-name my-pool \
    --name smb-volume \
    --location eastus \
    --vnet my-vnet \
    --subnet netapp-subnet \
    --protocol-types CIFS \
    --usage-threshold 1024

# Mount on Windows
net use Z: \\10.0.1.5\smb-volume /user:admin password

# Mount on Linux
sudo mount -t cifs //10.0.1.5/smb-volume /mnt/smb -o username=admin,password=xxx
```

## Snapshots

```bash
# Create snapshot
az netappfiles snapshot create \
    --resource-group myRG \
    --account-name my-netapp-account \
    --pool-name my-pool \
    --volume-name my-volume \
    --name snapshot-001

# List snapshots
az netappfiles snapshot list \
    --resource-group myRG \
    --account-name my-netapp-account \
    --pool-name my-pool \
    --volume-name my-volume

# Restore from snapshot
az netappfiles volume revert \
    --resource-group myRG \
    --account-name my-netapp-account \
    --pool-name my-pool \
    --volume-name my-volume \
    --snapshot-id /subscriptions/.../snapshots/snapshot-001
```

## Snapshot Policies

```bash
# Create snapshot policy
az netappfiles snapshot-policy create \
    --resource-group myRG \
    --account-name my-netapp-account \
    --name daily-snapshots \
    --location eastus \
    --daily-snapshots 7 \
    --daily-hour 23 \
    --daily-minute 0 \
    --enabled true

# Apply to volume
az netappfiles volume update \
    --resource-group myRG \
    --account-name my-netapp-account \
    --pool-name my-pool \
    --name my-volume \
    --snapshot-policy-id /subscriptions/.../snapshotPolicies/daily-snapshots
```

## Cross-Region Replication

```bash
# Create destination volume with replication
az netappfiles volume create \
    --resource-group dr-rg \
    --account-name dr-netapp-account \
    --pool-name dr-pool \
    --name my-volume-dr \
    --location westus \
    --vnet dr-vnet \
    --subnet netapp-subnet \
    --protocol-types NFSv3 \
    --usage-threshold 1024 \
    --replication-schedule hourly \
    --remote-volume-resource-id /subscriptions/.../volumes/my-volume \
    --endpoint-type dst
```

## Export Policy

```bash
# Configure client access
az netappfiles volume update \
    --resource-group myRG \
    --account-name my-netapp-account \
    --pool-name my-pool \
    --name my-volume \
    --export-policy-rules '[
        {
            "allowedClients": "10.0.1.0/24",
            "nfsv3": true,
            "nfsv41": false,
            "ruleIndex": 1,
            "unixReadOnly": false,
            "unixReadWrite": true
        }
    ]'
```

Azure NetApp Files: enterprise storage performance in the cloud.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
