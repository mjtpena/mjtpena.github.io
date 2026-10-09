---
title: "Power BI REST API: Automating Analytics Operations"
author: Michael John Peña
draft: false
date: 2022-04-24
tags:
  - Power BI
  - REST API
  - Automation
  - DevOps
  - Administration
---

## API Overview

```yaml
categories:
  admin: Tenant-wide operations
  datasets: Dataset management, refresh
  reports: Report operations
  groups: Workspace management
  gateways: Gateway administration
  imports: Content deployment
  embedTokens: Token generation
```

## Authentication

```python
import requests
from azure.identity import ClientSecretCredential

# Service principal authentication
credential = ClientSecretCredential(
    tenant_id="your-tenant-id",
    client_id="your-client-id",
    client_secret="your-client-secret"
)

token = credential.get_token("https://analysis.windows.net/powerbi/api/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

base_url = "https://api.powerbi.com/v1.0/myorg"
```

## Common Operations

### List Workspaces

```python
def list_workspaces():
    response = requests.get(
        f"{base_url}/groups",
        headers=headers
    )
    return response.json()["value"]

workspaces = list_workspaces()
for ws in workspaces:
    print(f"{ws['name']}: {ws['id']}")
```

### Trigger Dataset Refresh

```python
def refresh_dataset(workspace_id, dataset_id):
    response = requests.post(
        f"{base_url}/groups/{workspace_id}/datasets/{dataset_id}/refreshes",
        headers=headers
    )
    return response.status_code == 202

def get_refresh_history(workspace_id, dataset_id):
    response = requests.get(
        f"{base_url}/groups/{workspace_id}/datasets/{dataset_id}/refreshes",
        headers=headers
    )
    return response.json()["value"]
```

### Export Report

```python
def export_report(workspace_id, report_id, format="PDF"):
    # Start export
    response = requests.post(
        f"{base_url}/groups/{workspace_id}/reports/{report_id}/ExportTo",
        headers=headers,
        json={"format": format}
    )
    export_id = response.json()["id"]

    # Poll for completion
    while True:
        status_response = requests.get(
            f"{base_url}/groups/{workspace_id}/reports/{report_id}/exports/{export_id}",
            headers=headers
        )
        status = status_response.json()

        if status["status"] == "Succeeded":
            # Download file
            file_response = requests.get(
                f"{base_url}/groups/{workspace_id}/reports/{report_id}/exports/{export_id}/file",
                headers=headers
            )
            return file_response.content
        elif status["status"] == "Failed":
            raise Exception(f"Export failed: {status['error']}")

        time.sleep(5)
```

### Clone Report

```python
def clone_report(source_workspace, report_id, target_workspace, new_name):
    response = requests.post(
        f"{base_url}/groups/{source_workspace}/reports/{report_id}/Clone",
        headers=headers,
        json={
            "name": new_name,
            "targetWorkspaceId": target_workspace
        }
    )
    return response.json()
```

## Admin Operations

```python
# Requires Power BI Admin permissions

def get_activity_events(start_date, end_date):
    """Get audit log events"""
    response = requests.get(
        f"{base_url}/admin/activityevents",
        headers=headers,
        params={
            "startDateTime": start_date,
            "endDateTime": end_date
        }
    )
    return response.json()

def get_workspace_users(workspace_id):
    """Get all users in a workspace"""
    response = requests.get(
        f"{base_url}/admin/groups/{workspace_id}/users",
        headers=headers
    )
    return response.json()["value"]

def scan_workspace(workspace_id):
    """Get detailed metadata about workspace content"""
    # Start scan
    response = requests.post(
        f"{base_url}/admin/workspaces/getInfo",
        headers=headers,
        params={"lineage": True, "datasourceDetails": True},
        json={"workspaces": [workspace_id]}
    )
    scan_id = response.json()["id"]

    # Get results
    while True:
        result = requests.get(
            f"{base_url}/admin/workspaces/scanResult/{scan_id}",
            headers=headers
        )
        if result.status_code == 200:
            return result.json()
        time.sleep(2)
```

## Automation Example

```python
class PowerBIAutomation:
    def __init__(self, credential):
        self.headers = self._get_headers(credential)

    def daily_refresh_all_datasets(self, workspace_id):
        """Refresh all datasets in a workspace"""
        datasets = self._get_datasets(workspace_id)

        results = []
        for dataset in datasets:
            try:
                self.refresh_dataset(workspace_id, dataset["id"])
                results.append({"dataset": dataset["name"], "status": "triggered"})
            except Exception as e:
                results.append({"dataset": dataset["name"], "status": "failed", "error": str(e)})

        return results

    def backup_workspace(self, workspace_id, backup_path):
        """Export all reports from workspace"""
        reports = self._get_reports(workspace_id)

        for report in reports:
            pbix_content = self._export_pbix(workspace_id, report["id"])
            filename = f"{backup_path}/{report['name']}.pbix"
            with open(filename, "wb") as f:
                f.write(pbix_content)

    def migrate_workspace(self, source_workspace, target_workspace):
        """Migrate content between workspaces"""
        reports = self._get_reports(source_workspace)

        for report in reports:
            self.clone_report(
                source_workspace,
                report["id"],
                target_workspace,
                report["name"]
            )
```

## Error Handling

```python
def safe_api_call(func):
    def wrapper(*args, **kwargs):
        try:
            response = func(*args, **kwargs)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 429:
                # Rate limited - wait and retry
                retry_after = int(e.response.headers.get("Retry-After", 60))
                time.sleep(retry_after)
                return wrapper(*args, **kwargs)
            elif e.response.status_code == 401:
                raise AuthenticationError("Token expired or invalid")
            else:
                raise PowerBIAPIError(f"API error: {e.response.text}")
    return wrapper
```

## Best Practices

```yaml
authentication:
  - Use service principals for automation
  - Implement token caching
  - Handle token refresh

rate_limiting:
  - Respect Retry-After headers
  - Implement exponential backoff
  - Batch operations when possible

error_handling:
  - Log all API calls
  - Handle transient failures
  - Validate responses
```

## Conclusion

The Power BI REST API enables:
- Automated content deployment
- Scheduled refresh management
- Administrative automation
- Custom tooling and integrations

## Resources

- [REST API Reference](https://docs.microsoft.com/en-us/rest/api/power-bi/)
- [Admin API](https://docs.microsoft.com/en-us/rest/api/power-bi/admin)
