---
title: Securing Your Cloud Infrastructure with Azure Defender for Cloud
author: Michael John Peña
draft: false
date: 2021-02-05
url: /blog/azure-defender-for-cloud/
tags:
  - Azure
  - Security
  - Cloud Security
  - Azure Defender
  - DevSecOps

---

I wrote "2021-02-05-azure-defender-for-cloud" to share practical, production-minded guidance on this topic.

## Understanding Azure Defender

Azure Defender extends the capabilities of Azure Security Center by adding:

- **Advanced threat detection** using machine learning and behavioral analytics
- **Vulnerability assessment** for VMs, container registries, and SQL databases
- **Just-in-time VM access** to reduce attack surface
- **Adaptive application controls** to block malicious applications
- **Regulatory compliance dashboards** for standards like PCI-DSS, SOC, and ISO

## Enabling Azure Defender

Enable Azure Defender for your subscription:

```bash
# Enable Azure Defender for all resource types
az security pricing create \
    --name VirtualMachines \
    --tier Standard

az security pricing create \
    --name SqlServers \
    --tier Standard

az security pricing create \
    --name AppServices \
    --tier Standard

az security pricing create \
    --name StorageAccounts \
    --tier Standard

az security pricing create \
    --name KeyVaults \
    --tier Standard

az security pricing create \
    --name ContainerRegistry \
    --tier Standard

az security pricing create \
    --name KubernetesService \
    --tier Standard

# View current pricing tiers
az security pricing list --output table
```

## Security Posture Management

### Secure Score

Azure Defender calculates a secure score based on your security posture. Query your score programmatically:

```python
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://management.azure.com/.default")

subscription_id = "your-subscription-id"
url = f"https://management.azure.com/subscriptions/{subscription_id}/providers/Microsoft.Security/secureScores/ascScore?api-version=2020-01-01"

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

response = requests.get(url, headers=headers)
score_data = response.json()

print(f"Current Score: {score_data['properties']['score']['current']}")
print(f"Maximum Score: {score_data['properties']['score']['max']}")
print(f"Percentage: {score_data['properties']['score']['percentage']}%")
```

### Security Recommendations

Get and process security recommendations:

```python
def get_security_recommendations(subscription_id, token):
    """Retrieve all security recommendations."""
    url = f"https://management.azure.com/subscriptions/{subscription_id}/providers/Microsoft.Security/assessments?api-version=2020-01-01"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    response = requests.get(url, headers=headers)
    assessments = response.json()

    recommendations = []
    for assessment in assessments.get("value", []):
        props = assessment.get("properties", {})
        status = props.get("status", {})

        if status.get("code") == "Unhealthy":
            recommendations.append({
                "name": assessment.get("name"),
                "displayName": props.get("displayName"),
                "severity": props.get("metadata", {}).get("severity"),
                "resourceId": assessment.get("id"),
                "remediation": props.get("metadata", {}).get("remediationDescription")
            })

    return recommendations

# Usage
recommendations = get_security_recommendations(subscription_id, token.token)

print("Unhealthy Assessments:")
for rec in recommendations:
    print(f"\n[{rec['severity']}] {rec['displayName']}")
    print(f"Remediation: {rec['remediation'][:200]}...")
```

## Just-in-Time VM Access

JIT VM access reduces exposure to attacks by enabling access only when needed:

```bash
# Enable JIT on a VM
az security jit-policy create \
    --resource-group myResourceGroup \
    --location eastus \
    --name default \
    --virtual-machines '[{
        "id": "/subscriptions/{sub-id}/resourceGroups/myResourceGroup/providers/Microsoft.Compute/virtualMachines/myVM",
        "ports": [{
            "number": 22,
            "protocol": "TCP",
            "allowedSourceAddressPrefix": "*",
            "maxRequestAccessDuration": "PT3H"
        }, {
            "number": 3389,
            "protocol": "TCP",
            "allowedSourceAddressPrefix": "*",
            "maxRequestAccessDuration": "PT3H"
        }]
    }]'

# Request JIT access
az security jit-request create \
    --resource-group myResourceGroup \
    --location eastus \
    --name default \
    --vm-name myVM \
    --port 22 \
    --duration PT1H \
    --source-ip "203.0.113.10"
```

## Adaptive Application Controls

Configure adaptive application controls using PowerShell:

```powershell
# Get recommended application control groups
$recommendations = Get-AzSecurityAdaptiveApplicationControl

foreach ($group in $recommendations) {
    Write-Host "Group: $($group.GroupName)"
    Write-Host "VMs: $($group.VmRecommendations.Count)"

    foreach ($rule in $group.PathRecommendations) {
        Write-Host "  Path: $($rule.Path)"
        Write-Host "  Publisher: $($rule.Publisher)"
        Write-Host "  Action: $($rule.Action)"
    }
}

# Apply recommended rules
$group = $recommendations[0]
$group.EnforcementMode = "Enforce"

Set-AzSecurityAdaptiveApplicationControl -AdaptiveApplicationControlGroup $group
```

## Container Security

Azure Defender for Container Registries scans images for vulnerabilities:

```bash
# Enable scanning for a container registry
az acr update \
    --name myContainerRegistry \
    --resource-group myResourceGroup \
    --enable-security-scanning true

# View scan results
az acr repository show-manifests \
    --name myContainerRegistry \
    --repository myapp \
    --detail

# Query vulnerability findings
az security sub-assessment list \
    --assessed-resource-id "/subscriptions/{sub-id}/resourceGroups/myResourceGroup/providers/Microsoft.ContainerRegistry/registries/myContainerRegistry" \
    --output table
```

Integrate vulnerability scanning into your CI/CD pipeline:

```yaml
# azure-pipelines.yml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
- task: Docker@2
  inputs:
    containerRegistry: 'myACRConnection'
    repository: 'myapp'
    command: 'buildAndPush'
    Dockerfile: '**/Dockerfile'
    tags: '$(Build.BuildId)'

- task: AzureCLI@2
  displayName: 'Wait for vulnerability scan'
  inputs:
    azureSubscription: 'MyAzureSubscription'
    scriptType: 'bash'
    scriptLocation: 'inlineScript'
    inlineScript: |
      # Wait for scan to complete
      sleep 60

      # Get scan results
      VULNERABILITIES=$(az security sub-assessment list \
        --assessed-resource-id "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME" \
        --query "[?contains(id, '$(Build.BuildId)')].properties.status.severity" \
        -o tsv)

      # Fail if high severity vulnerabilities found
      if echo "$VULNERABILITIES" | grep -q "High"; then
        echo "High severity vulnerabilities found!"
        exit 1
      fi
```

## Security Alerts and Automation

Set up automated responses to security alerts:

```python
# Azure Function to handle security alerts
import logging
import azure.functions as func
from azure.mgmt.compute import ComputeManagementClient
from azure.identity import DefaultAzureCredential

def main(event: func.EventGridEvent):
    """Handle Azure Defender security alerts."""

    alert_data = event.get_json()

    alert_name = alert_data.get("alertName")
    severity = alert_data.get("severity")
    resource_id = alert_data.get("resourceIdentifiers", [{}])[0].get("azureResourceId")

    logging.info(f"Security Alert: {alert_name}")
    logging.info(f"Severity: {severity}")
    logging.info(f"Resource: {resource_id}")

    # Auto-remediation for specific alerts
    if severity == "High":
        if "Suspicious process executed" in alert_name:
            # Isolate the VM
            isolate_vm(resource_id)
        elif "Brute force attack" in alert_name:
            # Enable JIT access
            enable_jit_access(resource_id)

    # Send notification
    send_teams_notification(alert_data)

def isolate_vm(resource_id):
    """Isolate a VM by removing network connectivity."""
    credential = DefaultAzureCredential()

    # Parse resource ID
    parts = resource_id.split("/")
    subscription_id = parts[2]
    resource_group = parts[4]
    vm_name = parts[8]

    compute_client = ComputeManagementClient(credential, subscription_id)

    # Get VM
    vm = compute_client.virtual_machines.get(resource_group, vm_name)

    # Remove all NICs (emergency isolation)
    logging.warning(f"Isolating VM: {vm_name}")

    # In production, you'd want to:
    # 1. Apply NSG rules to block traffic
    # 2. Take a snapshot for forensics
    # 3. Create incident ticket

def enable_jit_access(resource_id):
    """Enable JIT access policy for a VM."""
    logging.info(f"Enabling JIT for: {resource_id}")
    # Implementation using Azure Security Center API

def send_teams_notification(alert_data):
    """Send alert to Microsoft Teams."""
    import requests

    webhook_url = "https://outlook.office.com/webhook/..."

    message = {
        "@type": "MessageCard",
        "themeColor": "FF0000" if alert_data.get("severity") == "High" else "FFA500",
        "summary": f"Security Alert: {alert_data.get('alertName')}",
        "sections": [{
            "activityTitle": alert_data.get("alertName"),
            "facts": [
                {"name": "Severity", "value": alert_data.get("severity")},
                {"name": "Status", "value": alert_data.get("status")},
                {"name": "Time", "value": alert_data.get("startTimeUtc")}
            ]
        }]
    }

    requests.post(webhook_url, json=message)
```

## Regulatory Compliance

Monitor compliance against regulatory standards:

```bash
# View available compliance standards
az security regulatory-compliance-standards list --output table

# Get compliance state for a specific standard
az security regulatory-compliance-assessments list \
    --standard-name "Azure-CIS-1.1.0" \
    --output table

# Export compliance report
az security regulatory-compliance-standards show \
    --name "PCI-DSS-3.2.1" \
    --query "{
        Standard: name,
        State: properties.state,
        PassedControls: properties.passedControls,
        FailedControls: properties.failedControls
    }"
```

## Log Analytics Integration

Query security data in Log Analytics:

```kusto
// High severity security alerts in last 24 hours
SecurityAlert
| where TimeGenerated > ago(24h)
| where AlertSeverity == "High"
| summarize Count = count() by AlertName, ResourceId
| order by Count desc

// Failed login attempts
SecurityEvent
| where TimeGenerated > ago(1h)
| where EventID == 4625  // Failed logon
| summarize FailedAttempts = count() by Account, Computer, IpAddress
| where FailedAttempts > 10
| order by FailedAttempts desc

// Suspicious process executions
SecurityAlert
| where AlertName contains "process"
| extend ProcessName = tostring(parse_json(ExtendedProperties).["Process Name"])
| extend CommandLine = tostring(parse_json(ExtendedProperties).["Command Line"])
| project TimeGenerated, Computer, ProcessName, CommandLine, AlertSeverity
```

## Conclusion

Azure Defender for Cloud provides comprehensive security for your Azure and hybrid environments. Key takeaways:

- Enable Azure Defender on critical workloads
- Regularly review and act on security recommendations
- Implement JIT access for VMs
- Integrate container scanning into CI/CD
- Automate response to high-severity alerts
- Monitor compliance continuously

Security is a journey, not a destination. Use Azure Defender as your foundation for a robust cloud security posture.

