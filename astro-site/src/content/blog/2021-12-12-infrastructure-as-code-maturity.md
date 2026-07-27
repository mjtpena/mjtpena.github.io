---
title: "Infrastructure as Code Maturity: Beyond the Basics"
author: Michael John Pena
draft: false
date: 2021-12-12
tags:
  - Infrastructure as Code
  - Terraform
  - Bicep
  - Azure
  - DevOps

---

I wrote "Infrastructure as Code Maturity: Beyond the Basics" to share practical, production-minded guidance on this topic.

## The IaC Maturity Model

1. **Ad-hoc**: Manual deployments, occasional scripts
2. **Repeatable**: Basic templates, manual execution
3. **Consistent**: Version controlled, CI/CD deployment
4. **Measured**: Testing, drift detection, compliance
5. **Optimized**: Self-service, policy as code, cost optimization

## Terraform Module Design

Modular, reusable infrastructure:

```hcl
# modules/azure-data-platform/main.tf
terraform {
  required_version = ">= 1.0.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "location" {
  type        = string
  default     = "australiaeast"
}

variable "tags" {
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "data-${var.environment}"
  common_tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "Terraform"
    Module      = "azure-data-platform"
  })
}

# Resource Group
resource "azurerm_resource_group" "data" {
  name     = "${local.name_prefix}-rg"
  location = var.location
  tags     = local.common_tags
}

# Data Lake Storage
resource "azurerm_storage_account" "datalake" {
  name                     = replace("${local.name_prefix}lake", "-", "")
  resource_group_name      = azurerm_resource_group.data.name
  location                 = azurerm_resource_group.data.location
  account_tier             = "Standard"
  account_replication_type = var.environment == "prod" ? "GRS" : "LRS"
  account_kind             = "StorageV2"
  is_hns_enabled           = true

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }

  tags = local.common_tags
}

resource "azurerm_storage_data_lake_gen2_filesystem" "bronze" {
  name               = "bronze"
  storage_account_id = azurerm_storage_account.datalake.id
}

resource "azurerm_storage_data_lake_gen2_filesystem" "silver" {
  name               = "silver"
  storage_account_id = azurerm_storage_account.datalake.id
}

resource "azurerm_storage_data_lake_gen2_filesystem" "gold" {
  name               = "gold"
  storage_account_id = azurerm_storage_account.datalake.id
}

# Synapse Workspace
resource "azurerm_synapse_workspace" "synapse" {
  name                                 = "${local.name_prefix}-synapse"
  resource_group_name                  = azurerm_resource_group.data.name
  location                             = azurerm_resource_group.data.location
  storage_data_lake_gen2_filesystem_id = azurerm_storage_data_lake_gen2_filesystem.bronze.id
  sql_administrator_login              = "sqladmin"
  sql_administrator_login_password     = var.sql_admin_password

  identity {
    type = "SystemAssigned"
  }

  tags = local.common_tags
}

# Outputs
output "resource_group_name" {
  value = azurerm_resource_group.data.name
}

output "storage_account_name" {
  value = azurerm_storage_account.datalake.name
}

output "synapse_workspace_name" {
  value = azurerm_synapse_workspace.synapse.name
}

output "synapse_workspace_id" {
  value = azurerm_synapse_workspace.synapse.id
}
```

## Bicep for Azure-Native IaC

Azure's answer to Terraform for Azure-only infrastructure:

```bicep
// main.bicep
targetScope = 'subscription'

@description('Environment name')
@allowed(['dev', 'staging', 'prod'])
param environment string

@description('Azure region')
param location string = 'australiaeast'

@description('Tags for all resources')
param tags object = {}

var namePrefix = 'data-${environment}'
var commonTags = union(tags, {
  Environment: environment
  ManagedBy: 'Bicep'
})

// Resource Group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: '${namePrefix}-rg'
  location: location
  tags: commonTags
}

// Data Lake Module
module datalake 'modules/datalake.bicep' = {
  scope: rg
  name: 'datalake-deployment'
  params: {
    namePrefix: namePrefix
    location: location
    tags: commonTags
    replicationType: environment == 'prod' ? 'GRS' : 'LRS'
  }
}

// Synapse Module
module synapse 'modules/synapse.bicep' = {
  scope: rg
  name: 'synapse-deployment'
  params: {
    namePrefix: namePrefix
    location: location
    tags: commonTags
    storageAccountId: datalake.outputs.storageAccountId
    filesystemId: datalake.outputs.bronzeFilesystemId
  }
}

// Outputs
output resourceGroupName string = rg.name
output storageAccountName string = datalake.outputs.storageAccountName
output synapseWorkspaceName string = synapse.outputs.workspaceName

// modules/datalake.bicep
param namePrefix string
param location string
param tags object
param replicationType string

var storageAccountName = replace('${namePrefix}lake', '-', '')

resource storageAccount 'Microsoft.Storage/storageAccounts@2021-08-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: '${replicationType == 'GRS' ? 'Standard_GRS' : 'Standard_LRS'}'
  }
  properties: {
    isHnsEnabled: true
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource bronzeContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-08-01' = {
  name: '${storageAccount.name}/default/bronze'
}

resource silverContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-08-01' = {
  name: '${storageAccount.name}/default/silver'
}

resource goldContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-08-01' = {
  name: '${storageAccount.name}/default/gold'
}

output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
output bronzeFilesystemId string = bronzeContainer.id
```

## Testing Infrastructure Code

```python
# tests/test_data_platform.py
import pytest
import subprocess
import json
import os

class TestDataPlatformModule:
    @pytest.fixture(scope="class")
    def terraform_output(self):
        """Initialize and apply Terraform for testing"""
        test_dir = "tests/fixtures/data_platform"

        # Initialize
        subprocess.run(
            ["terraform", "init"],
            cwd=test_dir,
            check=True
        )

        # Plan
        subprocess.run(
            ["terraform", "plan", "-out=tfplan"],
            cwd=test_dir,
            check=True
        )

        # Apply
        subprocess.run(
            ["terraform", "apply", "-auto-approve", "tfplan"],
            cwd=test_dir,
            check=True
        )

        # Get outputs
        result = subprocess.run(
            ["terraform", "output", "-json"],
            cwd=test_dir,
            capture_output=True,
            text=True,
            check=True
        )

        yield json.loads(result.stdout)

        # Cleanup
        subprocess.run(
            ["terraform", "destroy", "-auto-approve"],
            cwd=test_dir,
            check=True
        )

    def test_resource_group_created(self, terraform_output):
        assert "resource_group_name" in terraform_output
        assert terraform_output["resource_group_name"]["value"].startswith("data-")

    def test_storage_account_hierarchical_namespace(self, terraform_output):
        """Verify storage account has HNS enabled for Data Lake"""
        from azure.identity import DefaultAzureCredential
        from azure.mgmt.storage import StorageManagementClient

        credential = DefaultAzureCredential()
        client = StorageManagementClient(
            credential,
            os.environ["ARM_SUBSCRIPTION_ID"]
        )

        account = client.storage_accounts.get_properties(
            terraform_output["resource_group_name"]["value"],
            terraform_output["storage_account_name"]["value"]
        )

        assert account.is_hns_enabled == True

    def test_storage_account_network_rules(self, terraform_output):
        """Verify storage account has network rules configured"""
        from azure.identity import DefaultAzureCredential
        from azure.mgmt.storage import StorageManagementClient

        credential = DefaultAzureCredential()
        client = StorageManagementClient(
            credential,
            os.environ["ARM_SUBSCRIPTION_ID"]
        )

        account = client.storage_accounts.get_properties(
            terraform_output["resource_group_name"]["value"],
            terraform_output["storage_account_name"]["value"]
        )

        assert account.network_rule_set.default_action == "Deny"


# Policy tests using Conftest/OPA
# tests/policies/storage.rego
package terraform.storage

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_storage_account"
    resource.change.after.min_tls_version != "TLS1_2"
    msg := sprintf("Storage account %s must use TLS 1.2", [resource.address])
}

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_storage_account"
    resource.change.after.enable_https_traffic_only != true
    msg := sprintf("Storage account %s must enforce HTTPS", [resource.address])
}

deny[msg] {
    resource := input.resource_changes[_]
    resource.type == "azurerm_storage_account"
    resource.change.after.network_rules[_].default_action == "Allow"
    msg := sprintf("Storage account %s must deny public access", [resource.address])
}
```

## GitOps for Infrastructure

```yaml
# .github/workflows/infrastructure.yml
name: Infrastructure Deployment

on:
  push:
    branches: [main]
    paths:
      - 'infrastructure/**'
  pull_request:
    branches: [main]
    paths:
      - 'infrastructure/**'

env:
  TF_VERSION: '1.1.0'
  ARM_CLIENT_ID: ${{ secrets.ARM_CLIENT_ID }}
  ARM_CLIENT_SECRET: ${{ secrets.ARM_CLIENT_SECRET }}
  ARM_SUBSCRIPTION_ID: ${{ secrets.ARM_SUBSCRIPTION_ID }}
  ARM_TENANT_ID: ${{ secrets.ARM_TENANT_ID }}

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v1
        with:
          terraform_version: ${{ env.TF_VERSION }}

      - name: Terraform Format
        run: terraform fmt -check -recursive
        working-directory: infrastructure

      - name: Terraform Init
        run: terraform init -backend=false
        working-directory: infrastructure

      - name: Terraform Validate
        run: terraform validate
        working-directory: infrastructure

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: tfsec scan
        uses: aquasecurity/tfsec-action@v1.0.0
        with:
          working_directory: infrastructure

      - name: Checkov scan
        uses: bridgecrewio/checkov-action@master
        with:
          directory: infrastructure
          framework: terraform

  plan:
    needs: [validate, security-scan]
    runs-on: ubuntu-latest
    strategy:
      matrix:
        environment: [dev, staging, prod]
    steps:
      - uses: actions/checkout@v2

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v1
        with:
          terraform_version: ${{ env.TF_VERSION }}

      - name: Terraform Init
        run: |
          terraform init \
            -backend-config="storage_account_name=${{ secrets.TF_STATE_STORAGE }}" \
            -backend-config="container_name=tfstate" \
            -backend-config="key=${{ matrix.environment }}.tfstate"
        working-directory: infrastructure

      - name: Terraform Plan
        run: |
          terraform plan \
            -var-file="environments/${{ matrix.environment }}.tfvars" \
            -out=${{ matrix.environment }}.tfplan
        working-directory: infrastructure

      - name: Upload Plan
        uses: actions/upload-artifact@v2
        with:
          name: ${{ matrix.environment }}-plan
          path: infrastructure/${{ matrix.environment }}.tfplan

  apply-dev:
    needs: plan
    if: github.ref == 'refs/heads/main'
    environment: dev
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Download Plan
        uses: actions/download-artifact@v2
        with:
          name: dev-plan
          path: infrastructure

      - name: Terraform Apply
        run: terraform apply -auto-approve dev.tfplan
        working-directory: infrastructure
```

## Drift Detection

```python
# scripts/drift_detection.py
import subprocess
import json
from datetime import datetime
import requests

def detect_drift(workspace_dir: str) -> dict:
    """Detect configuration drift"""

    # Run terraform plan
    result = subprocess.run(
        ["terraform", "plan", "-detailed-exitcode", "-json", "-out=drift.tfplan"],
        cwd=workspace_dir,
        capture_output=True,
        text=True
    )

    # Exit code 0 = no changes, 1 = error, 2 = changes detected
    drift_detected = result.returncode == 2

    # Parse plan for details
    plan_result = subprocess.run(
        ["terraform", "show", "-json", "drift.tfplan"],
        cwd=workspace_dir,
        capture_output=True,
        text=True
    )

    plan_data = json.loads(plan_result.stdout)

    changes = []
    for change in plan_data.get("resource_changes", []):
        if change["change"]["actions"] != ["no-op"]:
            changes.append({
                "address": change["address"],
                "actions": change["change"]["actions"],
                "before": change["change"].get("before"),
                "after": change["change"].get("after")
            })

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "drift_detected": drift_detected,
        "changes": changes
    }

def report_drift(drift_result: dict):
    """Report drift to monitoring system"""
    if not drift_result["drift_detected"]:
        return

    # Send to Azure Monitor
    # Send alert
    webhook_url = os.environ.get("DRIFT_ALERT_WEBHOOK")
    if webhook_url:
        requests.post(webhook_url, json={
            "text": f"Infrastructure drift detected!\n{json.dumps(drift_result, indent=2)}"
        })
```

## Key IaC Practices for 2021

1. **Everything in Git**: No manual changes, ever
2. **Test Your Infrastructure**: Unit tests, integration tests, policy tests
3. **Modularize**: Reusable, versioned modules
4. **Detect Drift**: Automated drift detection and remediation
5. **Self-Service**: Enable teams to provision within guardrails

IaC maturity in 2021 meant treating infrastructure code with the same rigor as application code. The tools support it; the discipline makes it work.

## Resources

- [Terraform Best Practices](https://www.terraform-best-practices.com/)
- [Bicep Documentation](https://docs.microsoft.com/en-us/azure/azure-resource-manager/bicep/)
- [Infrastructure Testing](https://terratest.gruntwork.io/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
