---
title: "Model Context Protocol in Azure: Standardized Tool Integration"
author: Michael John Peña
draft: false
date: 2025-05-07
tags:
  - MCP
  - Azure
  - AI
  - Integration
  - Tools

---

I wrote "Model Context Protocol in Azure: Standardized Tool Integration" to share practical, production-minded guidance on this topic.

## MCP Integration

```python
from mcp import MCPServer, Tool, Resource
from azure.ai.openai import AzureOpenAI

class AzureMCPServer(MCPServer):
    """MCP server exposing Azure services."""

    def __init__(self, openai_client: AzureOpenAI):
        super().__init__()
        self.openai = openai_client

    @Tool.define(
        name="azure_search",
        description="Search Azure AI Search index",
        parameters={
            "query": {"type": "string", "description": "Search query"},
            "index": {"type": "string", "description": "Index name"},
            "top": {"type": "integer", "description": "Number of results", "default": 10}
        }
    )
    async def search(self, query: str, index: str, top: int = 10):
        """Search Azure AI Search."""
        results = await self.search_client.search(
            search_text=query,
            top=top,
            select=["id", "title", "content"]
        )
        return [dict(r) for r in results]

    @Tool.define(
        name="cosmos_query",
        description="Query Cosmos DB container",
        parameters={
            "query": {"type": "string", "description": "SQL query"},
            "container": {"type": "string", "description": "Container name"}
        }
    )
    async def cosmos_query(self, query: str, container: str):
        """Query Cosmos DB."""
        results = self.cosmos_client.query_items(
            query=query,
            enable_cross_partition_query=True
        )
        return list(results)

    @Resource.define(
        name="blob_storage",
        description="Access Azure Blob Storage files"
    )
    async def get_blob(self, container: str, blob_name: str):
        """Get blob content."""
        blob_client = self.blob_service.get_blob_client(container, blob_name)
        return await blob_client.download_blob().readall()


# Client usage
from mcp import MCPClient

async def use_mcp_tools():
    # Connect to MCP server
    client = MCPClient("http://localhost:8080")

    # List available tools
    tools = await client.list_tools()
    print(f"Available tools: {[t.name for t in tools]}")

    # Use tools through OpenAI
    response = await openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Search for AI documentation"}],
        tools=client.get_openai_tools()
    )

    # Execute tool calls
    if response.choices[0].message.tool_calls:
        for call in response.choices[0].message.tool_calls:
            result = await client.execute_tool(
                call.function.name,
                json.loads(call.function.arguments)
            )
            print(f"Tool result: {result}")
```

MCP standardizes how AI systems connect to external tools and data sources.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
