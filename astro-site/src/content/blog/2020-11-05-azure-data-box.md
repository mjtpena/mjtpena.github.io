---
title: "Azure Data Box: Physical Data Transfer at Scale"
author: Michael John Peña
draft: false
date: 2020-11-05
tags:
  - Azure
  - Data Box
  - Migration
  - Data Transfer

---

I wrote "Azure Data Box: Physical Data Transfer at Scale" to share practical, production-minded guidance on this topic.

## When to Use Data Box

| Scenario | Recommended |
|----------|-------------|
| < 40 TB | Online transfer (AzCopy, Storage Explorer) |
| 40 TB - 500 TB | Data Box |
| > 500 TB | Data Box Heavy |
| Continuous | Data Box Edge |

## Data Box Family

### Data Box Disk

- Up to 35 TB (5 x 8TB SSDs)
- USB/SATA connected
- Self-service copy

### Data Box

- 100 TB usable capacity
- Rugged appliance
- 1-2 Gbps network transfer

### Data Box Heavy

- 1 PB capacity
- Wheeled appliance
- 40 Gbps network transfer

## Ordering Data Box

```bash
# Order via CLI
az databox job create \
    --resource-group myRG \
    --name my-databox-order \
    --location eastus \
    --sku DataBox \
    --contact-name "John Doe" \
    --phone "555-1234" \
    --email-list "john@company.com" \
    --street-address-1 "123 Main St" \
    --city "Seattle" \
    --state-or-province "WA" \
    --postal-code "98101" \
    --country "US" \
    --storage-account mystorageaccount
```

## Data Copy Process

1. **Receive device**
2. **Connect to network**
3. **Copy data via SMB/NFS**
4. **Verify data**
5. **Ship back to Microsoft**

```bash
# Connect via SMB
net use X: \\<device-ip>\<share-name> /u:<username>

# Copy data
robocopy D:\SourceData X:\DestFolder /E /MT:16 /R:3 /W:10

# Or use AzCopy
azcopy copy "D:\SourceData" "\\<device-ip>\<share-name>" --recursive
```

## Share Structure

```
Data Box
├── storageaccount1_BlockBlob/
│   └── container1/
│       └── files...
├── storageaccount1_PageBlob/
├── storageaccount1_AzFile/
└── storageaccount2_BlockBlob/
```

## Data Validation

```bash
# Validate data integrity
# Data Box creates BOM files with checksums

# View Bill of Materials
type X:\DataBoxLogs\<timestamp>_bom.xml
```

## Monitoring Order

```bash
# Check order status
az databox job show \
    --resource-group myRG \
    --name my-databox-order \
    --query "status"

# Stages: DeviceOrdered → Shipped → Delivered →
#         DataCopyInProgress → DataCopyCompleted →
#         VerificationComplete → DataSanitized → Complete
```

## Security Features

- AES 256-bit encryption
- Tamper-evident seals
- Secure chain of custody
- Data wipe after transfer (NIST 800-88)

## Data Box Edge

For ongoing data transfer with edge compute:

```
On-Premises                         Azure
┌──────────────┐                   ┌──────────────┐
│ Data Sources │ → Data Box Edge → │ Blob Storage │
│              │   (Continuous)    │ Data Lake    │
└──────────────┘                   └──────────────┘
```

## Pricing Estimate

| Device | Per-device fee | Additional charges |
|--------|----------------|-------------------|
| Disk | $50/disk | Shipping |
| Data Box | $500 | $50/day after 10 days |
| Data Box Heavy | $2,000 | $100/day after 10 days |

Data Box: when the network isn't fast enough, ship it.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
