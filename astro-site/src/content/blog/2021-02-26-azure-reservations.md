---
title: Maximizing Savings with Azure Reservations
description: "Reservations are the Azure cost conversation nobody has early enough. Pay-as-you-go is convenient; reserved instances are a commitment that rewards the…"
author: Michael John Peña
draft: false
date: 2021-02-26
url: /blog/azure-reservations/
tags:
  - Azure
  - Reservations
  - Cost Optimization
  - FinOps
  - Cloud Governance
---

Reservations are the Azure cost conversation nobody has early enough. Pay-as-you-go is convenient; reserved instances are a commitment that rewards the disciplined. The discount is real—up to 72% on compute compared to PAYG for a 3-year term—but the payoff requires knowing what you'll actually use, which is the thing most teams don't know when they start. My approach: run three to six months of PAYG, use the Reservation Recommendations in Cost Management (it analyses your actual usage), buy 1-year reserved for the stable baseline, and keep a PAYG buffer for the variable top. Don't over-commit on 3-year terms for anything you might resize.

## What Can Be Reserved?

Azure Reservations are available for:

- **Virtual Machines** - All VM series
- **Azure SQL Database** - vCore-based purchasing
- **Azure Cosmos DB** - Provisioned throughput
- **Azure Storage** - Reserved capacity for blob storage
- **Azure Databricks** - Databricks units
- **App Service** - Premium v3 instances
- **Azure Synapse Analytics** - Data warehousing units
- **Azure Cache for Redis** - Reserved capacity

## Analyzing Reservation Recommendations

### Using Azure Advisor

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.advisor import AdvisorManagementClient
from azure.mgmt.reservations import AzureReservationAPI
import pandas as pd

def get_reservation_recommendations(subscription_id):
    """Get Azure Advisor reservation recommendations."""

    credential = DefaultAzureCredential()
    advisor_client = AdvisorManagementClient(credential, subscription_id)

    # Get cost recommendations filtered for reservations
    recommendations = advisor_client.recommendations.list(
        filter="Category eq 'Cost'"
    )

    reservation_recs = []
    for rec in recommendations:
        if 'reservation' in rec.short_description.problem.lower():
            props = rec.extended_properties or {}
            reservation_recs.append({
                'resource_type': props.get('reservedResourceType', 'Unknown'),
                'recommended_quantity': props.get('qty', 0),
                'sku': props.get('sku', 'Unknown'),
                'term': props.get('term', '1Year'),
                'annual_savings': float(props.get('annualSavingsAmount', 0)),
                'savings_percentage': float(props.get('savingsPercentage', 0)),
                'region': props.get('region', 'Unknown')
            })

    return pd.DataFrame(reservation_recs).sort_values('annual_savings', ascending=False)

# Get recommendations
recommendations_df = get_reservation_recommendations(subscription_id)
print(recommendations_df.head(10))
```

### Custom Analysis

```python
from azure.mgmt.consumption import ConsumptionManagementClient
from datetime import datetime, timedelta

def analyze_vm_usage_for_reservations(subscription_id, days=30):
    """Analyze VM usage patterns to identify reservation candidates."""

    credential = DefaultAzureCredential()
    consumption_client = ConsumptionManagementClient(credential, subscription_id)

    start_date = datetime.now() - timedelta(days=days)
    end_date = datetime.now()

    # Get usage details
    usage = consumption_client.usage_details.list(
        scope=f"/subscriptions/{subscription_id}",
        filter=f"properties/usageStart ge '{start_date.isoformat()}' and properties/usageEnd le '{end_date.isoformat()}'"
    )

    vm_usage = {}
    for item in usage:
        if 'Virtual Machines' in str(item.consumed_service):
            key = f"{item.instance_id}_{item.resource_name}"
            if key not in vm_usage:
                vm_usage[key] = {
                    'resource_name': item.resource_name,
                    'resource_group': item.resource_group,
                    'meter_category': item.meter_category,
                    'total_hours': 0,
                    'total_cost': 0
                }
            vm_usage[key]['total_hours'] += float(item.quantity or 0)
            vm_usage[key]['total_cost'] += float(item.pretax_cost or 0)

    # Identify candidates for reservation (running >80% of time)
    candidates = []
    max_hours = days * 24

    for key, data in vm_usage.items():
        utilization = data['total_hours'] / max_hours * 100
        if utilization > 80:
            candidates.append({
                **data,
                'utilization_percent': utilization,
                'projected_annual_cost': data['total_cost'] * (365 / days)
            })

    return sorted(candidates, key=lambda x: x['projected_annual_cost'], reverse=True)

# Analyze
candidates = analyze_vm_usage_for_reservations(subscription_id, days=90)
for c in candidates[:10]:
    print(f"{c['resource_name']}: {c['utilization_percent']:.1f}% utilized, ${c['projected_annual_cost']:,.2f}/year")
```

## Purchasing Reservations

### Using Azure CLI

```bash
# List available reservations for VMs
az reservations catalog show \
    --subscription-id {subscription-id} \
    --reserved-resource-type VirtualMachines \
    --location eastus

# Purchase a reservation
az reservations reservation-order purchase \
    --reservation-order-id {order-id} \
    --sku Standard_D2s_v3 \
    --location eastus \
    --reserved-resource-type VirtualMachines \
    --billing-scope-id /subscriptions/{subscription-id} \
    --term P1Y \
    --quantity 10 \
    --applied-scope-type Shared \
    --display-name "D2s_v3 Reservation"
```

### Using Python SDK

```python
from azure.mgmt.reservations import AzureReservationAPI
from azure.mgmt.reservations.models import (
    PurchaseRequest,
    ReservedResourceType,
    InstanceFlexibility
)

def purchase_reservation(
    subscription_id,
    sku_name,
    location,
    quantity,
    term="P1Y",  # P1Y or P3Y
    display_name=None
):
    """Purchase an Azure Reservation."""

    credential = DefaultAzureCredential()
    client = AzureReservationAPI(credential)

    # Create purchase request
    purchase_request = PurchaseRequest(
        sku={"name": sku_name},
        location=location,
        reserved_resource_type=ReservedResourceType.VIRTUAL_MACHINES,
        billing_scope_id=f"/subscriptions/{subscription_id}",
        term=term,
        quantity=quantity,
        applied_scope_type="Shared",
        display_name=display_name or f"{sku_name} Reservation",
        reserved_resource_properties={
            "instanceFlexibility": InstanceFlexibility.ON
        }
    )

    # Calculate purchase (what-if)
    calculation = client.reservation_order.calculate(purchase_request)
    print(f"Total cost: ${calculation.properties.total_cost.amount:,.2f}")
    print(f"Currency: {calculation.properties.total_cost.currency_code}")

    # Confirm purchase
    # Note: In production, add confirmation step
    # result = client.reservation_order.purchase(
    #     reservation_order_id=calculation.reservation_order_id,
    #     body=purchase_request
    # )

    return calculation
```

## Managing Reservations

### View Reservations

```python
def list_reservations():
    """List all reservations in the tenant."""

    credential = DefaultAzureCredential()
    client = AzureReservationAPI(credential)

    reservations = client.reservation.list_all()

    for res in reservations:
        print(f"\nReservation: {res.name}")
        print(f"  SKU: {res.sku.name}")
        print(f"  Term: {res.properties.term}")
        print(f"  Quantity: {res.properties.quantity}")
        print(f"  Effective Date: {res.properties.effective_date_time}")
        print(f"  Expiry Date: {res.properties.expiry_date}")
        print(f"  Utilization: {res.properties.utilization}")

def check_reservation_utilization(reservation_id):
    """Check utilization of a specific reservation."""

    credential = DefaultAzureCredential()
    client = AzureReservationAPI(credential)

    # Get utilization summaries
    utilization = client.reservation.list_utilization_summaries(
        reservation_order_id=reservation_id.split('/')[0],
        reservation_id=reservation_id.split('/')[1],
        grain="daily",
        filter=f"properties/usageDate ge 2021-02-01 and properties/usageDate le 2021-02-28"
    )

    for summary in utilization:
        print(f"Date: {summary.usage_date}, Utilization: {summary.utilization}%")
```

### Modify Reservations

```bash
# Split a reservation
az reservations reservation split \
    --reservation-order-id {order-id} \
    --reservation-id {reservation-id} \
    --quantities [3, 7]  # Split 10 into 3 and 7

# Merge reservations
az reservations reservation merge \
    --reservation-order-id {order-id} \
    --sources "['/providers/Microsoft.Capacity/reservationOrders/{order-id}/reservations/{res-id-1}', '/providers/Microsoft.Capacity/reservationOrders/{order-id}/reservations/{res-id-2}']"

# Change scope
az reservations reservation update \
    --reservation-order-id {order-id} \
    --reservation-id {reservation-id} \
    --applied-scope-type Single \
    --applied-scopes ['/subscriptions/{subscription-id}']
```

## Exchange and Refund

```bash
# Calculate exchange value
az reservations calculate-exchange \
    --ris-to-exchange '[{"reservationId":"/providers/Microsoft.Capacity/reservationOrders/{order-id}/reservations/{reservation-id}","quantity":5}]' \
    --ris-to-purchase '[{"reservedResourceType":"VirtualMachines","billingScopeId":"/subscriptions/{sub-id}","term":"P1Y","quantity":5,"displayName":"New Reservation","appliedScopeType":"Shared","sku":{"name":"Standard_D4s_v3"},"location":"eastus"}]'

# Execute exchange
az reservations exchange \
    --ris-to-exchange '[...]' \
    --ris-to-purchase '[...]'

# Request refund
az reservations return \
    --reservation-order-id {order-id} \
    --reservation-id {reservation-id} \
    --quantity 5 \
    --return-reason "No longer needed"
```

## Reservation Scope Options

### Shared Scope

Reservation applies to all subscriptions in the billing context:

```python
purchase_request = PurchaseRequest(
    # ...
    applied_scope_type="Shared",
    billing_scope_id="/providers/Microsoft.Billing/billingAccounts/{billing-account-id}"
)
```

### Single Subscription

```python
purchase_request = PurchaseRequest(
    # ...
    applied_scope_type="Single",
    applied_scopes=[f"/subscriptions/{subscription_id}"]
)
```

### Resource Group

```python
purchase_request = PurchaseRequest(
    # ...
    applied_scope_type="Single",
    applied_scopes=[f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}"]
)
```

## Monitoring Reservation Usage

```kusto
// Reservation utilization over time
AzureActivity
| where CategoryValue == "Recommendation"
| where OperationNameValue contains "Reservation"
| project TimeGenerated, Properties = parse_json(Properties)
| extend Utilization = Properties.utilizationPercentage
| summarize AvgUtilization = avg(todouble(Utilization)) by bin(TimeGenerated, 1d)
| render timechart
```

## Best Practices

1. **Analyze usage patterns** before purchasing - ensure consistent usage
2. **Start with Shared scope** for maximum flexibility
3. **Enable instance size flexibility** for VMs
4. **Monitor utilization** regularly and adjust as needed
5. **Consider 3-year terms** for stable workloads (higher discount)
6. **Use exchange/refund** to optimize underutilized reservations
7. **Combine with Hybrid Benefit** for additional savings

## Conclusion

Azure Reservations can significantly reduce cloud costs for predictable workloads. The key is to analyze your usage patterns, start conservatively, and monitor utilization to ensure you're getting maximum value from your commitment.

Start with your largest, most consistent workloads and expand reservation coverage as you gain confidence in your usage patterns.
