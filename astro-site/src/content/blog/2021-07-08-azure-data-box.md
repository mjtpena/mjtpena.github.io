---
title: Offline Data Transfer with Azure Data Box
author: Michael John Peña
draft: false
date: 2021-07-08
url: /blog/azure-data-box/
tags:
  - Azure
  - Data
  - Migration
  - Data Box
  - Storage
---

## Data Box Family Overview

Azure offers several Data Box options:

- **Data Box Disk**: Up to 40 TB per order (8 TB per disk)
- **Data Box**: 100 TB storage capacity
- **Data Box Heavy**: Up to 1 PB storage capacity
- **Data Box Gateway**: Virtual appliance for ongoing transfers

## Ordering a Data Box

Create a Data Box order programmatically:

```python
from azure.mgmt.databox import DataBoxManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = DataBoxManagementClient(credential, subscription_id)

# Create Data Box order
order = {
    "location": "eastus",
    "sku": {
        "name": "DataBox"
    },
    "properties": {
        "transferType": "ImportToAzure",
        "details": {
            "jobDetailsType": "DataBox",
            "contactDetails": {
                "contactName": "Data Migration Team",
                "phone": "+1-555-123-4567",
                "emailList": ["dataops@company.com"],
                "notificationPreference": [
                    {
                        "stageName": "DevicePrepared",
                        "sendNotification": True
                    },
                    {
                        "stageName": "Dispatched",
                        "sendNotification": True
                    },
                    {
                        "stageName": "Delivered",
                        "sendNotification": True
                    },
                    {
                        "stageName": "DataCopy",
                        "sendNotification": True
                    }
                ]
            },
            "shippingAddress": {
                "streetAddress1": "123 Enterprise Drive",
                "streetAddress2": "Building A",
                "city": "Seattle",
                "stateOrProvince": "WA",
                "country": "US",
                "postalCode": "98101",
                "companyName": "Contoso Ltd",
                "addressType": "Commercial"
            },
            "destinationAccountDetails": [
                {
                    "storageAccountId": f"/subscriptions/{subscription_id}/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/targetstorageaccount",
                    "dataAccountType": "StorageAccount"
                }
            ],
            "dataImportDetails": [
                {
                    "accountDetails": {
                        "storageAccountId": f"/subscriptions/{subscription_id}/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/targetstorageaccount",
                        "dataAccountType": "StorageAccount"
                    }
                }
            ]
        }
    }
}

result = client.jobs.create(
    resource_group_name="rg-databox",
    job_name="databox-migration-001",
    job_resource=order
)

print(f"Order created: {result.name}")
print(f"Status: {result.status}")
```

## Preparing Data for Copy

Prepare your data for optimal transfer:

```powershell
# Validate data structure before copying to Data Box
function Validate-DataStructure {
    param(
        [string]$SourcePath,
        [string]$ReportPath
    )

    $report = @{
        TotalFiles = 0
        TotalSize = 0
        InvalidPaths = @()
        LargeFiles = @()
        UnsupportedNames = @()
    }

    Get-ChildItem -Path $SourcePath -Recurse -File | ForEach-Object {
        $report.TotalFiles++
        $report.TotalSize += $_.Length

        # Check path length (max 1024 characters for Azure)
        if ($_.FullName.Length -gt 1024) {
            $report.InvalidPaths += $_.FullName
        }

        # Check for very large files
        if ($_.Length -gt 5TB) {
            $report.LargeFiles += $_.FullName
        }

        # Check for unsupported characters
        if ($_.Name -match '[<>:"|?*]') {
            $report.UnsupportedNames += $_.FullName
        }
    }

    $report | ConvertTo-Json -Depth 3 | Out-File $ReportPath

    Write-Host "Total Files: $($report.TotalFiles)"
    Write-Host "Total Size: $([math]::Round($report.TotalSize / 1GB, 2)) GB"
    Write-Host "Invalid Paths: $($report.InvalidPaths.Count)"
    Write-Host "Unsupported Names: $($report.UnsupportedNames.Count)"

    return $report
}

Validate-DataStructure -SourcePath "D:\DataToMigrate" -ReportPath "C:\Reports\validation.json"
```

## Copying Data to Data Box

Use robocopy or AzCopy for efficient data transfer:

```powershell
# Data Box mount points after connecting
$DataBoxShare = "\\DataBox\StorageAccount_BlockBlob"
$DataBoxPageBlob = "\\DataBox\StorageAccount_PageBlob"
$DataBoxAzureFiles = "\\DataBox\StorageAccount_AzureFile"

# Connect to Data Box share
$securePassword = ConvertTo-SecureString "DataBoxPassword" -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential("DataBoxUser", $securePassword)

New-PSDrive -Name "DataBox" -PSProvider FileSystem -Root $DataBoxShare -Credential $credential

# Copy using robocopy with logging
$sourceDir = "D:\DataToMigrate"
$destDir = "DataBox:\container-name"
$logFile = "C:\Logs\databox-copy-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

robocopy $sourceDir $destDir /E /MT:32 /R:3 /W:5 /LOG:$logFile /TEE /NP /V

# Parse robocopy results
$exitCode = $LASTEXITCODE
switch ($exitCode) {
    0 { Write-Host "No files copied" }
    1 { Write-Host "All files copied successfully" }
    2 { Write-Host "Extra files detected in destination" }
    3 { Write-Host "Some files copied, extra files detected" }
    4 { Write-Host "Some mismatched files or directories" }
    5 { Write-Host "Some files copied, some mismatched" }
    6 { Write-Host "Extra and mismatched files detected" }
    7 { Write-Host "Files copied, extra and mismatched detected" }
    8 { Write-Host "Several files did not copy" }
    default { Write-Host "Error occurred: $exitCode" }
}
```

## Using AzCopy for Data Box

AzCopy provides better performance for large transfers:

```bash
# Generate SAS token for Data Box
# The Data Box provides local storage account endpoint

# Copy with AzCopy
azcopy copy "D:\DataToMigrate" "https://databoxstorageaccount.blob.core.windows.net/container?sv=..." \
    --recursive \
    --put-md5 \
    --log-level INFO \
    --output-type json

# Copy specific file patterns
azcopy copy "D:\DataToMigrate\*.parquet" "https://databoxstorageaccount.blob.core.windows.net/data/parquet/" \
    --recursive \
    --include-pattern "*.parquet"

# Resume interrupted copy
azcopy jobs resume <job-id>

# Check job status
azcopy jobs show <job-id>
```

## Verifying Data Integrity

Validate data after copy:

```python
import os
import hashlib
from pathlib import Path
import json

def calculate_md5(file_path, chunk_size=8192):
    """Calculate MD5 hash of a file."""
    md5_hash = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            md5_hash.update(chunk)
    return md5_hash.hexdigest()

def create_checksum_manifest(source_dir, output_file):
    """Create a manifest of all files with their checksums."""
    manifest = {}
    source_path = Path(source_dir)

    for file_path in source_path.rglob("*"):
        if file_path.is_file():
            relative_path = str(file_path.relative_to(source_path))
            file_info = {
                "md5": calculate_md5(str(file_path)),
                "size": file_path.stat().st_size,
                "modified": file_path.stat().st_mtime
            }
            manifest[relative_path] = file_info
            print(f"Processed: {relative_path}")

    with open(output_file, "w") as f:
        json.dump(manifest, f, indent=2)

    return manifest

def verify_copy(source_manifest_path, destination_dir):
    """Verify destination matches source manifest."""
    with open(source_manifest_path, "r") as f:
        source_manifest = json.load(f)

    dest_path = Path(destination_dir)
    errors = []

    for relative_path, source_info in source_manifest.items():
        dest_file = dest_path / relative_path

        if not dest_file.exists():
            errors.append(f"Missing: {relative_path}")
            continue

        dest_md5 = calculate_md5(str(dest_file))
        if dest_md5 != source_info["md5"]:
            errors.append(f"Checksum mismatch: {relative_path}")

        if dest_file.stat().st_size != source_info["size"]:
            errors.append(f"Size mismatch: {relative_path}")

    return errors

# Create manifest before copy
manifest = create_checksum_manifest("D:\\DataToMigrate", "D:\\manifest.json")

# Verify after copy to Data Box
errors = verify_copy("D:\\manifest.json", "\\\\DataBox\\StorageAccount_BlockBlob\\container")
if errors:
    print("Verification errors found:")
    for error in errors:
        print(f"  - {error}")
else:
    print("All files verified successfully")
```

## Monitoring Order Status

Track your Data Box order:

```python
# Get order status
order = client.jobs.get(
    resource_group_name="rg-databox",
    job_name="databox-migration-001"
)

print(f"Job Name: {order.name}")
print(f"Status: {order.status}")
print(f"Transfer Type: {order.transfer_type}")

# Get copy progress
if order.copy_progress:
    for progress in order.copy_progress:
        print(f"\nStorage Account: {progress.storage_account_name}")
        print(f"  Status: {progress.transfer_type}")
        print(f"  Bytes Processed: {progress.bytes_processed}")
        print(f"  Total Bytes: {progress.total_bytes_to_process}")
        print(f"  Files Processed: {progress.files_processed}")
        print(f"  Total Files: {progress.total_files_to_process}")

# Get copy logs after completion
copy_logs = client.jobs.list_credentials(
    resource_group_name="rg-databox",
    job_name="databox-migration-001"
)

for log in copy_logs:
    print(f"Copy Log: {log.job_secrets}")
```

## Data Box Gateway for Ongoing Transfers

Set up Data Box Gateway for continuous migration:

```powershell
# Deploy Data Box Gateway virtual appliance
$vmConfig = @{
    Name = "DataBoxGateway"
    ResourceGroupName = "rg-databox"
    Location = "eastus"
    VirtualMachineScaleSet = $false
    Size = "Standard_D4s_v3"
}

# After deployment, configure shares
# Connect to gateway management interface
$gatewayIP = "10.0.0.4"
$session = New-PSSession -ComputerName $gatewayIP -Credential $adminCred

Invoke-Command -Session $session -ScriptBlock {
    # Configure cloud share
    Add-DataBoxGatewayShare -Name "CloudShare" `
        -StorageAccountName "targetstorageaccount" `
        -ContainerName "gateway-uploads" `
        -ShareType "Block Blob"

    # Configure local share for caching
    Add-DataBoxGatewayShare -Name "LocalCache" `
        -LocalPath "D:\Cache" `
        -ShareType "Local"
}

# Monitor gateway sync status
Get-DataBoxGatewaySyncStatus -GatewayName "DataBoxGateway" -ResourceGroupName "rg-databox"
```

## Conclusion

Azure Data Box provides an essential solution for large-scale data migrations where network transfer is impractical. Whether you choose Data Box Disk for smaller datasets or Data Box Heavy for petabyte-scale migrations, the process is straightforward: order, copy, ship, and verify.

The key to success is proper preparation: validate your data structure, create checksums for verification, and use tools like robocopy or AzCopy with appropriate settings for reliable data transfer. With proper planning, Data Box enables you to migrate massive datasets to Azure efficiently and securely.
