---
title: "Fabric REST APIs: Programmatic Control of Your Analytics Platform"
author: "Michael John Peña"
draft: false
date: 2024-04-08
tags: ["Microsoft Fabric", "REST API", "Automation", "Data", "Integration"]

---

I wrote "Fabric REST APIs: Programmatic Control of Your Analytics Platform" to share practical, production-minded guidance on this topic.

Microsoft Fabric's REST APIs enable automation and integration with your existing tools. This guide covers the key APIs and common use cases.

## API Overview

```python
from dataclasses import dataclass
from typing import Optional
import requests
from azure.identity import DefaultAzureCredential

@dataclass
class FabricAPIEndpoints:
    base_url: str = "https://api.fabric.microsoft.com/v1"
    workspaces: str = "/workspaces"
    items: str = "/workspaces/{workspace_id}/items"
    lakehouses: str = "/workspaces/{workspace_id}/lakehouses"
    notebooks: str = "/workspaces/{workspace_id}/notebooks"
    pipelines: str = "/workspaces/{workspace_id}/dataPipelines"
    semantic_models: str = "/workspaces/{workspace_id}/semanticModels"

class FabricClient:
    """Comprehensive Fabric REST API client"""

    def __init__(self):
        self.credential = DefaultAzureCredential()
        self.base_url = "https://api.fabric.microsoft.com/v1"
        self._token = None

    def _get_token(self) -> str:
        if self._token is None:
            token_response = self.credential.get_token(
                "https://api.fabric.microsoft.com/.default"
            )
            self._token = token_response.token
        return self._token

    def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> requests.Response:
        """Make authenticated request"""

        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {self._get_token()}"
        headers["Content-Type"] = "application/json"

        url = f"{self.base_url}{endpoint}"

        response = requests.request(
            method=method,
            url=url,
            headers=headers,
            **kwargs
        )

        if response.status_code >= 400:
            raise Exception(f"API Error: {response.status_code} - {response.text}")

        return response

    def get(self, endpoint: str, **kwargs) -> dict:
        return self._request("GET", endpoint, **kwargs).json()

    def post(self, endpoint: str, **kwargs) -> dict:
        return self._request("POST", endpoint, **kwargs).json()

    def patch(self, endpoint: str, **kwargs) -> dict:
        return self._request("PATCH", endpoint, **kwargs).json()

    def delete(self, endpoint: str, **kwargs) -> None:
        self._request("DELETE", endpoint, **kwargs)
```

## Workspace Management

```python
class WorkspaceAPI:
    """Manage Fabric workspaces"""

    def __init__(self, client: FabricClient):
        self.client = client

    def list_workspaces(self) -> list:
        """List all accessible workspaces"""
        response = self.client.get("/workspaces")
        return response.get("value", [])

    def get_workspace(self, workspace_id: str) -> dict:
        """Get workspace details"""
        return self.client.get(f"/workspaces/{workspace_id}")

    def create_workspace(
        self,
        display_name: str,
        description: str = "",
        capacity_id: Optional[str] = None
    ) -> dict:
        """Create a new workspace"""

        payload = {
            "displayName": display_name,
            "description": description
        }

        if capacity_id:
            payload["capacityId"] = capacity_id

        return self.client.post("/workspaces", json=payload)

    def update_workspace(
        self,
        workspace_id: str,
        display_name: Optional[str] = None,
        description: Optional[str] = None
    ) -> dict:
        """Update workspace properties"""

        payload = {}
        if display_name:
            payload["displayName"] = display_name
        if description:
            payload["description"] = description

        return self.client.patch(f"/workspaces/{workspace_id}", json=payload)

    def delete_workspace(self, workspace_id: str) -> None:
        """Delete a workspace"""
        self.client.delete(f"/workspaces/{workspace_id}")

    def assign_to_capacity(
        self,
        workspace_id: str,
        capacity_id: str
    ) -> dict:
        """Assign workspace to a capacity"""

        return self.client.post(
            f"/workspaces/{workspace_id}/assignToCapacity",
            json={"capacityId": capacity_id}
        )

# Usage
client = FabricClient()
workspaces = WorkspaceAPI(client)

# List workspaces
for ws in workspaces.list_workspaces():
    print(f"Workspace: {ws['displayName']} ({ws['id']})")

# Create workspace
new_ws = workspaces.create_workspace(
    display_name="Analytics Project",
    description="Project workspace for analytics team"
)
```

## Item Management

```python
class ItemAPI:
    """Manage Fabric items (notebooks, reports, etc.)"""

    def __init__(self, client: FabricClient, workspace_id: str):
        self.client = client
        self.workspace_id = workspace_id
        self.base_path = f"/workspaces/{workspace_id}"

    def list_items(self, item_type: Optional[str] = None) -> list:
        """List items in workspace"""

        endpoint = f"{self.base_path}/items"
        if item_type:
            endpoint += f"?type={item_type}"

        response = self.client.get(endpoint)
        return response.get("value", [])

    def get_item(self, item_id: str) -> dict:
        """Get item details"""
        return self.client.get(f"{self.base_path}/items/{item_id}")

    def create_item(
        self,
        display_name: str,
        item_type: str,
        definition: Optional[dict] = None
    ) -> dict:
        """Create a new item"""

        payload = {
            "displayName": display_name,
            "type": item_type
        }

        if definition:
            payload["definition"] = definition

        return self.client.post(f"{self.base_path}/items", json=payload)

    def update_item_definition(
        self,
        item_id: str,
        definition: dict
    ) -> dict:
        """Update item definition"""

        return self.client.post(
            f"{self.base_path}/items/{item_id}/updateDefinition",
            json={"definition": definition}
        )

    def delete_item(self, item_id: str) -> None:
        """Delete an item"""
        self.client.delete(f"{self.base_path}/items/{item_id}")

# Usage
items = ItemAPI(client, workspace_id="your-workspace-id")

# List notebooks
notebooks = items.list_items(item_type="Notebook")
for nb in notebooks:
    print(f"Notebook: {nb['displayName']}")

# Create a new notebook
new_notebook = items.create_item(
    display_name="Data Processing",
    item_type="Notebook"
)
```

## Lakehouse Operations

```python
class LakehouseAPI:
    """Manage Lakehouses"""

    def __init__(self, client: FabricClient, workspace_id: str):
        self.client = client
        self.workspace_id = workspace_id
        self.base_path = f"/workspaces/{workspace_id}/lakehouses"

    def list_lakehouses(self) -> list:
        """List all lakehouses"""
        response = self.client.get(self.base_path)
        return response.get("value", [])

    def get_lakehouse(self, lakehouse_id: str) -> dict:
        """Get lakehouse details"""
        return self.client.get(f"{self.base_path}/{lakehouse_id}")

    def create_lakehouse(self, display_name: str) -> dict:
        """Create a new lakehouse"""

        return self.client.post(
            self.base_path,
            json={"displayName": display_name}
        )

    def list_tables(self, lakehouse_id: str) -> list:
        """List tables in lakehouse"""

        response = self.client.get(f"{self.base_path}/{lakehouse_id}/tables")
        return response.get("value", [])

    def load_table(
        self,
        lakehouse_id: str,
        table_name: str,
        source_path: str,
        file_format: str = "parquet"
    ) -> dict:
        """Load data into a table"""

        return self.client.post(
            f"{self.base_path}/{lakehouse_id}/tables/{table_name}/load",
            json={
                "relativePath": source_path,
                "pathType": "File",
                "mode": "Overwrite",
                "formatOptions": {
                    "format": file_format
                }
            }
        )

# Usage
lakehouses = LakehouseAPI(client, workspace_id="your-workspace-id")

# Create lakehouse
lh = lakehouses.create_lakehouse("sales_lakehouse")

# List tables
tables = lakehouses.list_tables(lh["id"])
```

## Semantic Model Operations

```python
class SemanticModelAPI:
    """Manage Semantic Models (Datasets)"""

    def __init__(self, client: FabricClient, workspace_id: str):
        self.client = client
        self.workspace_id = workspace_id
        self.base_path = f"/workspaces/{workspace_id}/semanticModels"

    def list_models(self) -> list:
        """List all semantic models"""
        response = self.client.get(self.base_path)
        return response.get("value", [])

    def refresh_model(self, model_id: str) -> dict:
        """Trigger model refresh"""

        return self.client.post(
            f"{self.base_path}/{model_id}/refresh",
            json={"type": "Full"}
        )

    def get_refresh_history(self, model_id: str) -> list:
        """Get refresh history"""

        response = self.client.get(f"{self.base_path}/{model_id}/refreshes")
        return response.get("value", [])

# Usage
models = SemanticModelAPI(client, workspace_id="your-workspace-id")

# Refresh a model
models.refresh_model("model-id")
```

## Pipeline Operations

```python
class PipelineAPI:
    """Manage Data Pipelines"""

    def __init__(self, client: FabricClient, workspace_id: str):
        self.client = client
        self.workspace_id = workspace_id
        self.base_path = f"/workspaces/{workspace_id}/dataPipelines"

    def list_pipelines(self) -> list:
        """List all pipelines"""
        response = self.client.get(self.base_path)
        return response.get("value", [])

    def run_pipeline(
        self,
        pipeline_id: str,
        parameters: Optional[dict] = None
    ) -> dict:
        """Run a pipeline"""

        payload = {}
        if parameters:
            payload["parameters"] = parameters

        return self.client.post(
            f"{self.base_path}/{pipeline_id}/jobs/instances",
            json=payload if payload else None
        )

    def get_pipeline_runs(self, pipeline_id: str) -> list:
        """Get pipeline run history"""

        response = self.client.get(
            f"{self.base_path}/{pipeline_id}/jobs/instances"
        )
        return response.get("value", [])

# Usage
pipelines = PipelineAPI(client, workspace_id="your-workspace-id")

# Run pipeline with parameters
pipelines.run_pipeline(
    pipeline_id="pipeline-id",
    parameters={"date": "2024-04-08"}
)
```

## Conclusion

The Fabric REST APIs provide comprehensive programmatic access to manage workspaces, items, and operations. Use these APIs to automate administrative tasks and integrate Fabric into your existing workflows.

