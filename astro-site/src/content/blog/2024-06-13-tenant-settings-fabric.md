---
title: "Tenant Settings in Microsoft Fabric"
description: "Tenant settings control what users can do in your Fabric environment. Today I'm covering the essential settings every admin should configure."
author: Michael John Peña
draft: false
date: 2024-06-13
tags:
  - Microsoft Fabric
  - Tenant Settings
  - Governance
  - Security
  - Configuration
---

Tenant settings control what users can do in your Fabric environment. Today I'm covering the essential settings every admin should configure.

## Tenant Settings Categories

```
Tenant Settings:
├── Export and Sharing
├── Content Pack and App
├── Integration
├── R and Python Visuals
├── Audit and Usage
├── Dashboard
├── Developer
├── Admin API
├── Dataflow
├── Template App
├── Q&A
├── Semantic Model
├── Data Science
├── OneLake
└── Copilot
```

## Critical Security Settings

### Export Controls

```python
# Using Admin API to configure export settings
export_settings = [
    {
        "name": "AllowExternalDataSharing",
        "enabled": False,
        "delegated_to_groups": False,
        "description": "Block external data sharing by default"
    },
    {
        "name": "ExportToExcel",
        "enabled": True,
        "enabled_groups": ["data-analysts-sg"],
        "description": "Allow Excel export for analysts only"
    },
    {
        "name": "ExportToCsv",
        "enabled": True,
        "enabled_groups": ["data-analysts-sg"],
        "description": "Allow CSV export for analysts only"
    },
    {
        "name": "PrintDashboards",
        "enabled": True,
        "description": "Allow printing - low risk"
    },
    {
        "name": "PublishToWeb",
        "enabled": False,
        "description": "Disable public embedding"
    }
]

for setting in export_settings:
    admin_client.tenant_settings.update(
        setting_name=setting["name"],
        enabled=setting["enabled"],
        enabled_security_groups=setting.get("enabled_groups", [])
    )
```

### Sharing Settings

```python
sharing_settings = {
    # External sharing
    "AllowExternalGuestSharing": {
        "enabled": True,
        "enabled_groups": ["external-collaborators-sg"],
        "excluded_groups": ["restricted-data-sg"]
    },

    # Link sharing
    "AllowShareableLinkGeneration": {
        "enabled": True,
        "enabled_groups": ["all-users"],
        "link_types_allowed": ["organization", "specific_people"]
        # Exclude "anyone" links
    },

    # Discover content
    "AllowDiscoverableContent": {
        "enabled": True,
        "description": "Allow content to be discoverable in search"
    }
}
```

## Developer Settings

```python
developer_settings = {
    # API access
    "AllowServicePrincipalToUseAPI": {
        "enabled": True,
        "enabled_groups": ["service-principals-sg"],
        "description": "Allow automation via service principals"
    },

    # Embedding
    "DeveloperEmbed": {
        "enabled": True,
        "enabled_groups": ["developers-sg"],
        "description": "Allow embedding in custom apps"
    },

    # Custom visuals
    "AllowCustomVisuals": {
        "enabled": True,
        "enabled_groups": ["power-bi-developers-sg"],
        "restrictions": {
            "certified_only": True,
            "organizational_only": False
        }
    },

    # Python and R
    "AllowPythonVisuals": {
        "enabled": True,
        "enabled_groups": ["data-scientists-sg"]
    },
    "AllowRVisuals": {
        "enabled": True,
        "enabled_groups": ["data-scientists-sg"]
    }
}
```

## Integration Settings

```python
integration_settings = {
    # Azure integration
    "AzureServiceBusIntegration": {
        "enabled": True,
        "enabled_groups": ["integration-team-sg"]
    },

    # Power Platform
    "PowerPlatformIntegration": {
        "enabled": True,
        "enabled_groups": ["all-users"],
        "allowed_connectors": ["SharePoint", "Teams", "Outlook"]
    },

    # GitHub/Azure DevOps
    "GitIntegration": {
        "enabled": True,
        "enabled_groups": ["developers-sg"],
        "allowed_providers": ["AzureDevOps", "GitHub"]
    },

    # External tools
    "AllowExternalTools": {
        "enabled": True,
        "enabled_groups": ["power-users-sg"],
        "allowed_tools": ["Tabular Editor", "DAX Studio", "ALM Toolkit"]
    }
}
```

## Copilot Settings

```python
copilot_settings = {
    # Copilot availability
    "CopilotEnabled": {
        "enabled": True,
        "enabled_groups": ["copilot-users-sg"],
        "description": "Enable Copilot features"
    },

    # Data sent to AI
    "AllowCopilotDataToAI": {
        "enabled": True,
        "enabled_groups": ["copilot-users-sg"],
        "excluded_groups": ["confidential-data-handlers-sg"],
        "description": "Allow data to be processed by AI"
    },

    # Copilot by workload
    "CopilotInNotebooks": {
        "enabled": True,
        "enabled_groups": ["data-engineers-sg"]
    },
    "CopilotInSQL": {
        "enabled": True,
        "enabled_groups": ["data-analysts-sg"]
    },
    "CopilotInPowerBI": {
        "enabled": True,
        "enabled_groups": ["report-creators-sg"]
    }
}
```

## OneLake Settings

```python
onelake_settings = {
    # External access
    "OneLakeExternalAccess": {
        "enabled": True,
        "enabled_groups": ["data-engineers-sg"],
        "description": "Allow OneLake access from external tools"
    },

    # Shortcuts
    "OneLakeShortcuts": {
        "enabled": True,
        "allowed_sources": ["ADLS Gen2", "S3", "OneLake"],
        "require_approval": True
    },

    # Mirroring
    "DatabaseMirroring": {
        "enabled": True,
        "enabled_groups": ["data-platform-sg"],
        "allowed_sources": ["Azure SQL", "Cosmos DB", "Snowflake"]
    }
}
```

## Audit Settings

```python
audit_settings = {
    # Audit logging
    "UsageMetrics": {
        "enabled": True,
        "retention_days": 90
    },

    "AuditLogRetention": {
        "enabled": True,
        "retention_days": 365,
        "export_to_storage": {
            "enabled": True,
            "storage_account": "fabrictauditlogs",
            "container": "audit-logs"
        }
    },

    # Activity tracking
    "TrackUserActivities": {
        "enabled": True,
        "include_content_names": True,
        "include_user_info": True
    }
}
```

## Implementation Script

```python
from azure.identity import DefaultAzureCredential
from typing import Dict, Any
import requests
import json

class TenantConfigurationManager:
    def __init__(self):
        credential = DefaultAzureCredential()
        self.token = credential.get_token("https://api.fabric.microsoft.com/.default").token
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        self.admin_url = "https://api.fabric.microsoft.com/v1/admin"

    def get_tenant_settings(self) -> Dict[str, Any]:
        """Get current tenant settings."""
        response = requests.get(f"{self.admin_url}/tenantsettings", headers=self.headers)
        return response.json()

    def update_tenant_setting(self, setting_name: str, config: Dict[str, Any]) -> Dict:
        """Update a specific tenant setting."""
        payload = {
            "settingName": setting_name,
            **config
        }
        response = requests.patch(
            f"{self.admin_url}/tenantsettings",
            headers=self.headers,
            json=payload
        )
        return response.json() if response.status_code == 200 else {"error": response.text}

    def apply_configuration(self, config: Dict[str, Any]) -> Dict:
        """Apply a complete tenant configuration."""
        results = {"success": [], "failed": []}

        for setting_name, setting_config in config.items():
            try:
                result = self.update_tenant_setting(setting_name, setting_config)
                if "error" not in result:
                    results["success"].append(setting_name)
                else:
                    results["failed"].append({"setting": setting_name, "error": result["error"]})
            except Exception as e:
                results["failed"].append({"setting": setting_name, "error": str(e)})

        return results

    def export_configuration(self) -> Dict[str, Any]:
        """Export current tenant configuration."""
        settings = self.get_tenant_settings()
        return settings.get("tenantSettings", [])

# Usage
manager = TenantConfigurationManager()

# Get current settings
current_settings = manager.export_configuration()
print(f"Found {len(current_settings)} tenant settings")

# Apply security-focused configuration
security_config = {
    "PublishToWeb": {"enabled": False},
    "AllowExternalDataSharing": {"enabled": False}
}

results = manager.apply_configuration(security_config)
print(f"Applied {len(results['success'])} settings successfully")
```

## Configuration as Code

```yaml
# tenant-config.yaml
version: "1.0"
description: "Production tenant configuration"

security:
  export:
    publish_to_web: false
    export_excel:
      enabled: true
      groups: ["data-analysts"]
    export_csv:
      enabled: true
      groups: ["data-analysts"]

  sharing:
    external_sharing:
      enabled: true
      groups: ["external-collaborators"]
      excluded: ["confidential-handlers"]
    shareable_links:
      enabled: true
      types: ["organization", "specific_people"]

  copilot:
    enabled: true
    groups: ["copilot-users"]
    exclude_confidential: true

developer:
  service_principals:
    enabled: true
    groups: ["automation-sg"]
  embedding:
    enabled: true
    groups: ["developers"]
  git_integration:
    enabled: true
    providers: ["AzureDevOps", "GitHub"]

audit:
  enabled: true
  retention_days: 365
  export_to_storage: true
```

## Best Practices

1. **Principle of least privilege** - Enable only what's needed
2. **Use security groups** - Not individual users
3. **Document decisions** - Record why settings are configured
4. **Regular review** - Audit settings quarterly
5. **Test changes** - Use test tenant first

## What's Next

Tomorrow I'll cover workspace governance.

## Resources

- [Tenant Settings](https://learn.microsoft.com/fabric/admin/tenant-settings-index)
- [Security Best Practices](https://learn.microsoft.com/fabric/security/)
- [Admin Portal Guide](https://learn.microsoft.com/fabric/admin/admin-center)
