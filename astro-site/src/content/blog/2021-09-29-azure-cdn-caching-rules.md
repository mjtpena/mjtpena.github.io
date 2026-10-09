---
title: Mastering Azure CDN Caching Rules and Optimization
description: "CDN caching rules are the configuration that determines how long cached content stays at the edge before the CDN checks with the origin for updates—and…"
author: Michael John Pena
draft: false
date: 2021-09-29
tags:
  - Azure
  - CDN
  - Caching
  - Performance
  - Web Optimization
---

CDN caching rules are the configuration that determines how long cached content stays at the edge before the CDN checks with the origin for updates—and getting them wrong produces either cache misses (too aggressive purging defeats the purpose of caching) or stale content (users see outdated assets long after an update). The hierarchy of cache control: origin `Cache-Control` and `Expires` headers, CDN caching rules (which can override or supplement origin headers), and CDN profile-level defaults. The rules engine in Azure CDN Standard (from Microsoft) and Premium tiers allows matching on URL path, request headers, and device type, then applying different cache durations per resource type. The pattern I use: immutable assets (hashed filenames like `app.a3f4b2.js`) get `max-age=31536000`; HTML files and API responses get `no-cache`; images and fonts get `max-age=604800`. Cache purge by URL, tag, or path clears specific content after deployments without waiting for TTL expiry.

## Cache Control Fundamentals

```
Request Flow:
User -> Edge Node -> Origin (if cache miss)

Cache States:
- HIT: Content served from edge cache
- MISS: Content fetched from origin
- EXPIRED: Cache TTL exceeded, revalidation needed
- BYPASS: Caching disabled for this request
```

## Cache Control Headers

```python
# Flask example: Setting cache headers
from flask import Flask, make_response, send_file

app = Flask(__name__)

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files with appropriate cache headers."""

    response = make_response(send_file(f'static/{filename}'))

    # File extension to cache settings
    cache_settings = {
        '.css': 'public, max-age=2592000',      # 30 days
        '.js': 'public, max-age=2592000',       # 30 days
        '.png': 'public, max-age=31536000',     # 1 year
        '.jpg': 'public, max-age=31536000',     # 1 year
        '.woff2': 'public, max-age=31536000',   # 1 year
        '.html': 'public, max-age=3600',        # 1 hour
        '.json': 'no-cache, must-revalidate',   # Always validate
    }

    ext = '.' + filename.rsplit('.', 1)[-1].lower()
    cache_control = cache_settings.get(ext, 'public, max-age=86400')

    response.headers['Cache-Control'] = cache_control

    # ETag for conditional requests
    import hashlib
    with open(f'static/{filename}', 'rb') as f:
        file_hash = hashlib.md5(f.read()).hexdigest()
    response.headers['ETag'] = f'"{file_hash}"'

    return response

@app.route('/api/<path:endpoint>')
def api_endpoint(endpoint):
    """API endpoints with no caching."""

    response = make_response({'data': 'example'})
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, private'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'

    return response
```

## CDN Caching Rules Configuration

```python
from azure.mgmt.cdn import CdnManagementClient
from azure.mgmt.cdn.models import (
    DeliveryRule,
    DeliveryRuleCacheExpirationAction,
    CacheExpirationActionParameters,
    UrlFileExtensionMatchConditionParameters,
    UrlPathMatchConditionParameters,
    RequestHeaderMatchConditionParameters
)

class CachingRulesManager:
    def __init__(self, cdn_client: CdnManagementClient, resource_group: str,
                 profile_name: str, endpoint_name: str):
        self.client = cdn_client
        self.resource_group = resource_group
        self.profile_name = profile_name
        self.endpoint_name = endpoint_name

    def create_comprehensive_rules(self) -> list:
        """Create a comprehensive set of caching rules."""

        rules = []
        order = 1

        # Rule: Cache immutable assets (versioned files)
        rules.append(DeliveryRule(
            name="CacheVersionedAssets",
            order=order,
            conditions=[
                {
                    "name": "UrlPath",
                    "parameters": UrlPathMatchConditionParameters(
                        operator="RegEx",
                        match_values=[r".*\.[a-f0-9]{8,}\.(js|css|png|jpg|svg)$"]
                    )
                }
            ],
            actions=[
                DeliveryRuleCacheExpirationAction(
                    parameters=CacheExpirationActionParameters(
                        cache_behavior="Override",
                        cache_type="All",
                        cache_duration="365.00:00:00"  # 1 year
                    )
                )
            ]
        ))
        order += 1

        # Rule: Cache static assets
        rules.append(DeliveryRule(
            name="CacheStaticAssets",
            order=order,
            conditions=[
                {
                    "name": "UrlFileExtension",
                    "parameters": UrlFileExtensionMatchConditionParameters(
                        operator="Equal",
                        match_values=["css", "js", "png", "jpg", "jpeg", "gif",
                                     "svg", "ico", "woff", "woff2", "ttf", "eot"]
                    )
                }
            ],
            actions=[
                DeliveryRuleCacheExpirationAction(
                    parameters=CacheExpirationActionParameters(
                        cache_behavior="Override",
                        cache_type="All",
                        cache_duration="30.00:00:00"  # 30 days
                    )
                )
            ]
        ))
        order += 1

        # Rule: Short cache for HTML
        rules.append(DeliveryRule(
            name="CacheHTML",
            order=order,
            conditions=[
                {
                    "name": "UrlFileExtension",
                    "parameters": UrlFileExtensionMatchConditionParameters(
                        operator="Equal",
                        match_values=["html", "htm"]
                    )
                }
            ],
            actions=[
                DeliveryRuleCacheExpirationAction(
                    parameters=CacheExpirationActionParameters(
                        cache_behavior="Override",
                        cache_type="All",
                        cache_duration="00:01:00:00"  # 1 hour
                    )
                )
            ]
        ))
        order += 1

        # Rule: Bypass cache for authenticated content
        rules.append(DeliveryRule(
            name="BypassCacheAuthenticated",
            order=order,
            conditions=[
                {
                    "name": "RequestHeader",
                    "parameters": RequestHeaderMatchConditionParameters(
                        operator="Contains",
                        selector="Authorization",
                        match_values=["Bearer"]
                    )
                }
            ],
            actions=[
                DeliveryRuleCacheExpirationAction(
                    parameters=CacheExpirationActionParameters(
                        cache_behavior="BypassCache"
                    )
                )
            ]
        ))
        order += 1

        # Rule: Bypass cache for API paths
        rules.append(DeliveryRule(
            name="BypassCacheAPI",
            order=order,
            conditions=[
                {
                    "name": "UrlPath",
                    "parameters": UrlPathMatchConditionParameters(
                        operator="BeginsWith",
                        match_values=["/api/", "/graphql"]
                    )
                }
            ],
            actions=[
                DeliveryRuleCacheExpirationAction(
                    parameters=CacheExpirationActionParameters(
                        cache_behavior="BypassCache"
                    )
                )
            ]
        ))
        order += 1

        return rules

    def apply_rules(self):
        """Apply caching rules to endpoint."""

        endpoint = self.client.endpoints.get(
            self.resource_group,
            self.profile_name,
            self.endpoint_name
        )

        rules = self.create_comprehensive_rules()
        endpoint.delivery_policy = {"rules": rules}

        return self.client.endpoints.begin_update(
            self.resource_group,
            self.profile_name,
            self.endpoint_name,
            endpoint
        ).result()
```

## Query String Caching Strategies

```python
from azure.mgmt.cdn.models import QueryStringCachingBehavior

def configure_query_string_caching(cdn_client, resource_group: str,
                                   profile_name: str, endpoint_name: str,
                                   behavior: str):
    """Configure how query strings affect caching."""

    behaviors = {
        "ignore": QueryStringCachingBehavior.IGNORE_QUERY_STRING,
        "include": QueryStringCachingBehavior.USE_QUERY_STRING,
        "bypass": QueryStringCachingBehavior.BYPASS_CACHING,
        "exclude": QueryStringCachingBehavior.NOT_SET
    }

    endpoint = cdn_client.endpoints.get(
        resource_group,
        profile_name,
        endpoint_name
    )

    endpoint.query_string_caching_behavior = behaviors.get(behavior, behaviors["ignore"])

    return cdn_client.endpoints.begin_update(
        resource_group,
        profile_name,
        endpoint_name,
        endpoint
    ).result()

# Example: Ignore query strings for better cache efficiency
configure_query_string_caching(
    cdn_client, "cdn-rg", "myprofile", "myendpoint", "ignore"
)
```

## Cache Invalidation Strategies

```python
import asyncio
from datetime import datetime

class CacheInvalidator:
    def __init__(self, cdn_client, resource_group: str,
                 profile_name: str, endpoint_name: str):
        self.client = cdn_client
        self.resource_group = resource_group
        self.profile_name = profile_name
        self.endpoint_name = endpoint_name

    def purge_paths(self, paths: list):
        """Purge specific paths from cache."""

        return self.client.endpoints.begin_purge_content(
            self.resource_group,
            self.profile_name,
            self.endpoint_name,
            {"content_paths": paths}
        ).result()

    def purge_all(self):
        """Purge entire cache (use sparingly)."""
        return self.purge_paths(["/*"])

    def purge_by_extension(self, extension: str):
        """Purge all files with a specific extension."""
        return self.purge_paths([f"/*.{extension}"])

    def purge_directory(self, directory: str):
        """Purge all content in a directory."""
        path = directory.rstrip('/') + '/*'
        return self.purge_paths([path])

    def smart_purge(self, changed_files: list):
        """Intelligently purge only changed content."""

        # Group by directory for efficiency
        directories = set()
        individual_files = []

        for file_path in changed_files:
            dir_path = '/'.join(file_path.split('/')[:-1])
            if dir_path:
                # If many files in same directory, purge directory
                dir_files = [f for f in changed_files if f.startswith(dir_path)]
                if len(dir_files) > 5:
                    directories.add(dir_path)
                else:
                    individual_files.append(file_path)

        paths_to_purge = list(directories) + individual_files
        return self.purge_paths(paths_to_purge)

# Usage
invalidator = CacheInvalidator(cdn_client, "cdn-rg", "myprofile", "myendpoint")

# After deployment, purge changed files
changed = ["/js/app.js", "/css/styles.css", "/index.html"]
invalidator.smart_purge(changed)
```

## Pre-loading Content

```python
def preload_popular_content(cdn_client, resource_group: str,
                           profile_name: str, endpoint_name: str,
                           paths: list):
    """Pre-load content into CDN cache."""

    # Note: Pre-loading is only available on Premium Verizon
    return cdn_client.endpoints.begin_load_content(
        resource_group,
        profile_name,
        endpoint_name,
        {"content_paths": paths}
    ).result()

# Pre-load homepage assets before marketing campaign
popular_assets = [
    "/images/hero-banner.jpg",
    "/js/main.bundle.js",
    "/css/styles.min.css",
    "/fonts/brand-font.woff2"
]

preload_popular_content(
    cdn_client, "cdn-rg", "premium-profile", "myendpoint",
    popular_assets
)
```

## Monitoring Cache Performance

```python
def analyze_cache_performance(metrics: dict) -> dict:
    """Analyze cache performance metrics."""

    analysis = {
        "recommendations": [],
        "metrics": {}
    }

    # Calculate hit ratio
    if "ByteHitRatio" in metrics:
        values = [v["average"] for v in metrics["ByteHitRatio"] if v["average"]]
        avg_hit_ratio = sum(values) / len(values) if values else 0
        analysis["metrics"]["hit_ratio"] = avg_hit_ratio

        if avg_hit_ratio < 80:
            analysis["recommendations"].append(
                "Cache hit ratio is below 80%. Consider extending TTL for static assets."
            )

    # Check request patterns
    if "RequestCount" in metrics:
        total_requests = sum(v["total"] or 0 for v in metrics["RequestCount"])
        analysis["metrics"]["total_requests"] = total_requests

    # Origin health
    if "OriginLatency" in metrics:
        latencies = [v["average"] for v in metrics["OriginLatency"] if v["average"]]
        avg_latency = sum(latencies) / len(latencies) if latencies else 0
        analysis["metrics"]["avg_origin_latency_ms"] = avg_latency

        if avg_latency > 500:
            analysis["recommendations"].append(
                "Origin latency is high. Consider optimizing origin server or extending cache TTL."
            )

    # Bandwidth efficiency
    if analysis["metrics"].get("hit_ratio", 0) > 95:
        analysis["recommendations"].append(
            "Excellent cache efficiency! Consider pre-loading popular content."
        )

    return analysis
```

## Cache-Friendly Application Design

```javascript
// Client-side: Implement cache-busting for dynamic content
class AssetLoader {
    constructor(cdnBase) {
        this.cdnBase = cdnBase;
        this.version = window.__APP_VERSION__ || Date.now();
    }

    // For versioned assets (immutable)
    getVersionedUrl(path) {
        const ext = path.split('.').pop();
        const base = path.slice(0, -ext.length - 1);
        return `${this.cdnBase}${base}.${this.version}.${ext}`;
    }

    // For dynamic content with query string
    getDynamicUrl(path) {
        return `${this.cdnBase}${path}?v=${this.version}`;
    }

    // Service Worker cache strategy
    async fetchWithCache(url, options = {}) {
        const cache = await caches.open('cdn-cache-v1');
        const cachedResponse = await cache.match(url);

        if (cachedResponse) {
            // Return cached, but update in background
            this.updateCache(url, cache);
            return cachedResponse;
        }

        const response = await fetch(url, options);
        cache.put(url, response.clone());
        return response;
    }

    async updateCache(url, cache) {
        try {
            const response = await fetch(url);
            await cache.put(url, response);
        } catch (e) {
            console.log('Background cache update failed:', e);
        }
    }
}
```

## Best Practices

1. **Versioned Assets**: Include content hash in filenames
2. **Layer Caching**: Browser -> CDN -> Origin
3. **Appropriate TTLs**: Match cache duration to content change frequency
4. **Conditional Requests**: Use ETag/Last-Modified for validation
5. **Purge Selectively**: Avoid purging entire cache
6. **Monitor Hit Ratio**: Target >90% for static content

Proper caching strategy dramatically improves performance and reduces origin load, making your application faster and more cost-effective.
