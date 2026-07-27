---
title: "Auto-Scaling Best Practices in Azure"
author: Michael John Peña
draft: false
date: 2022-12-22
tags:
  - Azure
  - Auto-Scaling
  - Performance
  - Cost Optimization
  - Best Practices

---

I wrote "Auto-Scaling Best Practices in Azure" to share practical, production-minded guidance on this topic.

## Auto-Scaling Fundamentals

### Key Metrics to Scale On

```yaml
scaling_metrics:
  compute:
    primary:
      - CPU percentage
      - Memory percentage
    secondary:
      - Request count
      - Response time
      - Queue depth

  app_service:
    primary:
      - CPU percentage
      - Memory percentage
    secondary:
      - HTTP queue length
      - Data in/out
      - Request count

  aks:
    primary:
      - CPU utilization
      - Memory utilization
    secondary:
      - Custom metrics (Prometheus)
      - External metrics (Azure Monitor)
```

## VMSS Auto-Scaling

```bicep
resource autoscaleSettings 'Microsoft.Insights/autoscalesettings@2022-10-01' = {
  name: 'vmss-autoscale'
  location: location
  properties: {
    name: 'vmss-autoscale'
    targetResourceUri: vmss.id
    enabled: true
    profiles: [
      {
        name: 'Default'
        capacity: {
          minimum: '2'
          maximum: '20'
          default: '4'
        }
        rules: [
          // Scale out on high CPU
          {
            metricTrigger: {
              metricName: 'Percentage CPU'
              metricResourceUri: vmss.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 70
            }
            scaleAction: {
              direction: 'Increase'
              type: 'ChangeCount'
              value: '2'
              cooldown: 'PT5M'
            }
          }
          // Scale in on low CPU
          {
            metricTrigger: {
              metricName: 'Percentage CPU'
              metricResourceUri: vmss.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT10M'  // Longer window for scale-in
              timeAggregation: 'Average'
              operator: 'LessThan'
              threshold: 30
            }
            scaleAction: {
              direction: 'Decrease'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT10M'  // Longer cooldown for scale-in
            }
          }
        ]
      }
      // Schedule-based profile for known patterns
      {
        name: 'BusinessHours'
        capacity: {
          minimum: '4'
          maximum: '20'
          default: '6'
        }
        recurrence: {
          frequency: 'Week'
          schedule: {
            timeZone: 'Pacific Standard Time'
            days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
            hours: [8]
            minutes: [0]
          }
        }
        rules: []  // Uses metric rules from Default profile
      }
      {
        name: 'AfterHours'
        capacity: {
          minimum: '2'
          maximum: '10'
          default: '2'
        }
        recurrence: {
          frequency: 'Week'
          schedule: {
            timeZone: 'Pacific Standard Time'
            days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
            hours: [18]
            minutes: [0]
          }
        }
        rules: []
      }
    ]
    notifications: [
      {
        operation: 'Scale'
        email: {
          sendToSubscriptionAdministrator: false
          customEmails: ['ops-team@company.com']
        }
        webhooks: [
          {
            serviceUri: 'https://hooks.slack.com/...'
          }
        ]
      }
    ]
  }
}
```

## Kubernetes Auto-Scaling

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 50
  metrics:
    # CPU-based scaling
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70

    # Memory-based scaling
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80

    # Custom metric from Prometheus
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: 100

  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 4
          periodSeconds: 60
      selectPolicy: Max

    scaleDown:
      stabilizationWindowSeconds: 300  # 5 minutes stabilization
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
      selectPolicy: Min
```

### Cluster Autoscaler

```yaml
# AKS cluster with autoscaler
resource aks 'Microsoft.ContainerService/managedClusters@2022-07-01' = {
  name: 'aks-cluster'
  location: location
  properties: {
    agentPoolProfiles: [
      {
        name: 'system'
        count: 3
        vmSize: 'Standard_D4s_v3'
        mode: 'System'
        enableAutoScaling: true
        minCount: 3
        maxCount: 5
      }
      {
        name: 'workload'
        count: 5
        vmSize: 'Standard_D8s_v3'
        mode: 'User'
        enableAutoScaling: true
        minCount: 3
        maxCount: 20
        scaleSetPriority: 'Regular'
      }
      {
        name: 'spot'
        count: 0
        vmSize: 'Standard_D8s_v3'
        mode: 'User'
        enableAutoScaling: true
        minCount: 0
        maxCount: 50
        scaleSetPriority: 'Spot'
        scaleSetEvictionPolicy: 'Delete'
        spotMaxPrice: -1
      }
    ]
    autoScalerProfile: {
      balanceSimilarNodeGroups: 'true'
      scanInterval: '10s'
      scaleDownDelayAfterAdd: '10m'
      scaleDownDelayAfterDelete: '10s'
      scaleDownUnneededTime: '10m'
      scaleDownUtilizationThreshold: '0.5'
    }
  }
}
```

### KEDA for Event-Driven Scaling

```yaml
# KEDA ScaledObject for queue-based scaling
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: queue-processor-scaler
spec:
  scaleTargetRef:
    name: queue-processor
  pollingInterval: 15
  cooldownPeriod: 300
  minReplicaCount: 0  # Scale to zero when no messages
  maxReplicaCount: 100
  triggers:
    - type: azure-servicebus
      metadata:
        queueName: orders
        messageCount: "10"  # 1 pod per 10 messages
        connectionFromEnv: SERVICEBUS_CONNECTION
```

## App Service Auto-Scaling

```csharp
// Programmatic auto-scaling configuration
using Azure.ResourceManager.AppService;
using Azure.ResourceManager.Monitor;

public async Task ConfigureAutoScaling(string resourceGroupName, string planName)
{
    var autoscaleSettings = new AutoscaleSettingData(
        location: AzureLocation.WestUS2,
        profiles: new[]
        {
            new AutoscaleProfile(
                name: "Default",
                capacity: new ScaleCapacity(minimum: "2", maximum: "10", @default: "2"),
                rules: new[]
                {
                    // Scale out
                    new ScaleRule(
                        metricTrigger: new MetricTrigger(
                            metricName: "CpuPercentage",
                            metricResourceUri: appServicePlanId,
                            timeGrain: TimeSpan.FromMinutes(1),
                            statistic: MetricStatisticType.Average,
                            timeWindow: TimeSpan.FromMinutes(5),
                            timeAggregation: TimeAggregationType.Average,
                            @operator: ComparisonOperationType.GreaterThan,
                            threshold: 70
                        ),
                        scaleAction: new ScaleAction(
                            direction: ScaleDirection.Increase,
                            scaleType: ScaleType.ChangeCount,
                            value: "1",
                            cooldown: TimeSpan.FromMinutes(5)
                        )
                    ),
                    // Scale in
                    new ScaleRule(
                        metricTrigger: new MetricTrigger(
                            metricName: "CpuPercentage",
                            metricResourceUri: appServicePlanId,
                            timeGrain: TimeSpan.FromMinutes(1),
                            statistic: MetricStatisticType.Average,
                            timeWindow: TimeSpan.FromMinutes(10),
                            timeAggregation: TimeAggregationType.Average,
                            @operator: ComparisonOperationType.LessThan,
                            threshold: 30
                        ),
                        scaleAction: new ScaleAction(
                            direction: ScaleDirection.Decrease,
                            scaleType: ScaleType.ChangeCount,
                            value: "1",
                            cooldown: TimeSpan.FromMinutes(10)
                        )
                    )
                }
            )
        },
        isEnabled: true,
        targetResourceUri: appServicePlanId
    );

    await _monitorClient.AutoscaleSettings.CreateOrUpdateAsync(
        resourceGroupName,
        $"{planName}-autoscale",
        autoscaleSettings
    );
}
```

## Best Practices

```python
autoscaling_best_practices = {
    "scale_out_quickly": {
        "description": "Scale out faster than you scale in",
        "scale_out_window": "5 minutes",
        "scale_in_window": "10-15 minutes",
        "reason": "User experience matters more than cost during spikes"
    },

    "use_multiple_metrics": {
        "description": "Don't rely on single metric",
        "example": "CPU AND request count AND response time",
        "reason": "Different workloads stress different resources"
    },

    "set_appropriate_cooldowns": {
        "description": "Prevent scaling thrashing",
        "scale_out_cooldown": "5 minutes minimum",
        "scale_in_cooldown": "10 minutes minimum",
        "reason": "New instances need time to warm up and stabilize"
    },

    "test_scaling_behavior": {
        "description": "Load test your auto-scaling",
        "tools": ["Azure Load Testing", "k6", "Locust"],
        "verify": ["Scaling triggers correctly", "Application handles scaling", "No data loss"]
    },

    "monitor_and_alert": {
        "description": "Track scaling events",
        "alerts": ["Max capacity reached", "Scaling failures", "Unusual patterns"]
    }
}
```

## Common Mistakes

```yaml
scaling_mistakes:
  too_aggressive_scale_in:
    problem: Instances removed too quickly
    symptom: Repeated scale-out/scale-in cycles
    fix: Increase scale-in cooldown and stabilization window

  wrong_metric:
    problem: Scaling on metric that doesn't reflect load
    symptom: Over/under provisioned during actual load
    fix: Use request-based or custom application metrics

  no_pre_warming:
    problem: Cold instances can't handle traffic
    symptom: Errors during scale-out
    fix: Pre-warm instances, use health checks with delay

  ignoring_startup_time:
    problem: Instances need time to start
    symptom: Scale-out doesn't help immediately
    fix: Scale earlier based on trends, use predictive scaling
```

## Conclusion

Auto-scaling is powerful but requires careful tuning. Start with conservative settings, monitor behavior, and adjust based on real data. Combine metric-based scaling with schedule-based profiles for predictable patterns. Always test your scaling behavior under load before relying on it in production.

## Resources

- [Azure Autoscale](https://docs.microsoft.com/azure/azure-monitor/autoscale/autoscale-overview)
- [VMSS Autoscale](https://docs.microsoft.com/azure/virtual-machine-scale-sets/virtual-machine-scale-sets-autoscale-overview)
- [AKS Autoscaler](https://docs.microsoft.com/azure/aks/cluster-autoscaler)
- [KEDA](https://keda.sh/)

