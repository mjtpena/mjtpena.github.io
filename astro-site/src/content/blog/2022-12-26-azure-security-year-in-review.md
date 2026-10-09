---
title: "Azure Security: A Year in Review"
author: Michael John Peña
draft: false
date: 2022-12-26
tags:
  - Azure
  - Security
  - Year in Review
  - Best Practices
  - Microsoft Defender
---

## Major Security Releases in 2022

### Microsoft Defender for Cloud

```yaml
defender_cloud_2022:
  new_features:
    - Defender CSPM (Cloud Security Posture Management)
    - Attack path analysis
    - Cloud security graph
    - Agentless scanning for VMs
    - Defender for DevOps
    - Governance capabilities

  enhanced_workload_protection:
    - Defender for Containers improvements
    - Defender for Storage malware scanning
    - Defender for Azure Cosmos DB
    - Defender for Resource Manager

  compliance:
    - New regulatory compliance standards
    - Custom recommendations
    - Continuous export to Event Hub
```

## Zero Trust Implementation

```python
from dataclasses import dataclass
from typing import List, Dict
from enum import Enum

class TrustLevel(Enum):
    NONE = 0
    LOW = 1
    MEDIUM = 2
    HIGH = 3

@dataclass
class ZeroTrustAssessment:
    identity_score: float
    device_score: float
    network_score: float
    application_score: float
    data_score: float

    @property
    def overall_score(self) -> float:
        weights = {
            "identity": 0.25,
            "device": 0.20,
            "network": 0.15,
            "application": 0.20,
            "data": 0.20
        }
        return (
            self.identity_score * weights["identity"] +
            self.device_score * weights["device"] +
            self.network_score * weights["network"] +
            self.application_score * weights["application"] +
            self.data_score * weights["data"]
        )

    def get_recommendations(self) -> List[str]:
        recommendations = []

        if self.identity_score < 0.7:
            recommendations.extend([
                "Enable MFA for all users",
                "Implement Conditional Access policies",
                "Deploy Privileged Identity Management",
                "Enable risk-based sign-in policies"
            ])

        if self.device_score < 0.7:
            recommendations.extend([
                "Require device compliance",
                "Implement Microsoft Intune",
                "Enable device health attestation",
                "Deploy endpoint detection and response"
            ])

        if self.network_score < 0.7:
            recommendations.extend([
                "Implement network segmentation",
                "Deploy Azure Firewall Premium",
                "Enable DDoS Protection",
                "Use Private Endpoints"
            ])

        if self.application_score < 0.7:
            recommendations.extend([
                "Implement API Management",
                "Use Azure Front Door with WAF",
                "Enable application-level encryption",
                "Deploy Defender for App Service"
            ])

        if self.data_score < 0.7:
            recommendations.extend([
                "Enable Azure Information Protection",
                "Implement data classification",
                "Use customer-managed keys",
                "Enable soft delete and versioning"
            ])

        return recommendations

def assess_zero_trust_maturity(subscription_id: str) -> ZeroTrustAssessment:
    """Assess Zero Trust implementation maturity."""

    # In production, these would query actual Azure resources
    assessment = ZeroTrustAssessment(
        identity_score=evaluate_identity_controls(subscription_id),
        device_score=evaluate_device_controls(subscription_id),
        network_score=evaluate_network_controls(subscription_id),
        application_score=evaluate_application_controls(subscription_id),
        data_score=evaluate_data_controls(subscription_id)
    )

    return assessment
```

## Security Automation

```python
from azure.mgmt.security import SecurityCenter
from azure.identity import DefaultAzureCredential

class SecurityAutomation:
    def __init__(self, subscription_id: str):
        credential = DefaultAzureCredential()
        self.client = SecurityCenter(credential, subscription_id)
        self.subscription_id = subscription_id

    def create_security_automation(
        self,
        name: str,
        resource_group: str,
        trigger_severity: str,
        action_type: str,
        action_target: str
    ):
        """Create automated response to security alerts."""

        automation = {
            "location": "global",
            "properties": {
                "description": f"Auto-respond to {trigger_severity} alerts",
                "isEnabled": True,
                "scopes": [
                    {
                        "scopePath": f"/subscriptions/{self.subscription_id}"
                    }
                ],
                "sources": [
                    {
                        "eventSource": "Alerts",
                        "ruleSets": [
                            {
                                "rules": [
                                    {
                                        "propertyJPath": "Severity",
                                        "propertyType": "String",
                                        "expectedValue": trigger_severity,
                                        "operator": "Equals"
                                    }
                                ]
                            }
                        ]
                    }
                ],
                "actions": [
                    {
                        "actionType": action_type,
                        "logicAppResourceId": action_target if action_type == "LogicApp" else None,
                        "uri": action_target if action_type == "EventHub" else None
                    }
                ]
            }
        }

        return self.client.automations.create_or_update(
            resource_group,
            name,
            automation
        )

    def get_security_score(self) -> Dict:
        """Get current security score and recommendations."""

        secure_scores = list(self.client.secure_scores.list())

        results = []
        for score in secure_scores:
            controls = list(
                self.client.secure_score_controls.list_by_secure_score(
                    score.name
                )
            )

            results.append({
                "name": score.name,
                "current_score": score.current_score,
                "max_score": score.max_score,
                "percentage": score.percentage,
                "controls": [
                    {
                        "name": c.display_name,
                        "current": c.current_score,
                        "max": c.max_score,
                        "healthy_resources": c.healthy_resource_count,
                        "unhealthy_resources": c.unhealthy_resource_count
                    }
                    for c in controls
                ]
            })

        return results
```

## Key Vault Best Practices

```bicep
// Secure Key Vault deployment
resource keyVault 'Microsoft.KeyVault/vaults@2022-07-01' = {
  name: 'kv-${environment}-${uniqueString(resourceGroup().id)}'
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'premium'  // HSM-backed keys
    }
    tenantId: tenant().tenantId

    // Network security
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      ipRules: [
        {
          value: allowedIpRange
        }
      ]
      virtualNetworkRules: [
        {
          id: subnet.id
        }
      ]
    }

    // Access configuration
    enableRbacAuthorization: true  // Use RBAC instead of access policies
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true

    // Security features
    enabledForDeployment: false
    enabledForDiskEncryption: true
    enabledForTemplateDeployment: false

    publicNetworkAccess: 'Disabled'  // Private endpoint only
  }
}

// Private endpoint for Key Vault
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2022-07-01' = {
  name: 'pe-${keyVault.name}'
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'kv-connection'
        properties: {
          privateLinkServiceId: keyVault.id
          groupIds: ['vault']
        }
      }
    ]
  }
}

// Diagnostic settings
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'kv-diagnostics'
  scope: keyVault
  properties: {
    workspaceId: logAnalyticsWorkspace.id
    logs: [
      {
        category: 'AuditEvent'
        enabled: true
        retentionPolicy: {
          enabled: true
          days: 365
        }
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
        retentionPolicy: {
          enabled: true
          days: 365
        }
      }
    ]
  }
}
```

## Security Lessons from 2022

```yaml
security_lessons_2022:
  supply_chain_security:
    lesson: "Software supply chain attacks increased significantly"
    actions:
      - Implement SBOM (Software Bill of Materials)
      - Use signed container images
      - Enable GitHub Advanced Security
      - Scan dependencies with Dependabot

  identity_attacks:
    lesson: "Identity remains the primary attack vector"
    actions:
      - Require phishing-resistant MFA
      - Implement Conditional Access
      - Monitor for impossible travel
      - Enable Identity Protection

  api_security:
    lesson: "API vulnerabilities are increasingly exploited"
    actions:
      - Implement API Management
      - Use OAuth 2.0 properly
      - Rate limit all endpoints
      - Validate all inputs

  ransomware:
    lesson: "Ransomware continues to evolve"
    actions:
      - Implement immutable backups
      - Use Azure Backup with soft delete
      - Enable Defender for Storage
      - Practice recovery procedures
```

## Security Checklist for 2023

```python
security_checklist_2023 = {
    "identity": [
        "Passwordless authentication rollout",
        "Phishing-resistant MFA (FIDO2, Windows Hello)",
        "Continuous access evaluation",
        "Workload identity for service accounts"
    ],

    "data": [
        "Data classification and labeling",
        "Customer-managed keys for sensitive data",
        "Confidential computing for high-security workloads",
        "Data loss prevention policies"
    ],

    "network": [
        "Private endpoints for all PaaS services",
        "Azure Firewall Premium with IDPS",
        "Web Application Firewall 2.0",
        "DDoS Protection Standard"
    ],

    "applications": [
        "Defender for DevOps integration",
        "Container image signing",
        "API security scanning",
        "Runtime application self-protection"
    ],

    "operations": [
        "Security automation with Logic Apps",
        "SOAR integration",
        "Threat intelligence feeds",
        "Regular penetration testing"
    ]
}
```

## Conclusion

2022 brought significant security advancements in Azure, from Defender for Cloud improvements to enhanced Zero Trust capabilities. As we move into 2023, focus on identity-first security, assume breach mentality, and automate security responses. The threat landscape will continue to evolve, but so will our defenses.

## Resources

- [Microsoft Defender for Cloud](https://docs.microsoft.com/azure/defender-for-cloud/)
- [Zero Trust Security](https://docs.microsoft.com/security/zero-trust/)
- [Azure Security Best Practices](https://docs.microsoft.com/azure/security/fundamentals/best-practices-and-patterns)
