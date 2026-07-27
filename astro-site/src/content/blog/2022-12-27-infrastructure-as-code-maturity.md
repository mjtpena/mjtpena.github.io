---
title: "Infrastructure as Code Maturity: Where Are You on the Journey?"
author: Michael John Peña
draft: false
date: 2022-12-27
tags:
  - Azure
  - Infrastructure as Code
  - DevOps
  - Bicep
  - Terraform

---

I wrote "Infrastructure as Code Maturity: Where Are You on the Journey?" to share practical, production-minded guidance on this topic.

## IaC Maturity Model

```python
from dataclasses import dataclass
from enum import Enum
from typing import List, Dict

class IaCMaturityLevel(Enum):
    MANUAL = 1          # Click-ops, portal deployments
    SCRIPTED = 2        # Basic scripts, some automation
    DECLARATIVE = 3     # Bicep/Terraform, proper IaC
    MODULAR = 4         # Reusable modules, patterns
    OPTIMIZED = 5       # Full GitOps, policy-as-code

@dataclass
class MaturityAssessment:
    level: IaCMaturityLevel
    score: float
    strengths: List[str]
    gaps: List[str]
    recommendations: List[str]

def assess_iac_maturity(responses: Dict) -> MaturityAssessment:
    """Assess organization's IaC maturity level."""

    criteria = {
        "version_control": {
            "question": "Is all infrastructure code in version control?",
            "weight": 1.0,
            "level_requirement": IaCMaturityLevel.SCRIPTED
        },
        "declarative": {
            "question": "Do you use declarative IaC (Bicep/Terraform)?",
            "weight": 1.0,
            "level_requirement": IaCMaturityLevel.DECLARATIVE
        },
        "modules": {
            "question": "Do you use reusable modules?",
            "weight": 0.8,
            "level_requirement": IaCMaturityLevel.MODULAR
        },
        "testing": {
            "question": "Do you test infrastructure code?",
            "weight": 0.8,
            "level_requirement": IaCMaturityLevel.MODULAR
        },
        "ci_cd": {
            "question": "Is IaC deployed through CI/CD pipelines?",
            "weight": 1.0,
            "level_requirement": IaCMaturityLevel.DECLARATIVE
        },
        "environments": {
            "question": "Are all environments deployed from same code?",
            "weight": 0.9,
            "level_requirement": IaCMaturityLevel.DECLARATIVE
        },
        "drift_detection": {
            "question": "Do you detect and remediate configuration drift?",
            "weight": 0.7,
            "level_requirement": IaCMaturityLevel.OPTIMIZED
        },
        "policy_as_code": {
            "question": "Do you enforce policies as code?",
            "weight": 0.8,
            "level_requirement": IaCMaturityLevel.OPTIMIZED
        },
        "gitops": {
            "question": "Do you practice GitOps for all changes?",
            "weight": 0.7,
            "level_requirement": IaCMaturityLevel.OPTIMIZED
        },
        "documentation": {
            "question": "Is infrastructure self-documenting?",
            "weight": 0.5,
            "level_requirement": IaCMaturityLevel.MODULAR
        }
    }

    score = sum(
        responses.get(key, 0) * criteria[key]["weight"]
        for key in criteria
    ) / sum(c["weight"] for c in criteria.values())

    # Determine level based on score and requirements
    if score >= 0.9:
        level = IaCMaturityLevel.OPTIMIZED
    elif score >= 0.7:
        level = IaCMaturityLevel.MODULAR
    elif score >= 0.5:
        level = IaCMaturityLevel.DECLARATIVE
    elif score >= 0.3:
        level = IaCMaturityLevel.SCRIPTED
    else:
        level = IaCMaturityLevel.MANUAL

    # Generate recommendations based on gaps
    gaps = [
        criteria[key]["question"]
        for key, value in responses.items()
        if value < 0.5
    ]

    recommendations = generate_recommendations(level, gaps)

    return MaturityAssessment(
        level=level,
        score=score,
        strengths=[k for k, v in responses.items() if v >= 0.8],
        gaps=gaps,
        recommendations=recommendations
    )
```

## Level 1 to 2: From Manual to Scripted

```powershell
# Moving from portal to scripts
# Before: Click in portal
# After: PowerShell/Azure CLI scripts

# Example: Resource group and storage creation script
param(
    [Parameter(Mandatory=$true)]
    [string]$Environment,

    [Parameter(Mandatory=$true)]
    [string]$Location,

    [string]$ResourceGroupName = "rg-$Environment-storage"
)

# Create resource group
az group create `
    --name $ResourceGroupName `
    --location $Location `
    --tags Environment=$Environment ManagedBy=Script

# Create storage account
$storageAccountName = "st$Environment$(Get-Random -Maximum 9999)"

az storage account create `
    --name $storageAccountName `
    --resource-group $ResourceGroupName `
    --location $Location `
    --sku Standard_LRS `
    --kind StorageV2 `
    --min-tls-version TLS1_2 `
    --allow-blob-public-access false

Write-Host "Created storage account: $storageAccountName"
```

## Level 2 to 3: Embracing Declarative IaC

```bicep
// storage.bicep - Declarative infrastructure
@description('Environment name')
@allowed(['dev', 'test', 'prod'])
param environment string

@description('Azure region')
param location string = resourceGroup().location

@description('Tags to apply to all resources')
param tags object = {}

var storageAccountName = 'st${environment}${uniqueString(resourceGroup().id)}'

resource storageAccount 'Microsoft.Storage/storageAccounts@2022-09-01' = {
  name: storageAccountName
  location: location
  tags: union(tags, {
    Environment: environment
    ManagedBy: 'Bicep'
  })
  sku: {
    name: environment == 'prod' ? 'Standard_GRS' : 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
    encryption: {
      services: {
        blob: {
          enabled: true
        }
        file: {
          enabled: true
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2022-09-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: environment == 'prod' ? 30 : 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: environment == 'prod' ? 30 : 7
    }
  }
}

output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
```

## Level 3 to 4: Building Reusable Modules

```bicep
// modules/networking/vnet.bicep
@description('Virtual network name')
param name string

@description('Azure region')
param location string

@description('Address prefix for the VNet')
param addressPrefix string = '10.0.0.0/16'

@description('Subnet configurations')
param subnets array = []

@description('Enable DDoS protection')
param enableDdosProtection bool = false

@description('Tags')
param tags object = {}

resource vnet 'Microsoft.Network/virtualNetworks@2022-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [addressPrefix]
    }
    enableDdosProtection: enableDdosProtection
    subnets: [for subnet in subnets: {
      name: subnet.name
      properties: {
        addressPrefix: subnet.addressPrefix
        networkSecurityGroup: contains(subnet, 'nsgId') ? {
          id: subnet.nsgId
        } : null
        serviceEndpoints: contains(subnet, 'serviceEndpoints') ? subnet.serviceEndpoints : []
        delegations: contains(subnet, 'delegations') ? subnet.delegations : []
        privateEndpointNetworkPolicies: contains(subnet, 'privateEndpointNetworkPolicies')
          ? subnet.privateEndpointNetworkPolicies
          : 'Disabled'
      }
    }]
  }
}

output vnetId string = vnet.id
output vnetName string = vnet.name
output subnets array = [for (subnet, i) in subnets: {
  name: subnet.name
  id: vnet.properties.subnets[i].id
}]
```

```bicep
// main.bicep - Using modules
targetScope = 'subscription'

param environment string
param location string

// Resource group
resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: 'rg-${environment}-network'
  location: location
}

// Hub VNet using module
module hubVnet 'modules/networking/vnet.bicep' = {
  scope: rg
  name: 'hub-vnet-deployment'
  params: {
    name: 'vnet-hub-${environment}'
    location: location
    addressPrefix: '10.0.0.0/16'
    subnets: [
      {
        name: 'GatewaySubnet'
        addressPrefix: '10.0.0.0/24'
      }
      {
        name: 'AzureFirewallSubnet'
        addressPrefix: '10.0.1.0/24'
      }
      {
        name: 'snet-management'
        addressPrefix: '10.0.2.0/24'
      }
    ]
    enableDdosProtection: environment == 'prod'
    tags: {
      Environment: environment
      Purpose: 'Hub networking'
    }
  }
}

// Spoke VNets using same module
module spokeVnets 'modules/networking/vnet.bicep' = [for (spoke, index) in [
  { name: 'workload1', prefix: '10.1.0.0/16' }
  { name: 'workload2', prefix: '10.2.0.0/16' }
]: {
  scope: rg
  name: 'spoke-${spoke.name}-deployment'
  params: {
    name: 'vnet-spoke-${spoke.name}-${environment}'
    location: location
    addressPrefix: spoke.prefix
    subnets: [
      {
        name: 'snet-app'
        addressPrefix: cidrSubnet(spoke.prefix, 24, 0)
      }
      {
        name: 'snet-data'
        addressPrefix: cidrSubnet(spoke.prefix, 24, 1)
      }
    ]
    tags: {
      Environment: environment
      Spoke: spoke.name
    }
  }
}]
```

## Level 4 to 5: GitOps and Policy as Code

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
  AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Lint Bicep
        run: |
          az bicep build --file infrastructure/main.bicep

      - name: What-If Analysis
        run: |
          az deployment sub what-if \
            --location eastus \
            --template-file infrastructure/main.bicep \
            --parameters infrastructure/parameters/dev.json

  deploy-dev:
    needs: validate
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: development
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Dev
        run: |
          az deployment sub create \
            --location eastus \
            --template-file infrastructure/main.bicep \
            --parameters infrastructure/parameters/dev.json \
            --name "deploy-$(date +%Y%m%d%H%M%S)"

      - name: Run Tests
        run: |
          ./scripts/test-infrastructure.sh dev

  deploy-prod:
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS_PROD }}

      - name: Deploy to Prod
        run: |
          az deployment sub create \
            --location eastus \
            --template-file infrastructure/main.bicep \
            --parameters infrastructure/parameters/prod.json \
            --name "deploy-$(date +%Y%m%d%H%M%S)"
```

```bicep
// Azure Policy as Code
resource policyDefinition 'Microsoft.Authorization/policyDefinitions@2021-06-01' = {
  name: 'require-tags-on-resources'
  properties: {
    displayName: 'Require specific tags on resources'
    description: 'Enforces required tags on all resources'
    policyType: 'Custom'
    mode: 'Indexed'
    parameters: {
      requiredTags: {
        type: 'Array'
        metadata: {
          description: 'List of required tags'
          displayName: 'Required Tags'
        }
        defaultValue: [
          'Environment'
          'Owner'
          'CostCenter'
        ]
      }
    }
    policyRule: {
      if: {
        anyOf: [for tag in ['Environment', 'Owner', 'CostCenter']: {
          field: 'tags[\'${tag}\']'
          exists: false
        }]
      }
      then: {
        effect: 'deny'
      }
    }
  }
}

resource policyAssignment 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'require-tags-assignment'
  properties: {
    policyDefinitionId: policyDefinition.id
    displayName: 'Require tags on all resources'
    enforcementMode: 'Default'
    parameters: {
      requiredTags: {
        value: [
          'Environment'
          'Owner'
          'CostCenter'
          'Application'
        ]
      }
    }
  }
}
```

## IaC Testing

```python
# tests/test_infrastructure.py
import pytest
from azure.identity import DefaultAzureCredential
from azure.mgmt.resource import ResourceManagementClient
from azure.mgmt.network import NetworkManagementClient

@pytest.fixture
def azure_clients():
    credential = DefaultAzureCredential()
    subscription_id = os.environ["AZURE_SUBSCRIPTION_ID"]

    return {
        "resource": ResourceManagementClient(credential, subscription_id),
        "network": NetworkManagementClient(credential, subscription_id)
    }

class TestNetworkInfrastructure:
    def test_vnet_exists(self, azure_clients, environment):
        """Verify VNet was created."""
        rg_name = f"rg-{environment}-network"
        vnet_name = f"vnet-hub-{environment}"

        vnet = azure_clients["network"].virtual_networks.get(
            rg_name, vnet_name
        )

        assert vnet is not None
        assert vnet.provisioning_state == "Succeeded"

    def test_vnet_address_space(self, azure_clients, environment):
        """Verify VNet has correct address space."""
        rg_name = f"rg-{environment}-network"
        vnet_name = f"vnet-hub-{environment}"

        vnet = azure_clients["network"].virtual_networks.get(
            rg_name, vnet_name
        )

        assert "10.0.0.0/16" in vnet.address_space.address_prefixes

    def test_required_subnets_exist(self, azure_clients, environment):
        """Verify required subnets exist."""
        rg_name = f"rg-{environment}-network"
        vnet_name = f"vnet-hub-{environment}"

        required_subnets = ["GatewaySubnet", "AzureFirewallSubnet"]

        subnets = azure_clients["network"].subnets.list(rg_name, vnet_name)
        subnet_names = [s.name for s in subnets]

        for required in required_subnets:
            assert required in subnet_names, f"Missing subnet: {required}"

    def test_ddos_protection(self, azure_clients, environment):
        """Verify DDoS protection in prod."""
        if environment != "prod":
            pytest.skip("DDoS only required in prod")

        rg_name = f"rg-{environment}-network"
        vnet_name = f"vnet-hub-{environment}"

        vnet = azure_clients["network"].virtual_networks.get(
            rg_name, vnet_name
        )

        assert vnet.enable_ddos_protection == True
```

## Conclusion

IaC maturity is a journey, not a destination. Start where you are, establish good practices early, and continuously improve. The goal is infrastructure that is repeatable, testable, and auditable. As you move up the maturity ladder, you'll see faster deployments, fewer incidents, and more confident changes.

## Resources

- [Bicep Documentation](https://docs.microsoft.com/azure/azure-resource-manager/bicep/)
- [Terraform Azure Provider](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs)
- [Azure DevOps Pipelines](https://docs.microsoft.com/azure/devops/pipelines/)
- [GitHub Actions for Azure](https://docs.microsoft.com/azure/developer/github/github-actions)

