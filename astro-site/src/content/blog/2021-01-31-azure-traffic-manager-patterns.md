---
title: Global Load Balancing with Azure Traffic Manager
author: Michael John Pena
draft: false
date: 2021-01-31
url: /blog/azure-traffic-manager-patterns/
tags:
  - Azure
  - Traffic Manager
  - Load Balancing
  - High Availability
  - DNS
---

Traffic Manager keeps showing up in my designs because it's cheap, simple, and works at the layer most failover stories actually need: DNS. The catch is that DNS-based failover is bounded by TTLs and client cache behaviour—if you don't account for that, your "10-minute failover" is a 60-minute failover with a long tail of customers stuck on the old endpoint. Today's post is the patterns I've used in anger: priority routing for active-passive, performance routing for global apps, nested profiles for multi-tier failover, and the TTL discipline that makes it all behave.

## Understanding Traffic Manager Routing Methods

Traffic Manager supports six routing methods:
- **Priority**: Active/passive failover
- **Weighted**: Distribute traffic by weight
- **Performance**: Route to closest region
- **Geographic**: Route based on user location
- **MultiValue**: Return multiple healthy endpoints
- **Subnet**: Route based on client IP ranges

## Setting Up Traffic Manager

### Bicep Template

```bicep
resource trafficManager 'Microsoft.Network/trafficmanagerprofiles@2018-08-01' = {
  name: 'tm-${applicationName}'
  location: 'global'
  properties: {
    profileStatus: 'Enabled'
    trafficRoutingMethod: 'Performance'
    dnsConfig: {
      relativeName: applicationName
      ttl: 60
    }
    monitorConfig: {
      protocol: 'HTTPS'
      port: 443
      path: '/health'
      intervalInSeconds: 30
      timeoutInSeconds: 10
      toleratedNumberOfFailures: 3
      customHeaders: [
        {
          name: 'Host'
          value: '${applicationName}.com'
        }
      ]
      expectedStatusCodeRanges: [
        {
          min: 200
          max: 299
        }
      ]
    }
  }
}

// Primary endpoint (East US)
resource primaryEndpoint 'Microsoft.Network/trafficmanagerprofiles/azureEndpoints@2018-08-01' = {
  parent: trafficManager
  name: 'primary-eastus'
  properties: {
    targetResourceId: appServiceEastUs.id
    endpointStatus: 'Enabled'
    weight: 100
    priority: 1
    endpointLocation: 'East US'
  }
}

// Secondary endpoint (West US)
resource secondaryEndpoint 'Microsoft.Network/trafficmanagerprofiles/azureEndpoints@2018-08-01' = {
  parent: trafficManager
  name: 'secondary-westus'
  properties: {
    targetResourceId: appServiceWestUs.id
    endpointStatus: 'Enabled'
    weight: 100
    priority: 2
    endpointLocation: 'West US'
  }
}

// Europe endpoint
resource europeEndpoint 'Microsoft.Network/trafficmanagerprofiles/azureEndpoints@2018-08-01' = {
  parent: trafficManager
  name: 'europe-westeurope'
  properties: {
    targetResourceId: appServiceWestEurope.id
    endpointStatus: 'Enabled'
    weight: 100
    priority: 3
    endpointLocation: 'West Europe'
  }
}
```

## Nested Traffic Manager Profiles

Combine routing methods for complex scenarios:

```bicep
// Parent profile - Geographic routing
resource parentProfile 'Microsoft.Network/trafficmanagerprofiles@2018-08-01' = {
  name: 'tm-global'
  location: 'global'
  properties: {
    profileStatus: 'Enabled'
    trafficRoutingMethod: 'Geographic'
    dnsConfig: {
      relativeName: 'myapp-global'
      ttl: 60
    }
    monitorConfig: {
      protocol: 'HTTPS'
      port: 443
      path: '/health'
    }
  }
}

// Child profile - Americas with Performance routing
resource americasProfile 'Microsoft.Network/trafficmanagerprofiles@2018-08-01' = {
  name: 'tm-americas'
  location: 'global'
  properties: {
    profileStatus: 'Enabled'
    trafficRoutingMethod: 'Performance'
    dnsConfig: {
      relativeName: 'myapp-americas'
      ttl: 60
    }
    monitorConfig: {
      protocol: 'HTTPS'
      port: 443
      path: '/health'
    }
  }
}

// Americas endpoints in child profile
resource usEastEndpoint 'Microsoft.Network/trafficmanagerprofiles/azureEndpoints@2018-08-01' = {
  parent: americasProfile
  name: 'us-east'
  properties: {
    targetResourceId: appServiceEastUs.id
    endpointStatus: 'Enabled'
    endpointLocation: 'East US'
  }
}

resource usWestEndpoint 'Microsoft.Network/trafficmanagerprofiles/azureEndpoints@2018-08-01' = {
  parent: americasProfile
  name: 'us-west'
  properties: {
    targetResourceId: appServiceWestUs.id
    endpointStatus: 'Enabled'
    endpointLocation: 'West US'
  }
}

// Nested endpoint in parent pointing to child
resource americasNestedEndpoint 'Microsoft.Network/trafficmanagerprofiles/nestedEndpoints@2018-08-01' = {
  parent: parentProfile
  name: 'americas'
  properties: {
    targetResourceId: americasProfile.id
    endpointStatus: 'Enabled'
    minChildEndpoints: 1
    geoMapping: ['GEO-NA', 'GEO-SA']  // North and South America
  }
}

// Europe child profile
resource europeProfile 'Microsoft.Network/trafficmanagerprofiles@2018-08-01' = {
  name: 'tm-europe'
  location: 'global'
  properties: {
    profileStatus: 'Enabled'
    trafficRoutingMethod: 'Weighted'  // A/B testing in Europe
    dnsConfig: {
      relativeName: 'myapp-europe'
      ttl: 60
    }
    monitorConfig: {
      protocol: 'HTTPS'
      port: 443
      path: '/health'
    }
  }
}

resource europeNestedEndpoint 'Microsoft.Network/trafficmanagerprofiles/nestedEndpoints@2018-08-01' = {
  parent: parentProfile
  name: 'europe'
  properties: {
    targetResourceId: europeProfile.id
    endpointStatus: 'Enabled'
    minChildEndpoints: 1
    geoMapping: ['GEO-EU']
  }
}
```

## Blue-Green Deployments

Use weighted routing for zero-downtime deployments:

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.trafficmanager import TrafficManagerManagementClient

credential = DefaultAzureCredential()
subscription_id = os.environ["SUBSCRIPTION_ID"]

tm_client = TrafficManagerManagementClient(credential, subscription_id)

class BlueGreenDeployment:
    def __init__(self, profile_name, resource_group):
        self.profile_name = profile_name
        self.resource_group = resource_group

    def get_profile(self):
        return tm_client.profiles.get(
            self.resource_group,
            self.profile_name
        )

    def shift_traffic(self, blue_weight: int, green_weight: int, step_delay: int = 60):
        """
        Gradually shift traffic from blue to green deployment.
        """
        profile = self.get_profile()

        blue_endpoint = next(
            e for e in profile.endpoints if 'blue' in e.name.lower()
        )
        green_endpoint = next(
            e for e in profile.endpoints if 'green' in e.name.lower()
        )

        current_blue = blue_endpoint.weight
        current_green = green_endpoint.weight

        # Calculate steps
        blue_diff = blue_weight - current_blue
        green_diff = green_weight - current_green
        steps = max(abs(blue_diff), abs(green_diff)) // 10

        if steps == 0:
            steps = 1

        blue_step = blue_diff / steps
        green_step = green_diff / steps

        print(f"Shifting traffic in {steps} steps...")

        for i in range(steps):
            new_blue = int(current_blue + (blue_step * (i + 1)))
            new_green = int(current_green + (green_step * (i + 1)))

            # Update weights
            blue_endpoint.weight = new_blue
            green_endpoint.weight = new_green

            tm_client.endpoints.update(
                self.resource_group,
                self.profile_name,
                'AzureEndpoints',
                blue_endpoint.name,
                {'weight': new_blue}
            )

            tm_client.endpoints.update(
                self.resource_group,
                self.profile_name,
                'AzureEndpoints',
                green_endpoint.name,
                {'weight': new_green}
            )

            print(f"Step {i + 1}/{steps}: Blue={new_blue}%, Green={new_green}%")

            # Wait before next step
            if i < steps - 1:
                time.sleep(step_delay)

        print("Traffic shift completed")

    def instant_switch(self, target: str):
        """
        Instantly switch all traffic to blue or green.
        """
        if target not in ['blue', 'green']:
            raise ValueError("Target must be 'blue' or 'green'")

        profile = self.get_profile()

        for endpoint in profile.endpoints:
            if target in endpoint.name.lower():
                endpoint.weight = 100
                endpoint.endpoint_status = 'Enabled'
            else:
                endpoint.weight = 0
                endpoint.endpoint_status = 'Disabled'

            tm_client.endpoints.update(
                self.resource_group,
                self.profile_name,
                'AzureEndpoints',
                endpoint.name,
                {
                    'weight': endpoint.weight,
                    'endpointStatus': endpoint.endpoint_status
                }
            )

        print(f"All traffic switched to {target}")

    def rollback(self):
        """
        Emergency rollback to blue deployment.
        """
        print("EMERGENCY ROLLBACK: Switching to blue deployment")
        self.instant_switch('blue')


# Usage
deployment = BlueGreenDeployment('tm-myapp', 'rg-production')

# Gradual deployment
deployment.shift_traffic(blue_weight=0, green_weight=100, step_delay=120)

# Or instant switch
deployment.instant_switch('green')

# Emergency rollback
deployment.rollback()
```

## Custom Health Probes

Implement sophisticated health checks:

```csharp
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Diagnostics.HealthChecks;

[ApiController]
[Route("health")]
public class HealthController : ControllerBase
{
    private readonly HealthCheckService _healthCheckService;
    private readonly ILogger<HealthController> _logger;

    public HealthController(
        HealthCheckService healthCheckService,
        ILogger<HealthController> logger)
    {
        _healthCheckService = healthCheckService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        // Run all health checks
        var report = await _healthCheckService.CheckHealthAsync();

        var response = new HealthCheckResponse
        {
            Status = report.Status.ToString(),
            Duration = report.TotalDuration,
            Checks = report.Entries.Select(e => new HealthCheckItem
            {
                Name = e.Key,
                Status = e.Value.Status.ToString(),
                Duration = e.Value.Duration,
                Description = e.Value.Description,
                Exception = e.Value.Exception?.Message
            }).ToList()
        };

        // Return appropriate status code for Traffic Manager
        return report.Status switch
        {
            HealthStatus.Healthy => Ok(response),
            HealthStatus.Degraded => Ok(response), // Still accept traffic
            HealthStatus.Unhealthy => StatusCode(503, response)
        };
    }

    [HttpGet("ready")]
    public async Task<IActionResult> Ready()
    {
        // Readiness check - is the app ready to receive traffic?
        var report = await _healthCheckService.CheckHealthAsync(
            predicate: check => check.Tags.Contains("ready")
        );

        if (report.Status == HealthStatus.Healthy)
        {
            return Ok(new { status = "ready" });
        }

        return StatusCode(503, new { status = "not ready" });
    }

    [HttpGet("live")]
    public IActionResult Live()
    {
        // Liveness check - is the app still running?
        return Ok(new { status = "alive", timestamp = DateTime.UtcNow });
    }
}

// Health check implementations
public class DatabaseHealthCheck : IHealthCheck
{
    private readonly IDbConnection _connection;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT 1";
            cmd.CommandTimeout = 5;

            await _connection.OpenAsync(cancellationToken);
            await cmd.ExecuteScalarAsync(cancellationToken);

            return HealthCheckResult.Healthy("Database connection successful");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy(
                "Database connection failed",
                exception: ex);
        }
    }
}

public class DependencyHealthCheck : IHealthCheck
{
    private readonly HttpClient _httpClient;
    private readonly string _dependencyUrl;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var response = await _httpClient.GetAsync(
                _dependencyUrl,
                cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                return HealthCheckResult.Healthy(
                    $"Dependency {_dependencyUrl} is healthy");
            }

            return HealthCheckResult.Degraded(
                $"Dependency returned {response.StatusCode}");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy(
                "Dependency check failed",
                exception: ex);
        }
    }
}

// Configure in Program.cs
builder.Services.AddHealthChecks()
    .AddCheck<DatabaseHealthCheck>("database", tags: new[] { "ready" })
    .AddCheck<DependencyHealthCheck>("api-dependency", tags: new[] { "ready" })
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: new[] { "live" });
```

## Monitoring and Alerting

```kusto
// KQL query for Traffic Manager endpoint health
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.NETWORK"
| where ResourceType == "TRAFFICMANAGERPROFILES"
| where Category == "ProbeHealthStatusEvents"
| extend EndpointName = tostring(split(endpoint_s, "/")[1])
| summarize
    HealthyProbes = countif(status_s == "Online"),
    UnhealthyProbes = countif(status_s == "Degraded" or status_s == "Disabled"),
    TotalProbes = count()
    by EndpointName, bin(TimeGenerated, 5m)
| extend HealthPercentage = round(100.0 * HealthyProbes / TotalProbes, 2)
| project TimeGenerated, EndpointName, HealthPercentage, HealthyProbes, UnhealthyProbes

// Alert rule for endpoint degradation
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.NETWORK"
| where ResourceType == "TRAFFICMANAGERPROFILES"
| where Category == "ProbeHealthStatusEvents"
| where status_s != "Online"
| project TimeGenerated, endpoint_s, status_s, message_s
```

### Azure Monitor Alert

```json
{
  "type": "Microsoft.Insights/metricAlerts",
  "apiVersion": "2018-03-01",
  "name": "tm-endpoint-unhealthy",
  "location": "global",
  "properties": {
    "description": "Alert when Traffic Manager endpoint becomes unhealthy",
    "severity": 1,
    "enabled": true,
    "scopes": [
      "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Network/trafficManagerProfiles/{profile}"
    ],
    "evaluationFrequency": "PT1M",
    "windowSize": "PT5M",
    "criteria": {
      "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
      "allOf": [
        {
          "name": "EndpointHealth",
          "metricName": "ProbeAgentCurrentEndpointStateByProfileResourceId",
          "dimensions": [
            {
              "name": "EndpointName",
              "operator": "Include",
              "values": ["*"]
            }
          ],
          "operator": "LessThan",
          "threshold": 1,
          "timeAggregation": "Minimum"
        }
      ]
    },
    "actions": [
      {
        "actionGroupId": "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Insights/actionGroups/ops-team"
      }
    ]
  }
}
```

## Integration with Azure Front Door

For additional features like WAF and caching, combine Traffic Manager with Front Door:

```bicep
// Traffic Manager for backend failover
resource backendTrafficManager 'Microsoft.Network/trafficmanagerprofiles@2018-08-01' = {
  name: 'tm-backend'
  location: 'global'
  properties: {
    profileStatus: 'Enabled'
    trafficRoutingMethod: 'Priority'
    dnsConfig: {
      relativeName: 'myapp-backend'
      ttl: 60
    }
    monitorConfig: {
      protocol: 'HTTPS'
      port: 443
      path: '/health'
    }
  }
}

// Front Door with Traffic Manager as backend
resource frontDoor 'Microsoft.Cdn/profiles@2021-06-01' = {
  name: 'fd-myapp'
  location: 'global'
  sku: {
    name: 'Premium_AzureFrontDoor'
  }
}

resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2021-06-01' = {
  parent: frontDoor
  name: 'myapp'
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

resource backendGroup 'Microsoft.Cdn/profiles/originGroups@2021-06-01' = {
  parent: frontDoor
  name: 'backend-group'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
    }
    healthProbeSettings: {
      probePath: '/health'
      probeRequestType: 'GET'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 30
    }
  }
}

resource trafficManagerOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2021-06-01' = {
  parent: backendGroup
  name: 'tm-origin'
  properties: {
    hostName: '${backendTrafficManager.properties.dnsConfig.relativeName}.trafficmanager.net'
    httpPort: 80
    httpsPort: 443
    originHostHeader: 'myapp.com'
    priority: 1
    weight: 1000
  }
}
```

## Best Practices

1. **TTL Configuration**: Use low TTL (60s) for faster failover
2. **Health Probes**: Implement comprehensive health endpoints
3. **Nested Profiles**: Combine routing methods for complex scenarios
4. **Monitoring**: Set up alerts for endpoint health changes
5. **Testing**: Regularly test failover scenarios
6. **DNS Propagation**: Account for DNS caching in clients
7. **Geographic Routing**: Use for compliance or data sovereignty requirements

Azure Traffic Manager enables sophisticated global load balancing strategies. Combined with proper health checks and monitoring, it ensures your applications remain available and performant for users worldwide.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
