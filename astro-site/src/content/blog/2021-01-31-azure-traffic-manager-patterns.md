---
title: "Traffic Manager Failover Engineering: TTLs, Probes and Nesting"
description: "How to make Azure Traffic Manager failover behave in practice: TTL and probe maths, nested profiles, weighted cutovers and health endpoints that tell the truth."
author: Michael John Pena
draft: false
date: 2021-01-31
url: /blog/azure-traffic-manager-patterns/
tags:
  - Azure
  - Traffic Manager
  - High Availability
  - DNS
  - Load Balancing
---

DNS-based failover is cheap and protocol-agnostic, but it is bounded by probe timings, TTLs and client cache behaviour. That's what makes Azure Traffic Manager attractive and what makes it easy to oversell. If you don't account for those, the "one-minute failover" on your architecture diagram becomes ten minutes with a long tail of users still resolving the dead region.

I covered the routing methods and basic profile setup in [Azure Traffic Manager: Global DNS Load Balancing](/blog/2020-11-25-azure-traffic-manager/). This post is the next layer down: the settings and patterns that decide how quickly and how safely Traffic Manager actually moves traffic.

## The failover budget is three numbers, not one

Traffic Manager never sees your traffic. It answers DNS queries with the endpoint it thinks is healthy, and the client connects directly. So the time from "region dies" to "users land somewhere healthy" is the sum of three things:

1. **Detection.** How long the probes take to mark the endpoint Degraded. That's driven by the probing interval, the probe timeout and the tolerated number of failures.
2. **DNS cache expiry.** How long resolvers keep handing out the old answer. That's your profile TTL, plus whatever your users' recursive resolvers and client stacks do with it.
3. **Client behaviour.** Long-lived connections, connection pools and apps that resolve once at startup don't care about your TTL at all.

The [endpoint monitoring settings](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring) give you two probing intervals: 30 seconds (normal) or 10 seconds (fast probing, which costs extra per endpoint per month). The probe timeout must be shorter than the interval; with fast probing it sits between 5 and 9 seconds. Tolerated failures range from 0 to 9, with 3 as the default. With a 30-second interval and three tolerated failures, detection alone is around a minute and a half to two minutes before TTL even enters the picture. Fast probing cuts that to roughly half a minute.

My rule of thumb: decide the failover time you're willing to promise, then work backwards. If the business wants "about a minute", you need fast probing, a TTL of 30 to 60 seconds, and an honest conversation about the clients you don't control.

### TTL is a trade-off, not a free knob

A low TTL means more DNS queries hit Traffic Manager, and you pay per million queries. For most workloads that's small money, but a TTL of 0 on a high-traffic consumer domain is a cost and latency decision, not just a reliability one. Every uncached lookup adds a resolution round trip. I rarely go below 30 seconds, and I'd rather spend money on fast probing than push TTL to zero, because some resolvers and client stacks (the JVM's DNS cache, for example) apply their own caching regardless of TTL.

## A priority profile with probes that mean something

Here's an active-passive profile created with the Azure CLI. I'm using the CLI rather than ARM templates here because the flags map one-to-one to the monitoring settings, which makes the trade-offs easier to read.

```bash
#!/usr/bin/env bash
set -euo pipefail

RG="<your-resource-group>"
PROFILE="tm-<your-app>"
DNS_NAME="<your-unique-dns-prefix>"   # becomes <prefix>.trafficmanager.net

az network traffic-manager profile create \
  --resource-group "$RG" \
  --name "$PROFILE" \
  --routing-method Priority \
  --unique-dns-name "$DNS_NAME" \
  --ttl 30 \
  --protocol HTTPS \
  --port 443 \
  --path "/health/ready" \
  --interval 10 \
  --timeout 5 \
  --max-failures 2 \
  --custom-headers host=<your-app-hostname> \
  --status-code-ranges 200-299

az network traffic-manager endpoint create \
  --resource-group "$RG" \
  --profile-name "$PROFILE" \
  --name primary-australiaeast \
  --type azureEndpoints \
  --target-resource-id "<resource-id-of-primary-app-service>" \
  --priority 1 \
  --endpoint-status Enabled

az network traffic-manager endpoint create \
  --resource-group "$RG" \
  --profile-name "$PROFILE" \
  --name secondary-australiasoutheast \
  --type azureEndpoints \
  --target-resource-id "<resource-id-of-secondary-app-service>" \
  --priority 2 \
  --endpoint-status Enabled
```

Three choices in there are deliberate.

**The custom Host header.** By default the probe sends the endpoint's own host name. If your app routes or filters on the public host name (host filtering, multi-tenant middleware, an Application Gateway listener), the probe will fail for reasons that have nothing to do with health. Set the header to the name your users actually use.

**The status code range.** Out of the box only a 200 counts as healthy. If your health endpoint returns 204, the probe will fail. I'd rather widen the range explicitly than discover this during an incident.

**Two tolerated failures, not zero.** Zero sounds aggressive and decisive, but it means a single slow probe flips the endpoint. Flapping between regions is worse than a slightly slower failover, especially when the secondary has cold caches.

## The fail-open rule you need to know about

When *every* endpoint in a profile is Degraded, Traffic Manager stops trusting its probes and returns all of them as if they were healthy. The [degraded-state troubleshooting guide](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-troubleshooting-degraded) explains why: a broken probe configuration shouldn't cause a total outage.

That's a sensible default, but it has two consequences people miss:

- A misconfigured probe (HTTP probe against an HTTPS-only app, wrong path, wrong Host header) can leave the profile Degraded for weeks while traffic flows normally. Nobody notices until a real failure, when failover doesn't happen because Traffic Manager was already ignoring health.
- If every endpoint genuinely fails, Traffic Manager routes as though they were all healthy (for a Priority profile that means the primary). That's fine; there's nowhere better to send them.

The fix for the first is boring: alert on endpoint state from day one, not on profile status alone. More on that below.

Disabling an endpoint is different. A disabled endpoint is removed from DNS responses entirely, which is why it's the right tool for maintenance and cutovers.

## Nested profiles: regional failover inside global routing

A single routing method rarely matches the real requirement. A common shape is "send users to their nearest geography, and within that geography fail over between two regions". That's two routing methods, so you need [nested profiles](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-nested-profiles).

```bash
#!/usr/bin/env bash
set -euo pipefail

RG="<your-resource-group>"

# Child profile: Australia, priority failover between two regions
az network traffic-manager profile create \
  --resource-group "$RG" --name tm-<your-app>-au \
  --routing-method Priority --unique-dns-name <your-app>-au \
  --ttl 30 --protocol HTTPS --port 443 --path "/health/ready" \
  --interval 10 --timeout 5 --max-failures 2

az network traffic-manager endpoint create \
  --resource-group "$RG" --profile-name tm-<your-app>-au \
  --name au-east --type azureEndpoints \
  --target-resource-id "<resource-id-of-australiaeast-app>" --priority 1

az network traffic-manager endpoint create \
  --resource-group "$RG" --profile-name tm-<your-app>-au \
  --name au-southeast --type azureEndpoints \
  --target-resource-id "<resource-id-of-australiasoutheast-app>" --priority 2

# Parent profile: geographic routing
az network traffic-manager profile create \
  --resource-group "$RG" --name tm-<your-app>-global \
  --routing-method Geographic --unique-dns-name <your-app>-global \
  --ttl 30 --protocol HTTPS --port 443 --path "/health/ready"

# Australia/Pacific and Asia users go to the Australian child profile
az network traffic-manager endpoint create \
  --resource-group "$RG" --profile-name tm-<your-app>-global \
  --name apac --type nestedEndpoints \
  --target-resource-id "$(az network traffic-manager profile show \
      --resource-group "$RG" --name tm-<your-app>-au --query id --output tsv)" \
  --min-child-endpoints 1 \
  --geo-mapping GEO-AP GEO-AS
```

Add a second child for other geographies and map it to `WORLD` as a catch-all, otherwise users from unmapped locations get no answer at all. [Geographic routing](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods) doesn't fall back to "nearest" on its own; it only returns endpoints whose mapping covers the user's location.

The setting that deserves thought is `--min-child-endpoints`. It defaults to 1: the parent considers the child healthy as long as one endpoint inside it is healthy. For a pair of regions sized to carry each other's load, that's right. If each region can only take half the load, a child with one healthy endpoint is not really healthy, and you may prefer to raise the threshold so the parent treats the whole geography as down. Under a Geographic parent this does nothing for routing: a geography maps to one endpoint, and Traffic Manager keeps answering with it even when Degraded. The threshold only matters under Priority, Weighted or Performance parents, where there is another endpoint to choose. That Geographic behaviour is also why the child profile needs two regions in the first place.

## Weighted cutovers without pretending weight can be zero

Weighted routing is a reasonable way to shift traffic between a blue and green deployment, as long as you remember it's DNS-level and sticky per resolver. Two details trip people up: [endpoint weights](https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods) must be between 1 and 1000, so you can't set a weight of 0 to drain an endpoint; and the shift isn't instant, because cached answers keep sending users to the old endpoint for at least a TTL.

The script below is a controlled rollout, not a timed sleep loop. Between steps, check per-endpoint error rates, and if they rise, abort: set the weights back to 100/1 or disable green.

```bash
#!/usr/bin/env bash
set -euo pipefail

RG="<your-resource-group>"
PROFILE="tm-<your-app>-weighted"
SOAK_SECONDS=300

set_weights() {
  az network traffic-manager endpoint update --resource-group "$RG" \
    --profile-name "$PROFILE" --type azureEndpoints --name blue --weight "$1" --output none
  az network traffic-manager endpoint update --resource-group "$RG" \
    --profile-name "$PROFILE" --type azureEndpoints --name green --weight "$2" --output none
  echo "blue=$1 green=$2"
}

# Gradual shift: 90/10, 50/50, 10/90, soaking between steps.
# Check per-endpoint error rates during each soak; on a regression, stop and run set_weights 100 1.
for green in 10 50 90; do
  set_weights $((100 - green)) "$green"
  sleep "$SOAK_SECONDS"
done

# Final step: take blue out of DNS entirely by disabling it
az network traffic-manager endpoint update --resource-group "$RG" \
  --profile-name "$PROFILE" --type azureEndpoints --name blue \
  --endpoint-status Disabled --output none
echo "blue disabled; rollback = re-enable blue and disable green"
```

Make the soak time several times your TTL, and watch error rates per endpoint, not overall. If you need per-request canarying, sticky user assignment or instant rollback, DNS is the wrong layer. Use the deployment slot traffic routing in App Service or a layer 7 entry point instead.

## Health endpoints that tell the truth

The probe is only as good as the URL it hits. The two failure modes I see most are a health endpoint that returns 200 because the web server is up while the database is unreachable, and the opposite: a deep check that fails because a non-critical dependency is slow, so Traffic Manager fails over a perfectly working region.

Split it. A readiness endpoint checks only what the region cannot serve without, and Traffic Manager probes that. Everything else goes to monitoring, not to routing. In ASP.NET Core 5 the built-in health checks make this a few lines in `Startup.cs`. `RegionalDatabaseHealthCheck` and `RecommendationsApiHealthCheck` stand in for your own `IHealthCheck` implementations:

```csharp
// Startup.cs fragment: register checks and expose a readiness endpoint for Traffic Manager
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

// In ConfigureServices
services.AddHealthChecks()
    .AddCheck<RegionalDatabaseHealthCheck>("regional-db", tags: new[] { "ready" })
    .AddCheck<RecommendationsApiHealthCheck>("recommendations", tags: new[] { "info" });

// In Configure, inside app.UseEndpoints(endpoints => { ... })
endpoints.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
    ResultStatusCodes =
    {
        [HealthStatus.Healthy] = StatusCodes.Status200OK,
        [HealthStatus.Degraded] = StatusCodes.Status200OK,
        [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable
    }
});
```

Degraded returns 200 on purpose: a region running slow is still better than failing everyone over to a region that is about to absorb double load. Keep the check cheap, too. Traffic Manager probes from many locations, so a 10-second interval generates far more requests than the interval suggests.

## Alert per endpoint, not per profile

Because of the fail-open rule, the profile can look "fine" while health checking is broken. Alert on the `ProbeAgentCurrentEndpointStateByProfileResourceId` metric, split by endpoint, so you hear about any single endpoint going down:

```bash
az monitor metrics alert create \
  --resource-group "<your-resource-group>" \
  --name tm-endpoint-down \
  --scopes "$(az network traffic-manager profile show \
      --resource-group "<your-resource-group>" --name "tm-<your-app>" --query id --output tsv)" \
  --condition "min ProbeAgentCurrentEndpointStateByProfileResourceId < 1 where EndpointName includes *" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --severity 1 \
  --action "<resource-id-of-your-action-group>"
```

Then test it. Disable the primary's health path or stop the app in a non-production profile and time the whole chain: probe detection, DNS change, and how long your real clients take to follow. That number is your failover time, not the one on the diagram.

## Where Traffic Manager stops being the answer

Traffic Manager is the right choice when you need protocol-agnostic failover (TCP services, non-HTTP endpoints, things outside Azure), when cost matters, or when you want a thin global layer over regional entry points like Application Gateway. It's the wrong choice when you need sub-minute failover regardless of client caching, per-request routing, TLS offload at the edge or a WAF in front of everything. That's what [Azure Front Door](/blog/2020-09-18-azure-front-door-global-loadbalancing/) is for: it terminates connections at the edge, so failover doesn't wait on anyone's DNS cache.

| | Traffic Manager | Front Door |
|---|---|---|
| Protocols | Any, because it only answers DNS | HTTP and HTTPS only |
| Failover speed | Probe detection plus TTL plus client caching | Edge reroutes per request, no DNS wait |
| TLS offload | None; clients connect straight to the endpoint | At the edge |
| WAF | None; put it on the regional entry point | WAF policy at the edge |
| Cost | Per DNS query and per monitored endpoint | Higher, billed on routing rules and data transfer |

My default for a public HTTP application is Front Door. My default for everything else that needs to survive a region outage is Traffic Manager with fast probing, a 30-second TTL, an honest readiness endpoint and an alert per endpoint. And if the database underneath isn't replicated and recoverable, none of this matters; routing is the easy half of [disaster recovery](/blog/2021-01-30-azure-site-recovery-dr/).
