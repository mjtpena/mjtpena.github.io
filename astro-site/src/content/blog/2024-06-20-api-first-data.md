---
title: "API-First Data: Treating Data as a Service"
author: Michael John Peña
draft: false
date: 2024-06-20
tags:
  - API
  - Data Services
  - Microsoft Fabric
  - REST API
  - Data Products
---

API-first data design treats data products as services with well-defined interfaces. Today I'm exploring how to build data APIs in Microsoft Fabric.

## API-First Principles

```
Traditional Data Access:
Database → Direct Query → Application

API-First Data:
Data Product → API → Application
     ↓
- Versioned interface
- Rate limiting
- Authentication
- Documentation
- Monitoring
```

## Data API Architecture

```python
from fastapi import FastAPI, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import date

app = FastAPI(
    title="Customer Data API",
    description="API for accessing customer data product",
    version="2.0.0"
)

# Data models
class Customer(BaseModel):
    customer_id: str
    email: str
    full_name: str
    segment: str
    lifetime_value: Optional[float]
    created_date: date
    is_active: bool

class CustomerList(BaseModel):
    items: List[Customer]
    total: int
    page: int
    page_size: int
    has_more: bool

class CustomerFilter(BaseModel):
    segment: Optional[str] = None
    is_active: Optional[bool] = None
    min_lifetime_value: Optional[float] = None
    created_after: Optional[date] = None

# Endpoints
@app.get("/customers", response_model=CustomerList)
async def list_customers(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    segment: Optional[str] = None,
    is_active: Optional[bool] = None
):
    """List customers with pagination and filtering."""
    # Query data product
    query = build_customer_query(
        page=page,
        page_size=page_size,
        segment=segment,
        is_active=is_active
    )

    results = execute_query(query)

    return CustomerList(
        items=results["data"],
        total=results["total"],
        page=page,
        page_size=page_size,
        has_more=results["total"] > page * page_size
    )

@app.get("/customers/{customer_id}", response_model=Customer)
async def get_customer(customer_id: str):
    """Get a single customer by ID."""
    customer = fetch_customer(customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer

@app.get("/customers/{customer_id}/transactions")
async def get_customer_transactions(
    customer_id: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    limit: int = Query(100, le=1000)
):
    """Get transactions for a customer."""
    transactions = fetch_transactions(customer_id, start_date, end_date, limit)
    return {"customer_id": customer_id, "transactions": transactions}
```

## Fabric SQL Endpoint as API Backend

```python
import pyodbc
from contextlib import contextmanager

class FabricDataService:
    """Service layer for Fabric data access."""

    def __init__(self, connection_string: str):
        self.connection_string = connection_string

    @contextmanager
    def get_connection(self):
        conn = pyodbc.connect(self.connection_string)
        try:
            yield conn
        finally:
            conn.close()

    def get_customers(
        self,
        page: int = 1,
        page_size: int = 50,
        filters: dict = None
    ) -> dict:
        offset = (page - 1) * page_size

        # Build query
        base_query = """
        SELECT
            customer_id,
            email,
            full_name,
            segment,
            lifetime_value,
            created_date,
            is_active
        FROM gold.customer_master
        WHERE 1=1
        """

        count_query = "SELECT COUNT(*) FROM gold.customer_master WHERE 1=1"
        params = []

        if filters:
            if filters.get("segment"):
                base_query += " AND segment = ?"
                count_query += " AND segment = ?"
                params.append(filters["segment"])

            if filters.get("is_active") is not None:
                base_query += " AND is_active = ?"
                count_query += " AND is_active = ?"
                params.append(filters["is_active"])

            if filters.get("min_lifetime_value"):
                base_query += " AND lifetime_value >= ?"
                count_query += " AND lifetime_value >= ?"
                params.append(filters["min_lifetime_value"])

        base_query += f" ORDER BY customer_id OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY"

        with self.get_connection() as conn:
            cursor = conn.cursor()

            # Get data
            cursor.execute(base_query, params)
            columns = [col[0] for col in cursor.description]
            data = [dict(zip(columns, row)) for row in cursor.fetchall()]

            # Get count
            cursor.execute(count_query, params)
            total = cursor.fetchone()[0]

        return {
            "data": data,
            "total": total
        }

    def get_customer_by_id(self, customer_id: str) -> Optional[dict]:
        query = """
        SELECT *
        FROM gold.customer_master
        WHERE customer_id = ?
        """

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, [customer_id])
            row = cursor.fetchone()

            if row:
                columns = [col[0] for col in cursor.description]
                return dict(zip(columns, row))

        return None
```

## GraphQL API

```python
import strawberry
from strawberry.fastapi import GraphQLRouter
from typing import Optional

@strawberry.type
class Customer:
    customer_id: str
    email: str
    full_name: str
    segment: str
    lifetime_value: Optional[float]
    is_active: bool

@strawberry.type
class Transaction:
    transaction_id: str
    customer_id: str
    amount: float
    date: str

@strawberry.type
class Query:
    @strawberry.field
    def customer(self, customer_id: str) -> Optional[Customer]:
        data = data_service.get_customer_by_id(customer_id)
        if data:
            return Customer(**data)
        return None

    @strawberry.field
    def customers(
        self,
        segment: Optional[str] = None,
        is_active: Optional[bool] = None,
        limit: int = 50
    ) -> list[Customer]:
        results = data_service.get_customers(
            page_size=limit,
            filters={"segment": segment, "is_active": is_active}
        )
        return [Customer(**c) for c in results["data"]]

    @strawberry.field
    def customer_transactions(
        self,
        customer_id: str,
        limit: int = 100
    ) -> list[Transaction]:
        return data_service.get_transactions(customer_id, limit)

schema = strawberry.Schema(query=Query)
graphql_app = GraphQLRouter(schema)

app.include_router(graphql_app, prefix="/graphql")
```

## API Versioning

```python
from fastapi import APIRouter

# Version 1 (deprecated)
v1_router = APIRouter(prefix="/v1", tags=["v1 (deprecated)"])

@v1_router.get("/customers")
async def list_customers_v1():
    """Deprecated: Use /v2/customers instead."""
    # Legacy format
    return {"customers": [...]}

# Version 2 (current)
v2_router = APIRouter(prefix="/v2", tags=["v2"])

@v2_router.get("/customers", response_model=CustomerList)
async def list_customers_v2(
    page: int = 1,
    page_size: int = 50
):
    """Current version with pagination."""
    return CustomerList(...)

# Version 3 (preview)
v3_router = APIRouter(prefix="/v3-preview", tags=["v3 preview"])

@v3_router.get("/customers")
async def list_customers_v3():
    """Preview: New cursor-based pagination."""
    return {"items": [...], "next_cursor": "..."}

app.include_router(v1_router)
app.include_router(v2_router)
app.include_router(v3_router)
```

## Rate Limiting and Caching

```python
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter
from fastapi_cache import FastAPICache
from fastapi_cache.decorator import cache
import redis.asyncio as redis

# Initialize rate limiter
@app.on_event("startup")
async def startup():
    redis_client = redis.from_url("redis://localhost")
    await FastAPILimiter.init(redis_client)
    FastAPICache.init(RedisBackend(redis_client))

# Rate limited endpoint
@app.get("/customers")
@cache(expire=300)  # Cache for 5 minutes
async def list_customers(
    _: str = Depends(RateLimiter(times=100, seconds=60))  # 100 requests per minute
):
    return await fetch_customers()

# Different limits for different tiers
def get_rate_limit(tier: str):
    limits = {
        "free": RateLimiter(times=10, seconds=60),
        "standard": RateLimiter(times=100, seconds=60),
        "premium": RateLimiter(times=1000, seconds=60)
    }
    return limits.get(tier, limits["free"])
```

## OpenAPI Documentation

```python
from fastapi.openapi.utils import get_openapi

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="Customer Data API",
        version="2.0.0",
        description="""
        ## Overview
        This API provides access to the Customer360 data product.

        ## Authentication
        All requests require a valid API key in the `X-API-Key` header.

        ## Rate Limits
        - Free tier: 10 requests/minute
        - Standard: 100 requests/minute
        - Premium: 1000 requests/minute

        ## Data Freshness
        Data is updated every 4 hours. Check the `X-Data-Freshness` header.
        """,
        routes=app.routes,
    )

    openapi_schema["info"]["x-logo"] = {
        "url": "https://company.com/logo.png"
    }

    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi
```

## Deploying in Azure

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main

stages:
  - stage: Build
    jobs:
      - job: BuildAndTest
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - task: UsePythonVersion@0
            inputs:
              versionSpec: '3.11'

          - script: |
              pip install -r requirements.txt
              pytest tests/
            displayName: 'Test'

          - task: Docker@2
            inputs:
              command: buildAndPush
              repository: $(containerRegistry)/data-api
              tags: $(Build.BuildId)

  - stage: Deploy
    jobs:
      - deployment: DeployAPI
        environment: production
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureContainerApps@1
                  inputs:
                    azureSubscription: $(azureSubscription)
                    containerAppName: 'customer-data-api'
                    resourceGroup: $(resourceGroup)
                    imageToDeploy: '$(containerRegistry)/data-api:$(Build.BuildId)'
```

## Best Practices

1. **Version from day one** - Breaking changes are inevitable
2. **Document thoroughly** - OpenAPI spec is essential
3. **Rate limit everything** - Protect your data
4. **Cache appropriately** - Balance freshness and performance
5. **Monitor usage** - Understand how data is consumed

## What's Next

Tomorrow I'll cover data marketplace concepts.

## Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [Azure Container Apps](https://learn.microsoft.com/azure/container-apps/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
