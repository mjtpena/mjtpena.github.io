---
title: Configuring Azure Media Services Streaming Endpoints
description: "Proper streaming endpoint configuration ensures reliable, scalable content delivery to viewers worldwide."
author: Michael John Pena
draft: false
date: 2021-09-26
tags:
  - Azure
  - Media Services
  - Video Streaming
  - CDN
  - Content Delivery
---

## Streaming Endpoint Types

| Type | Scale Units | Use Case | Features |
|------|-------------|----------|----------|
| Standard | 0-10 | Production | CDN integration, scaling |
| Premium | 1-10 | Enterprise | Dedicated compute, custom CDN |

## Creating and Configuring Endpoints

```python
from azure.mgmt.media import AzureMediaServices
from azure.mgmt.media.models import (
    StreamingEndpoint,
    CrossSiteAccessPolicies,
    AkamaiSignatureHeaderAuthenticationKey,
    AkamaiAccessControl,
    StreamingEndpointAccessControl,
    IPAccessControl,
    IPRange
)
from azure.identity import DefaultAzureCredential

class StreamingEndpointManager:
    def __init__(self, subscription_id: str, resource_group: str, account_name: str):
        self.credential = DefaultAzureCredential()
        self.client = AzureMediaServices(self.credential, subscription_id)
        self.resource_group = resource_group
        self.account_name = account_name

    def create_streaming_endpoint(self, endpoint_name: str,
                                  scale_units: int = 1,
                                  cdn_enabled: bool = True) -> StreamingEndpoint:
        """Create a new streaming endpoint."""

        # Access control configuration
        access_control = StreamingEndpointAccessControl(
            ip=IPAccessControl(
                allow=[
                    IPRange(name="AllowAll", address="0.0.0.0", subnet_prefix_length=0)
                ]
            )
        )

        endpoint = StreamingEndpoint(
            location="eastus",
            scale_units=scale_units,
            cdn_enabled=cdn_enabled,
            cdn_provider="StandardVerizon" if cdn_enabled else None,
            description="Production streaming endpoint",
            access_control=access_control,
            cross_site_access_policies=CrossSiteAccessPolicies(
                client_access_policy="<allow-from><domain uri=\"*\"/></allow-from>",
                cross_domain_policy="<cross-domain-policy><allow-access-from domain=\"*\"/></cross-domain-policy>"
            )
        )

        return self.client.streaming_endpoints.begin_create(
            self.resource_group,
            self.account_name,
            endpoint_name,
            endpoint
        ).result()

    def start_endpoint(self, endpoint_name: str):
        """Start a streaming endpoint."""
        return self.client.streaming_endpoints.begin_start(
            self.resource_group,
            self.account_name,
            endpoint_name
        ).result()

    def stop_endpoint(self, endpoint_name: str):
        """Stop a streaming endpoint."""
        return self.client.streaming_endpoints.begin_stop(
            self.resource_group,
            self.account_name,
            endpoint_name
        ).result()

    def scale_endpoint(self, endpoint_name: str, scale_units: int):
        """Scale a streaming endpoint."""
        return self.client.streaming_endpoints.begin_scale(
            self.resource_group,
            self.account_name,
            endpoint_name,
            {"scale_units": scale_units}
        ).result()

# Create and start endpoint
manager = StreamingEndpointManager(
    "subscription-id",
    "media-rg",
    "mediaaccount"
)

endpoint = manager.create_streaming_endpoint("production", scale_units=2, cdn_enabled=True)
manager.start_endpoint("production")
print(f"Endpoint hostname: {endpoint.host_name}")
```

## Generating Streaming URLs

```python
from azure.mgmt.media.models import (
    StreamingLocator,
    StreamingPath
)

class StreamingURLGenerator:
    def __init__(self, media_client: AzureMediaServices,
                 resource_group: str, account_name: str):
        self.client = media_client
        self.resource_group = resource_group
        self.account_name = account_name

    def create_locator(self, asset_name: str, locator_name: str,
                      policy_name: str = "Predefined_ClearStreamingOnly") -> StreamingLocator:
        """Create a streaming locator for an asset."""

        locator = StreamingLocator(
            asset_name=asset_name,
            streaming_policy_name=policy_name
        )

        return self.client.streaming_locators.create(
            self.resource_group,
            self.account_name,
            locator_name,
            locator
        )

    def get_streaming_urls(self, locator_name: str,
                          endpoint_hostname: str) -> dict:
        """Get all streaming URLs for a locator."""

        paths = self.client.streaming_locators.list_paths(
            self.resource_group,
            self.account_name,
            locator_name
        )

        urls = {
            "dash": [],
            "hls": [],
            "smooth": [],
            "download": []
        }

        for path in paths.streaming_paths:
            protocol = path.streaming_protocol.lower()
            for p in path.paths:
                full_url = f"https://{endpoint_hostname}{p}"
                if "dash" in protocol:
                    urls["dash"].append(full_url)
                elif "hls" in protocol:
                    urls["hls"].append(full_url)
                elif "smooth" in protocol:
                    urls["smooth"].append(full_url)

        for path in paths.download_paths:
            urls["download"].append(f"https://{endpoint_hostname}{path}")

        return urls

    def get_player_urls(self, locator_name: str,
                       endpoint_hostname: str) -> dict:
        """Get player-ready URLs."""

        streaming_urls = self.get_streaming_urls(locator_name, endpoint_hostname)

        player_urls = {}

        # DASH for most browsers
        if streaming_urls["dash"]:
            manifest_url = streaming_urls["dash"][0]
            player_urls["dash"] = manifest_url

        # HLS for Apple devices
        if streaming_urls["hls"]:
            manifest_url = streaming_urls["hls"][0]
            player_urls["hls"] = manifest_url
            # For HLS, also provide the m3u8 variant
            player_urls["hls_v3"] = manifest_url.replace("format=m3u8-aapl", "format=m3u8-aapl-v3")
            player_urls["hls_cmaf"] = manifest_url.replace("format=m3u8-aapl", "format=m3u8-cmaf")

        # Smooth for older players
        if streaming_urls["smooth"]:
            player_urls["smooth"] = streaming_urls["smooth"][0]

        return player_urls

# Generate URLs
generator = StreamingURLGenerator(client, "media-rg", "mediaaccount")
generator.create_locator("encoded-video-asset", "video-locator")
urls = generator.get_player_urls("video-locator", "endpoint.streaming.mediaservices.windows.net")

print("Player URLs:")
for protocol, url in urls.items():
    print(f"  {protocol}: {url}")
```

## CDN Configuration

```python
from azure.mgmt.cdn import CdnManagementClient
from azure.mgmt.cdn.models import (
    Endpoint,
    DeepCreatedOrigin,
    EndpointPropertiesUpdateParametersDeliveryPolicy,
    DeliveryRule,
    DeliveryRuleCondition,
    DeliveryRuleAction
)

def configure_cdn_for_streaming(cdn_client: CdnManagementClient,
                               resource_group: str,
                               profile_name: str,
                               endpoint_name: str,
                               streaming_hostname: str):
    """Configure CDN endpoint for media streaming."""

    endpoint = Endpoint(
        location="global",
        origins=[
            DeepCreatedOrigin(
                name="streaming-origin",
                host_name=streaming_hostname,
                https_port=443,
                origin_host_header=streaming_hostname
            )
        ],
        is_http_allowed=False,
        is_https_allowed=True,
        query_string_caching_behavior="IgnoreQueryString",
        optimization_type="GeneralMediaStreaming",
        delivery_policy=EndpointPropertiesUpdateParametersDeliveryPolicy(
            rules=[
                DeliveryRule(
                    name="CacheManifests",
                    order=1,
                    conditions=[
                        {
                            "name": "UrlFileExtension",
                            "parameters": {
                                "operator": "Equal",
                                "match_values": ["mpd", "m3u8", "isml", "ism"]
                            }
                        }
                    ],
                    actions=[
                        {
                            "name": "CacheExpiration",
                            "parameters": {
                                "cache_behavior": "Override",
                                "cache_type": "All",
                                "cache_duration": "00:00:30"  # 30 seconds
                            }
                        }
                    ]
                ),
                DeliveryRule(
                    name="CacheSegments",
                    order=2,
                    conditions=[
                        {
                            "name": "UrlFileExtension",
                            "parameters": {
                                "operator": "Equal",
                                "match_values": ["mp4", "m4s", "m4a", "m4v", "ts"]
                            }
                        }
                    ],
                    actions=[
                        {
                            "name": "CacheExpiration",
                            "parameters": {
                                "cache_behavior": "Override",
                                "cache_type": "All",
                                "cache_duration": "7.00:00:00"  # 7 days
                            }
                        }
                    ]
                )
            ]
        )
    )

    return cdn_client.endpoints.begin_create(
        resource_group,
        profile_name,
        endpoint_name,
        endpoint
    ).result()
```

## Monitoring Streaming Endpoints

```python
from azure.monitor.query import MetricsQueryClient
from datetime import datetime, timedelta

def get_streaming_metrics(metrics_client: MetricsQueryClient,
                         endpoint_resource_id: str,
                         hours: int = 24) -> dict:
    """Get streaming endpoint metrics."""

    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=hours)

    metrics = metrics_client.query_resource(
        endpoint_resource_id,
        metric_names=[
            "Egress",
            "EgressBandwidth",
            "Requests",
            "SuccessE2ELatency"
        ],
        timespan=(start_time, end_time),
        granularity=timedelta(hours=1)
    )

    results = {}
    for metric in metrics.metrics:
        values = []
        for series in metric.timeseries:
            for data in series.data:
                values.append({
                    "timestamp": data.timestamp,
                    "average": data.average,
                    "total": data.total
                })
        results[metric.name] = values

    return results

def generate_streaming_report(metrics: dict) -> str:
    """Generate a streaming performance report."""

    report = []
    report.append("=== Streaming Endpoint Report ===\n")

    if "Egress" in metrics:
        total_egress = sum(v["total"] or 0 for v in metrics["Egress"])
        report.append(f"Total Data Transferred: {total_egress / (1024**3):.2f} GB")

    if "Requests" in metrics:
        total_requests = sum(v["total"] or 0 for v in metrics["Requests"])
        report.append(f"Total Requests: {total_requests:,}")

    if "SuccessE2ELatency" in metrics:
        avg_latency = sum(v["average"] or 0 for v in metrics["SuccessE2ELatency"]) / max(len(metrics["SuccessE2ELatency"]), 1)
        report.append(f"Average Latency: {avg_latency:.0f} ms")

    return "\n".join(report)
```

## Auto-Scaling Configuration

```python
import asyncio
from azure.mgmt.media import AzureMediaServices

class StreamingAutoScaler:
    def __init__(self, media_client: AzureMediaServices,
                 resource_group: str, account_name: str,
                 endpoint_name: str):
        self.client = media_client
        self.resource_group = resource_group
        self.account_name = account_name
        self.endpoint_name = endpoint_name

        # Scaling thresholds
        self.scale_up_threshold = 80  # CPU/bandwidth %
        self.scale_down_threshold = 20
        self.min_units = 1
        self.max_units = 10

    def get_current_load(self) -> float:
        """Get current endpoint load (simplified)."""
        # In production, query Azure Monitor metrics
        endpoint = self.client.streaming_endpoints.get(
            self.resource_group,
            self.account_name,
            self.endpoint_name
        )
        # Simplified load calculation
        return 50.0  # Placeholder

    def evaluate_scaling(self) -> str:
        """Determine if scaling is needed."""
        load = self.get_current_load()

        endpoint = self.client.streaming_endpoints.get(
            self.resource_group,
            self.account_name,
            self.endpoint_name
        )
        current_units = endpoint.scale_units

        if load > self.scale_up_threshold and current_units < self.max_units:
            return "scale_up"
        elif load < self.scale_down_threshold and current_units > self.min_units:
            return "scale_down"
        return "no_change"

    def scale(self, direction: str):
        """Execute scaling operation."""
        endpoint = self.client.streaming_endpoints.get(
            self.resource_group,
            self.account_name,
            self.endpoint_name
        )
        current_units = endpoint.scale_units

        if direction == "scale_up":
            new_units = min(current_units + 1, self.max_units)
        elif direction == "scale_down":
            new_units = max(current_units - 1, self.min_units)
        else:
            return

        self.client.streaming_endpoints.begin_scale(
            self.resource_group,
            self.account_name,
            self.endpoint_name,
            {"scale_units": new_units}
        ).result()

        print(f"Scaled from {current_units} to {new_units} units")
```

## Best Practices

1. **Enable CDN**: Always use CDN for production streaming
2. **Start Small**: Begin with fewer scale units, scale based on demand
3. **Cache Configuration**: Short TTL for manifests, long for segments
4. **Monitor Metrics**: Track egress, latency, and error rates
5. **Regional Deployment**: Deploy endpoints near your audience
6. **HTTPS Only**: Disable HTTP for security

Proper streaming endpoint configuration ensures reliable, scalable content delivery to viewers worldwide.
