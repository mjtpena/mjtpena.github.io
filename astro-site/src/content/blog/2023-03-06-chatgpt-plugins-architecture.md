---
title: "Understanding ChatGPT Plugins Architecture"
author: Michael John Pena
draft: false
date: 2023-03-06
tags:
  - OpenAI
  - AI
  - ChatGPT
  - Plugins
  - Architecture

---

I wrote "Understanding ChatGPT Plugins Architecture" to share practical, production-minded guidance on this topic.

## What Are ChatGPT Plugins?

Plugins allow ChatGPT to:
- Access real-time information (weather, stocks, news)
- Perform actions (book flights, make reservations)
- Query proprietary data (company databases, documents)
- Execute code (browser automation, calculations)

## Plugin Architecture

A ChatGPT plugin consists of three components:

### 1. Plugin Manifest (ai-plugin.json)

```json
{
    "schema_version": "v1",
    "name_for_human": "Azure Data Assistant",
    "name_for_model": "azure_data",
    "description_for_human": "Query Azure data services and get insights",
    "description_for_model": "Use this plugin when the user wants to query Azure SQL, Cosmos DB, or blob storage. Helps with data exploration and analysis.",
    "auth": {
        "type": "oauth",
        "client_url": "https://yourapp.com/oauth/authorize",
        "scope": "read:data write:queries",
        "authorization_url": "https://yourapp.com/oauth/token",
        "authorization_content_type": "application/json"
    },
    "api": {
        "type": "openapi",
        "url": "https://yourapp.com/openapi.yaml",
        "is_user_authenticated": true
    },
    "logo_url": "https://yourapp.com/logo.png",
    "contact_email": "support@yourapp.com",
    "legal_info_url": "https://yourapp.com/legal"
}
```

### 2. OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: Azure Data Assistant API
  description: Query Azure data services
  version: 1.0.0
servers:
  - url: https://yourapp.com/api/v1
paths:
  /query/sql:
    post:
      operationId: querySqlDatabase
      summary: Execute a SQL query against Azure SQL Database
      description: Use this to query relational data. Provide a natural language question and the system will generate and execute SQL.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                database:
                  type: string
                  description: The database name to query
                question:
                  type: string
                  description: Natural language question about the data
              required:
                - database
                - question
      responses:
        '200':
          description: Query results
          content:
            application/json:
              schema:
                type: object
                properties:
                  sql:
                    type: string
                    description: The generated SQL query
                  results:
                    type: array
                    items:
                      type: object
                  row_count:
                    type: integer

  /query/cosmos:
    post:
      operationId: queryCosmosDb
      summary: Query Azure Cosmos DB
      description: Use this for document/NoSQL queries
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                container:
                  type: string
                question:
                  type: string
              required:
                - container
                - question
      responses:
        '200':
          description: Query results
          content:
            application/json:
              schema:
                type: object
                properties:
                  query:
                    type: string
                  documents:
                    type: array
                    items:
                      type: object
```

### 3. Backend API Implementation

```python
from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
import openai
import pyodbc

app = FastAPI()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

class SqlQueryRequest(BaseModel):
    database: str
    question: str

class SqlQueryResponse(BaseModel):
    sql: str
    results: list
    row_count: int

# Natural language to SQL using GPT
async def generate_sql(question: str, schema: str) -> str:
    """Convert natural language to SQL."""
    prompt = f"""Given this database schema:
{schema}

Convert this question to SQL:
{question}

Return only the SQL query, no explanation."""

    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": prompt}],
        temperature=0
    )
    return response.choices[0].message.content.strip()

async def get_database_schema(database: str) -> str:
    """Fetch database schema for context."""
    # Simplified - in production, cache this
    conn_str = f"Driver={{ODBC Driver 17 for SQL Server}};Server=your-server.database.windows.net;Database={database};..."
    conn = pyodbc.connect(conn_str)

    cursor = conn.cursor()
    cursor.execute("""
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        ORDER BY TABLE_NAME, ORDINAL_POSITION
    """)

    schema_lines = []
    current_table = None

    for row in cursor.fetchall():
        if row.TABLE_NAME != current_table:
            if current_table:
                schema_lines.append("")
            schema_lines.append(f"Table: {row.TABLE_NAME}")
            current_table = row.TABLE_NAME
        schema_lines.append(f"  - {row.COLUMN_NAME}: {row.DATA_TYPE}")

    conn.close()
    return "\n".join(schema_lines)

@app.post("/api/v1/query/sql", response_model=SqlQueryResponse)
async def query_sql_database(
    request: SqlQueryRequest,
    token: str = Depends(oauth2_scheme)
):
    """Execute natural language query against SQL database."""
    try:
        # Get schema for context
        schema = await get_database_schema(request.database)

        # Generate SQL
        sql = await generate_sql(request.question, schema)

        # Validate SQL (simple check - enhance for production)
        if not sql.upper().startswith("SELECT"):
            raise HTTPException(400, "Only SELECT queries are allowed")

        # Execute query
        conn_str = f"Driver={{ODBC Driver 17 for SQL Server}};Server=your-server.database.windows.net;Database={request.database};..."
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        cursor.execute(sql)

        columns = [column[0] for column in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]

        conn.close()

        return SqlQueryResponse(
            sql=sql,
            results=results[:100],  # Limit results
            row_count=len(results)
        )

    except Exception as e:
        raise HTTPException(500, str(e))

# Serve plugin manifest
@app.get("/.well-known/ai-plugin.json")
async def get_plugin_manifest():
    return {
        "schema_version": "v1",
        "name_for_human": "Azure Data Assistant",
        # ... rest of manifest
    }

# Serve OpenAPI spec
@app.get("/openapi.yaml")
async def get_openapi_spec():
    from fastapi.openapi.utils import get_openapi
    return get_openapi(
        title="Azure Data Assistant API",
        version="1.0.0",
        routes=app.routes
    )
```

## Security Considerations

Plugins require careful security design:

```python
from typing import Optional
from fastapi import Security
from fastapi.security import APIKeyHeader
import jwt

api_key_header = APIKeyHeader(name="Authorization", auto_error=False)

class PluginSecurity:
    def __init__(self, jwt_secret: str, allowed_databases: list):
        self.jwt_secret = jwt_secret
        self.allowed_databases = allowed_databases

    async def verify_token(self, token: str) -> dict:
        """Verify JWT token from OAuth flow."""
        try:
            payload = jwt.decode(token, self.jwt_secret, algorithms=["HS256"])
            return payload
        except jwt.InvalidTokenError:
            raise HTTPException(401, "Invalid token")

    async def authorize_database_access(self, token: str, database: str) -> bool:
        """Check if user can access specific database."""
        payload = await self.verify_token(token)
        user_databases = payload.get("databases", [])
        return database in user_databases and database in self.allowed_databases

    def validate_query(self, sql: str) -> bool:
        """Validate SQL query for safety."""
        # Block dangerous operations
        dangerous_keywords = [
            "DROP", "DELETE", "UPDATE", "INSERT", "TRUNCATE",
            "ALTER", "CREATE", "EXEC", "EXECUTE", "--", ";"
        ]

        sql_upper = sql.upper()
        for keyword in dangerous_keywords:
            if keyword in sql_upper:
                return False

        # Only allow SELECT
        if not sql_upper.strip().startswith("SELECT"):
            return False

        return True

security = PluginSecurity(
    jwt_secret="your-secret",
    allowed_databases=["analytics", "reporting"]
)

@app.post("/api/v1/query/sql")
async def secure_query(
    request: SqlQueryRequest,
    authorization: str = Security(api_key_header)
):
    # Verify authorization
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization")

    token = authorization.replace("Bearer ", "")

    # Check database access
    if not await security.authorize_database_access(token, request.database):
        raise HTTPException(403, "Access denied to database")

    # ... rest of query logic
```

## Implications for Enterprise AI

### Data Access
Plugins enable AI to query enterprise data without training on it. This is huge for:
- Real-time business intelligence
- Customer support with live data
- Data exploration without SQL knowledge

### API Integration
Any API can become an AI interface:
- CRM systems
- ERP platforms
- Internal tools

### Workflow Automation
Combine multiple plugins for complex workflows:
- "Query our sales database, identify top customers, and draft personalized emails"

## Building Azure-Specific Plugins

```python
# Plugin ideas for Azure ecosystem
azure_plugins = {
    "azure-monitor": "Query metrics and logs from Azure Monitor",
    "azure-devops": "Create work items, check pipeline status",
    "azure-costs": "Analyze Azure spending and get optimization tips",
    "azure-security": "Check security recommendations and compliance",
    "power-bi": "Query Power BI datasets and create reports",
}
```

## The Future

Plugins transform ChatGPT from a knowledge retrieval system to an action-execution platform. For enterprises on Azure, this means:

1. Building plugins for internal systems
2. Connecting AI to live data
3. Automating workflows through conversation
4. Creating new interfaces for complex systems

The plugin ecosystem is just beginning. Now is the time to experiment and understand the patterns.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
