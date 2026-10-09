---
title: "Right-Sizing Azure Resources: A Data-Driven Approach"
author: Michael John Peña
draft: false
date: 2022-12-23
tags:
  - Azure
  - Cost Optimization
  - Performance
  - Right-Sizing
  - Best Practices
---

## The Right-Sizing Process

1. **Collect metrics** - CPU, memory, network, IOPS
2. **Analyze patterns** - Peak, average, trends
3. **Identify candidates** - Under-utilized resources
4. **Recommend changes** - Size adjustments
5. **Implement safely** - Gradual changes with monitoring
6. **Validate** - Confirm performance is maintained

## Automated Analysis

```python
from azure.mgmt.monitor import MonitorManagementClient
from azure.mgmt.compute import ComputeManagementClient
from dataclasses import dataclass
from typing import List, Optional
import statistics

@dataclass
class VMMetrics:
    vm_name: str
    resource_group: str
    current_size: str
    avg_cpu: float
    max_cpu: float
    p95_cpu: float
    avg_memory: float
    max_memory: float
    avg_network_in: float
    avg_network_out: float
    avg_disk_iops: float

@dataclass
class RightSizingRecommendation:
    vm_name: str
    current_size: str
    recommended_size: str
    reason: str
    estimated_savings_percent: float
    confidence: str

class RightSizingAnalyzer:
    def __init__(self, subscription_id: str):
        credential = DefaultAzureCredential()
        self.compute_client = ComputeManagementClient(credential, subscription_id)
        self.monitor_client = MonitorManagementClient(credential, subscription_id)

    def collect_vm_metrics(self, vm, days: int = 14) -> VMMetrics:
        """Collect metrics for a VM over specified period."""

        resource_id = vm.id
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(days=days)

        # Collect CPU metrics
        cpu_data = self._get_metric_data(
            resource_id,
            "Percentage CPU",
            start_time,
            end_time
        )

        # Collect memory metrics (if available)
        memory_data = self._get_metric_data(
            resource_id,
            "Available Memory Bytes",
            start_time,
            end_time
        )

        # Collect network metrics
        network_in = self._get_metric_data(
            resource_id,
            "Network In Total",
            start_time,
            end_time
        )

        network_out = self._get_metric_data(
            resource_id,
            "Network Out Total",
            start_time,
            end_time
        )

        return VMMetrics(
            vm_name=vm.name,
            resource_group=vm.id.split('/')[4],
            current_size=vm.hardware_profile.vm_size,
            avg_cpu=statistics.mean(cpu_data) if cpu_data else 0,
            max_cpu=max(cpu_data) if cpu_data else 0,
            p95_cpu=self._percentile(cpu_data, 95) if cpu_data else 0,
            avg_memory=statistics.mean(memory_data) if memory_data else 0,
            max_memory=max(memory_data) if memory_data else 0,
            avg_network_in=statistics.mean(network_in) if network_in else 0,
            avg_network_out=statistics.mean(network_out) if network_out else 0,
            avg_disk_iops=0  # Would need disk metrics
        )

    def generate_recommendation(self, metrics: VMMetrics) -> Optional[RightSizingRecommendation]:
        """Generate right-sizing recommendation based on metrics."""

        # Define thresholds
        LOW_CPU_THRESHOLD = 20
        MEDIUM_CPU_THRESHOLD = 50

        # Get VM size details
        current_vcpus = self._get_vcpu_count(metrics.current_size)

        if metrics.p95_cpu < LOW_CPU_THRESHOLD:
            # Significantly over-provisioned
            target_vcpus = max(1, current_vcpus // 2)
            recommended = self._find_vm_size(target_vcpus, metrics.current_size)

            return RightSizingRecommendation(
                vm_name=metrics.vm_name,
                current_size=metrics.current_size,
                recommended_size=recommended,
                reason=f"P95 CPU ({metrics.p95_cpu:.1f}%) is very low",
                estimated_savings_percent=40,
                confidence="High"
            )

        elif metrics.p95_cpu < MEDIUM_CPU_THRESHOLD:
            # Moderately over-provisioned
            target_vcpus = max(1, int(current_vcpus * 0.75))
            recommended = self._find_vm_size(target_vcpus, metrics.current_size)

            if recommended != metrics.current_size:
                return RightSizingRecommendation(
                    vm_name=metrics.vm_name,
                    current_size=metrics.current_size,
                    recommended_size=recommended,
                    reason=f"P95 CPU ({metrics.p95_cpu:.1f}%) suggests smaller size sufficient",
                    estimated_savings_percent=25,
                    confidence="Medium"
                )

        return None

    def analyze_all_vms(self) -> List[RightSizingRecommendation]:
        """Analyze all VMs and generate recommendations."""

        recommendations = []

        for vm in self.compute_client.virtual_machines.list_all():
            if vm.instance_view and vm.instance_view.statuses:
                # Only analyze running VMs
                if any("running" in s.code.lower() for s in vm.instance_view.statuses):
                    metrics = self.collect_vm_metrics(vm)
                    rec = self.generate_recommendation(metrics)
                    if rec:
                        recommendations.append(rec)

        return sorted(
            recommendations,
            key=lambda x: x.estimated_savings_percent,
            reverse=True
        )
```

## Database Right-Sizing

```python
def analyze_sql_database_sizing(database_metrics: dict) -> dict:
    """Analyze Azure SQL Database for right-sizing."""

    recommendations = []

    # DTU-based databases
    if database_metrics["pricing_model"] == "DTU":
        avg_dtu = database_metrics["avg_dtu_consumption"]
        max_dtu = database_metrics["max_dtu_consumption"]
        provisioned_dtu = database_metrics["provisioned_dtu"]

        utilization = max_dtu / provisioned_dtu

        if utilization < 0.3:
            recommendations.append({
                "type": "Downsize DTU",
                "current": f"{provisioned_dtu} DTU",
                "recommended": f"{int(max_dtu * 1.3)} DTU",  # 30% headroom
                "reason": f"Max utilization only {utilization*100:.0f}%"
            })

        if utilization < 0.5:
            recommendations.append({
                "type": "Consider vCore",
                "reason": "vCore model may be more cost-effective for this usage"
            })

    # vCore-based databases
    elif database_metrics["pricing_model"] == "vCore":
        avg_cpu = database_metrics["avg_cpu_percent"]
        max_cpu = database_metrics["max_cpu_percent"]
        current_vcores = database_metrics["vcores"]

        if max_cpu < 40:
            target_vcores = max(2, int(current_vcores * (max_cpu / 60)))
            recommendations.append({
                "type": "Reduce vCores",
                "current": f"{current_vcores} vCores",
                "recommended": f"{target_vcores} vCores",
                "reason": f"Max CPU only {max_cpu:.0f}%"
            })

    return {
        "database": database_metrics["name"],
        "recommendations": recommendations
    }
```

## Cosmos DB Throughput Right-Sizing

```python
def analyze_cosmos_throughput(container_metrics: dict) -> dict:
    """Analyze Cosmos DB container for throughput optimization."""

    provisioned_ru = container_metrics["provisioned_ru"]
    avg_consumed_ru = container_metrics["avg_consumed_ru"]
    max_consumed_ru = container_metrics["max_consumed_ru"]
    throttle_rate = container_metrics.get("throttle_rate", 0)

    recommendations = []

    # Check for over-provisioning
    utilization = avg_consumed_ru / provisioned_ru
    peak_utilization = max_consumed_ru / provisioned_ru

    if peak_utilization < 0.3:
        recommendations.append({
            "type": "Reduce provisioned RU/s",
            "current": f"{provisioned_ru} RU/s",
            "recommended": f"{int(max_consumed_ru * 1.5)} RU/s",
            "reason": f"Peak utilization only {peak_utilization*100:.0f}%",
            "savings": f"~{(1 - peak_utilization/0.8) * 100:.0f}%"
        })

    # Check for high variability (autoscale candidate)
    if max_consumed_ru > avg_consumed_ru * 3:
        recommendations.append({
            "type": "Switch to Autoscale",
            "reason": f"High variability: avg {avg_consumed_ru:.0f}, max {max_consumed_ru:.0f}",
            "benefit": "Pay only for what you use"
        })

    # Check for serverless candidate
    if avg_consumed_ru < 1000 and max_consumed_ru < 5000:
        recommendations.append({
            "type": "Consider Serverless",
            "reason": "Low, variable usage pattern",
            "benefit": "Pay per request instead of provisioned"
        })

    return {
        "container": container_metrics["name"],
        "current_ru": provisioned_ru,
        "utilization": utilization,
        "recommendations": recommendations
    }
```

## Safe Implementation

```python
class RightSizingImplementer:
    def __init__(self, compute_client, monitor_client):
        self.compute_client = compute_client
        self.monitor_client = monitor_client

    async def implement_vm_resize(
        self,
        resource_group: str,
        vm_name: str,
        new_size: str,
        dry_run: bool = True
    ) -> dict:
        """Safely implement VM resize with validation."""

        # Pre-checks
        vm = self.compute_client.virtual_machines.get(resource_group, vm_name)
        old_size = vm.hardware_profile.vm_size

        result = {
            "vm": vm_name,
            "old_size": old_size,
            "new_size": new_size,
            "dry_run": dry_run,
            "steps": []
        }

        # Check if new size is available in region
        available_sizes = list(
            self.compute_client.virtual_machine_sizes.list(vm.location)
        )
        if new_size not in [s.name for s in available_sizes]:
            result["error"] = f"Size {new_size} not available in {vm.location}"
            return result

        result["steps"].append("Size availability verified")

        if dry_run:
            result["steps"].append("Dry run - no changes made")
            return result

        # Create snapshot before resize
        snapshot_id = await self._create_snapshot(vm)
        result["snapshot_id"] = snapshot_id
        result["steps"].append("Snapshot created")

        # Set up monitoring alerts
        alert_id = await self._create_performance_alert(vm)
        result["alert_id"] = alert_id
        result["steps"].append("Performance alert configured")

        # Resize VM
        vm.hardware_profile.vm_size = new_size
        operation = self.compute_client.virtual_machines.begin_create_or_update(
            resource_group,
            vm_name,
            vm
        )
        operation.wait()
        result["steps"].append("VM resized")

        # Validate performance
        await asyncio.sleep(300)  # Wait 5 minutes
        metrics = await self._collect_post_resize_metrics(vm)

        if metrics["error_rate"] > 0.01 or metrics["avg_response_time"] > baseline * 2:
            # Rollback
            await self._rollback_resize(vm, old_size)
            result["rolled_back"] = True
            result["steps"].append("Performance degradation detected - rolled back")
        else:
            result["steps"].append("Performance validated")

        return result
```

## Continuous Right-Sizing

```yaml
# Automated right-sizing pipeline
right_sizing_pipeline:
  schedule: "weekly"

  stages:
    - name: collect_metrics
      duration: "14 days of data"
      sources:
        - Azure Monitor
        - Log Analytics
        - Application Insights

    - name: analyze
      tasks:
        - Generate recommendations
        - Calculate potential savings
        - Prioritize by impact

    - name: review
      tasks:
        - Send report to stakeholders
        - Request approval for high-impact changes
        - Auto-approve low-risk changes

    - name: implement
      approach: "gradual"
      rules:
        - Start with dev/test environments
        - Production changes during maintenance windows
        - Automatic rollback on performance degradation

    - name: validate
      metrics:
        - Performance maintained
        - Cost reduction achieved
        - No incidents created
```

## Conclusion

Right-sizing is an ongoing process, not a one-time activity. Use data-driven analysis, implement changes safely with rollback capability, and continuously monitor for new optimization opportunities. The goal is optimal resource allocation - not just cost reduction - where performance meets requirements without waste.

## Resources

- [Azure Advisor Recommendations](https://docs.microsoft.com/azure/advisor/)
- [VM Sizes](https://docs.microsoft.com/azure/virtual-machines/sizes)
- [Azure Monitor Metrics](https://docs.microsoft.com/azure/azure-monitor/essentials/data-platform-metrics)
