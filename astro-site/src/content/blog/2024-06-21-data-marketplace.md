---
title: "Building a Data Marketplace in Microsoft Fabric"
description: "A data marketplace enables data discovery, sharing, and consumption across your organization. Today I'm exploring how to build one using Microsoft Fabric."
author: Michael John Peña
draft: false
date: 2024-06-21
tags:
  - Data Marketplace
  - Microsoft Fabric
  - Data Sharing
  - Data Products
  - Governance
---

A data marketplace enables data discovery, sharing, and consumption across your organization. Today I'm exploring how to build one using Microsoft Fabric.

## Marketplace Concepts

```
Data Marketplace:
├── Catalog (discovery)
├── Data Products (inventory)
├── Access Management (permissions)
├── Quality Metrics (trust)
├── Usage Analytics (insights)
└── Self-Service (consumption)
```

## Catalog Implementation

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
from enum import Enum

class EndorsementLevel(Enum):
    NONE = "none"
    PROMOTED = "promoted"
    CERTIFIED = "certified"

@dataclass
class CatalogEntry:
    id: str
    name: str
    description: str
    domain: str
    owner: str
    item_type: str
    endorsement: EndorsementLevel
    sensitivity_label: str
    tags: List[str]
    created_at: datetime
    updated_at: datetime
    quality_score: float
    popularity_score: float
    documentation_url: Optional[str]
    sample_queries: List[str]
    related_items: List[str]

class DataCatalog:
    """Central catalog for all data products."""

    def __init__(self, storage, search_client):
        self.storage = storage
        self.search = search_client

    def register(self, entry: CatalogEntry) -> str:
        """Register a new catalog entry."""
        # Store in database
        self.storage.save(f"catalog/{entry.id}", entry.to_dict())

        # Index for search
        self.search.index_document({
            "id": entry.id,
            "name": entry.name,
            "description": entry.description,
            "domain": entry.domain,
            "tags": entry.tags,
            "endorsement": entry.endorsement.value,
            "quality_score": entry.quality_score
        })

        return entry.id

    def search(
        self,
        query: str,
        filters: Dict = None,
        page: int = 1,
        page_size: int = 20
    ) -> Dict:
        """Search the catalog."""
        search_params = {
            "query": query,
            "filters": filters or {},
            "offset": (page - 1) * page_size,
            "limit": page_size,
            "sort": [
                {"endorsement": "desc"},
                {"quality_score": "desc"},
                {"popularity_score": "desc"}
            ]
        }

        results = self.search.search(**search_params)

        return {
            "items": results["hits"],
            "total": results["total"],
            "facets": results.get("facets", {})
        }

    def get_recommendations(self, user_id: str, limit: int = 10) -> List[CatalogEntry]:
        """Get personalized recommendations."""
        # Get user's recent activity
        recent_views = self.storage.get_user_activity(user_id, "view", limit=20)
        recent_queries = self.storage.get_user_activity(user_id, "query", limit=20)

        # Extract patterns
        viewed_domains = [v["domain"] for v in recent_views]
        viewed_tags = [tag for v in recent_views for tag in v.get("tags", [])]

        # Find similar items
        similar = self.search.find_similar(
            domains=list(set(viewed_domains)),
            tags=list(set(viewed_tags)),
            exclude_ids=[v["id"] for v in recent_views],
            limit=limit
        )

        return [CatalogEntry(**item) for item in similar]
```

## Marketplace Portal

```python
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

app = FastAPI(title="Data Marketplace")
templates = Jinja2Templates(directory="templates")

@app.get("/", response_class=HTMLResponse)
async def marketplace_home(request: Request):
    """Marketplace home page."""
    featured = catalog.search(
        query="*",
        filters={"endorsement": "certified"},
        page_size=6
    )

    trending = catalog.get_trending(days=7, limit=6)

    domains = catalog.get_domain_summary()

    return templates.TemplateResponse(
        "home.html",
        {
            "request": request,
            "featured_products": featured["items"],
            "trending_products": trending,
            "domains": domains
        }
    )

@app.get("/search", response_class=HTMLResponse)
async def search_page(
    request: Request,
    q: str = "",
    domain: str = None,
    endorsement: str = None,
    page: int = 1
):
    """Search results page."""
    filters = {}
    if domain:
        filters["domain"] = domain
    if endorsement:
        filters["endorsement"] = endorsement

    results = catalog.search(
        query=q,
        filters=filters,
        page=page
    )

    return templates.TemplateResponse(
        "search.html",
        {
            "request": request,
            "query": q,
            "results": results["items"],
            "total": results["total"],
            "facets": results["facets"],
            "page": page
        }
    )

@app.get("/product/{product_id}", response_class=HTMLResponse)
async def product_detail(request: Request, product_id: str):
    """Product detail page."""
    product = catalog.get(product_id)

    if not product:
        raise HTTPException(404, "Product not found")

    # Get additional info
    quality_report = quality_service.get_report(product_id)
    usage_stats = analytics.get_product_stats(product_id)
    related = catalog.get_related(product_id)
    reviews = reviews_service.get_reviews(product_id)

    return templates.TemplateResponse(
        "product.html",
        {
            "request": request,
            "product": product,
            "quality": quality_report,
            "usage": usage_stats,
            "related": related,
            "reviews": reviews
        }
    )
```

## Access Request Workflow

```python
from enum import Enum

class RequestStatus(Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"

@dataclass
class AccessRequest:
    id: str
    product_id: str
    requester_id: str
    requester_email: str
    requested_role: str
    business_justification: str
    status: RequestStatus
    requested_at: datetime
    reviewed_at: Optional[datetime]
    reviewer_id: Optional[str]
    review_notes: Optional[str]
    expires_at: Optional[datetime]

class AccessRequestWorkflow:
    """Manage access requests to data products."""

    def __init__(self, storage, notification_service, fabric_client):
        self.storage = storage
        self.notifications = notification_service
        self.fabric = fabric_client

    async def submit_request(
        self,
        product_id: str,
        requester: str,
        role: str,
        justification: str
    ) -> AccessRequest:
        """Submit a new access request."""
        product = self.storage.get_product(product_id)

        request = AccessRequest(
            id=generate_id(),
            product_id=product_id,
            requester_id=requester,
            requester_email=get_user_email(requester),
            requested_role=role,
            business_justification=justification,
            status=RequestStatus.PENDING,
            requested_at=datetime.utcnow()
        )

        self.storage.save_request(request)

        # Notify approvers
        await self.notifications.send(
            to=product["owner"],
            template="access_request",
            data={
                "product_name": product["name"],
                "requester": request.requester_email,
                "justification": justification,
                "approve_url": f"/requests/{request.id}/approve",
                "reject_url": f"/requests/{request.id}/reject"
            }
        )

        return request

    async def approve_request(
        self,
        request_id: str,
        reviewer_id: str,
        notes: str = None,
        expiry_days: int = 365
    ):
        """Approve an access request."""
        request = self.storage.get_request(request_id)

        if request.status != RequestStatus.PENDING:
            raise ValueError("Request is not pending")

        # Grant access in Fabric
        await self.fabric.workspaces.add_user(
            workspace_id=request.product_workspace_id,
            user_email=request.requester_email,
            role=request.requested_role
        )

        # Update request
        request.status = RequestStatus.APPROVED
        request.reviewed_at = datetime.utcnow()
        request.reviewer_id = reviewer_id
        request.review_notes = notes
        request.expires_at = datetime.utcnow() + timedelta(days=expiry_days)

        self.storage.update_request(request)

        # Notify requester
        await self.notifications.send(
            to=request.requester_email,
            template="access_approved",
            data={
                "product_name": self.storage.get_product(request.product_id)["name"],
                "role": request.requested_role,
                "expires_at": request.expires_at.isoformat()
            }
        )

    async def reject_request(
        self,
        request_id: str,
        reviewer_id: str,
        reason: str
    ):
        """Reject an access request."""
        request = self.storage.get_request(request_id)

        request.status = RequestStatus.REJECTED
        request.reviewed_at = datetime.utcnow()
        request.reviewer_id = reviewer_id
        request.review_notes = reason

        self.storage.update_request(request)

        await self.notifications.send(
            to=request.requester_email,
            template="access_rejected",
            data={
                "product_name": self.storage.get_product(request.product_id)["name"],
                "reason": reason
            }
        )
```

## Usage Analytics

```python
class MarketplaceAnalytics:
    """Track and analyze marketplace usage."""

    def __init__(self, storage):
        self.storage = storage

    def track_event(
        self,
        event_type: str,
        user_id: str,
        product_id: str = None,
        metadata: dict = None
    ):
        """Track a marketplace event."""
        event = {
            "event_type": event_type,
            "user_id": user_id,
            "product_id": product_id,
            "timestamp": datetime.utcnow().isoformat(),
            "metadata": metadata or {}
        }
        self.storage.append("events", event)

    def get_product_stats(self, product_id: str, days: int = 30) -> dict:
        """Get usage statistics for a product."""
        events = self.storage.query_events(
            product_id=product_id,
            since=datetime.utcnow() - timedelta(days=days)
        )

        return {
            "views": len([e for e in events if e["event_type"] == "view"]),
            "queries": len([e for e in events if e["event_type"] == "query"]),
            "downloads": len([e for e in events if e["event_type"] == "download"]),
            "unique_users": len(set(e["user_id"] for e in events)),
            "trend": self._calculate_trend(events)
        }

    def get_trending(self, days: int = 7, limit: int = 10) -> List[dict]:
        """Get trending products."""
        # Aggregate events by product
        events = self.storage.query_events(
            since=datetime.utcnow() - timedelta(days=days)
        )

        product_scores = {}
        for event in events:
            pid = event.get("product_id")
            if pid:
                weight = {"view": 1, "query": 5, "download": 10}.get(event["event_type"], 1)
                product_scores[pid] = product_scores.get(pid, 0) + weight

        # Sort and return top products
        sorted_products = sorted(
            product_scores.items(),
            key=lambda x: x[1],
            reverse=True
        )[:limit]

        return [
            {"product_id": pid, "score": score}
            for pid, score in sorted_products
        ]
```

## Self-Service Access

```python
@app.post("/product/{product_id}/quick-access")
async def request_quick_access(
    product_id: str,
    current_user: User = Depends(get_current_user)
):
    """One-click access for promoted products."""
    product = catalog.get(product_id)

    # Check if quick access is enabled
    if product.endorsement != EndorsementLevel.PROMOTED:
        raise HTTPException(400, "Quick access not available for this product")

    # Check if user already has access
    if await has_access(current_user.id, product_id):
        return {"status": "already_granted"}

    # Grant viewer access automatically
    await fabric_client.workspaces.add_user(
        workspace_id=product.workspace_id,
        user_email=current_user.email,
        role="Viewer"
    )

    # Track event
    analytics.track_event("quick_access", current_user.id, product_id)

    return {"status": "granted", "role": "Viewer"}
```

## Best Practices

1. **Curate ruthlessly** - Quality over quantity
2. **Make discovery easy** - Good search and recommendations
3. **Automate where possible** - Self-service access for low-risk data
4. **Track everything** - Understand usage patterns
5. **Build trust** - Quality scores and endorsements

## What's Next

Tomorrow I'll cover data sharing patterns.

## Resources

- [Fabric OneLake Data Hub](https://learn.microsoft.com/fabric/governance/onelake-data-hub)
- [Data Marketplace Patterns](https://www.datamesh-architecture.com/data-product-marketplace)
- [Microsoft Purview](https://learn.microsoft.com/purview/)
