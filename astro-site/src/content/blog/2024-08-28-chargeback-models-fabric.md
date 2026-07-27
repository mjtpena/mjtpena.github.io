---
title: "Chargeback Models for Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-28
tags:
  - Microsoft Fabric
  - Chargeback
  - Cost Allocation
  - FinOps
  - Governance

---

I wrote "Chargeback Models for Microsoft Fabric" to share practical, production-minded guidance on this topic.

## Chargeback vs Showback

```
Showback:
┌─────────────────────────────────────────────────────────────┐
│  "Your team used $5,000 worth of Fabric this month"         │
│                                                              │
│   ✓ Visibility into costs                                   │
│   ✓ No actual money transfer                                │
│   ✓ Awareness building                                      │
│   ✗ Limited accountability                                  │
└─────────────────────────────────────────────────────────────┘

Chargeback:
┌─────────────────────────────────────────────────────────────┐
│  "Your budget is charged $5,000 for Fabric usage"           │
│                                                              │
│   ✓ Full accountability                                     │
│   ✓ Budget impact                                           │
│   ✓ Drives optimization behavior                            │
│   ! Requires accurate allocation                            │
└─────────────────────────────────────────────────────────────┘
```

## Chargeback Models

### Model 1: Direct CU Consumption

```python
class DirectConsumptionChargeback:
    """Chargeback based on direct CU consumption."""

    def __init__(self, cost_per_cu_hour: float):
        self.cost_per_cu_hour = cost_per_cu_hour
        self.consumption_log = []

    def record_consumption(
        self,
        business_unit: str,
        workload_name: str,
        cu_hours: float,
        timestamp: str
    ):
        """Record CU consumption for a workload."""

        cost = cu_hours * self.cost_per_cu_hour

        self.consumption_log.append({
            "business_unit": business_unit,
            "workload": workload_name,
            "cu_hours": cu_hours,
            "cost": cost,
            "timestamp": timestamp
        })

    def generate_charges(self, period: str) -> dict:
        """Generate chargeback report for period."""

        period_entries = [
            e for e in self.consumption_log
            if e["timestamp"].startswith(period)
        ]

        # Aggregate by business unit
        charges = {}
        for entry in period_entries:
            bu = entry["business_unit"]
            if bu not in charges:
                charges[bu] = {
                    "total_cu_hours": 0,
                    "total_cost": 0,
                    "workloads": []
                }
            charges[bu]["total_cu_hours"] += entry["cu_hours"]
            charges[bu]["total_cost"] += entry["cost"]
            charges[bu]["workloads"].append({
                "name": entry["workload"],
                "cu_hours": entry["cu_hours"],
                "cost": entry["cost"]
            })

        return {
            "period": period,
            "charges": charges,
            "total_charged": sum(bu["total_cost"] for bu in charges.values())
        }

# Usage
chargeback = DirectConsumptionChargeback(cost_per_cu_hour=0.18)

# Record consumption
chargeback.record_consumption("Sales", "Daily ETL", 50, "2024-08-01")
chargeback.record_consumption("Sales", "Report Refresh", 20, "2024-08-01")
chargeback.record_consumption("Marketing", "Campaign Analytics", 30, "2024-08-01")
chargeback.record_consumption("Finance", "Budget Reports", 15, "2024-08-01")

# Generate charges
charges = chargeback.generate_charges("2024-08")

print("Chargeback Summary:")
for bu, details in charges["charges"].items():
    print(f"  {bu}: ${details['total_cost']:.2f} ({details['total_cu_hours']} CU-hours)")
```

### Model 2: Workspace-Based Allocation

```python
class WorkspaceChargeback:
    """Chargeback based on workspace assignment."""

    def __init__(self, total_monthly_cost: float):
        self.total_cost = total_monthly_cost
        self.workspaces = {}

    def assign_workspace(
        self,
        workspace_name: str,
        business_unit: str,
        cost_weight: float = 1.0
    ):
        """Assign workspace to business unit with optional weight."""

        self.workspaces[workspace_name] = {
            "business_unit": business_unit,
            "cost_weight": cost_weight
        }

    def set_workspace_usage(self, workspace_name: str, cu_hours: float):
        """Set actual usage for workspace."""

        if workspace_name in self.workspaces:
            self.workspaces[workspace_name]["cu_hours"] = cu_hours

    def calculate_charges(self, method: str = "usage") -> dict:
        """Calculate charges using specified method."""

        if method == "usage":
            return self._charge_by_usage()
        elif method == "weight":
            return self._charge_by_weight()
        elif method == "equal":
            return self._charge_equally()
        else:
            raise ValueError(f"Unknown method: {method}")

    def _charge_by_usage(self) -> dict:
        """Allocate cost proportional to CU usage."""

        total_usage = sum(
            ws.get("cu_hours", 0)
            for ws in self.workspaces.values()
        )

        charges = {}
        for ws_name, ws_data in self.workspaces.items():
            bu = ws_data["business_unit"]
            usage = ws_data.get("cu_hours", 0)

            proportion = usage / total_usage if total_usage > 0 else 0
            cost = self.total_cost * proportion

            if bu not in charges:
                charges[bu] = {"workspaces": [], "total_cost": 0}

            charges[bu]["workspaces"].append({
                "name": ws_name,
                "cu_hours": usage,
                "cost": cost
            })
            charges[bu]["total_cost"] += cost

        return charges

    def _charge_by_weight(self) -> dict:
        """Allocate cost by predefined weights."""

        total_weight = sum(
            ws.get("cost_weight", 1)
            for ws in self.workspaces.values()
        )

        charges = {}
        for ws_name, ws_data in self.workspaces.items():
            bu = ws_data["business_unit"]
            weight = ws_data.get("cost_weight", 1)

            proportion = weight / total_weight
            cost = self.total_cost * proportion

            if bu not in charges:
                charges[bu] = {"workspaces": [], "total_cost": 0}

            charges[bu]["workspaces"].append({
                "name": ws_name,
                "weight": weight,
                "cost": cost
            })
            charges[bu]["total_cost"] += cost

        return charges

    def _charge_equally(self) -> dict:
        """Allocate cost equally across all business units."""

        business_units = set(ws["business_unit"] for ws in self.workspaces.values())
        cost_per_bu = self.total_cost / len(business_units)

        return {
            bu: {"total_cost": cost_per_bu}
            for bu in business_units
        }

# Usage
workspace_chargeback = WorkspaceChargeback(total_monthly_cost=10000)

# Assign workspaces
workspace_chargeback.assign_workspace("Sales Analytics", "Sales", cost_weight=3.0)
workspace_chargeback.assign_workspace("Marketing Reports", "Marketing", cost_weight=2.0)
workspace_chargeback.assign_workspace("Finance Dashboard", "Finance", cost_weight=1.0)

# Set usage
workspace_chargeback.set_workspace_usage("Sales Analytics", 500)
workspace_chargeback.set_workspace_usage("Marketing Reports", 300)
workspace_chargeback.set_workspace_usage("Finance Dashboard", 100)

# Compare allocation methods
print("Usage-based allocation:")
for bu, details in workspace_chargeback.calculate_charges("usage").items():
    print(f"  {bu}: ${details['total_cost']:.2f}")

print("\nWeight-based allocation:")
for bu, details in workspace_chargeback.calculate_charges("weight").items():
    print(f"  {bu}: ${details['total_cost']:.2f}")
```

### Model 3: Tiered Chargeback

```python
class TieredChargeback:
    """Chargeback with tiered pricing based on usage."""

    def __init__(self):
        self.tiers = []
        self.usage = {}

    def define_tiers(
        self,
        tiers: list
    ):
        """Define usage tiers with different rates.

        tiers = [
            {"up_to_cu_hours": 100, "rate": 0.20},
            {"up_to_cu_hours": 500, "rate": 0.15},
            {"up_to_cu_hours": float('inf'), "rate": 0.10}
        ]
        """
        self.tiers = sorted(tiers, key=lambda x: x["up_to_cu_hours"])

    def record_usage(self, business_unit: str, cu_hours: float):
        """Record usage for business unit."""

        if business_unit not in self.usage:
            self.usage[business_unit] = 0

        self.usage[business_unit] += cu_hours

    def calculate_tiered_cost(self, cu_hours: float) -> dict:
        """Calculate cost using tiered pricing."""

        remaining = cu_hours
        total_cost = 0
        tier_breakdown = []
        previous_limit = 0

        for tier in self.tiers:
            tier_limit = tier["up_to_cu_hours"] - previous_limit
            tier_usage = min(remaining, tier_limit)

            if tier_usage > 0:
                tier_cost = tier_usage * tier["rate"]
                total_cost += tier_cost
                tier_breakdown.append({
                    "tier_range": f"{previous_limit}-{tier['up_to_cu_hours']}",
                    "cu_hours": tier_usage,
                    "rate": tier["rate"],
                    "cost": tier_cost
                })

            remaining -= tier_usage
            previous_limit = tier["up_to_cu_hours"]

            if remaining <= 0:
                break

        return {
            "total_cu_hours": cu_hours,
            "total_cost": total_cost,
            "effective_rate": total_cost / cu_hours if cu_hours > 0 else 0,
            "tier_breakdown": tier_breakdown
        }

    def generate_charges(self) -> dict:
        """Generate tiered charges for all business units."""

        charges = {}
        for bu, cu_hours in self.usage.items():
            charges[bu] = self.calculate_tiered_cost(cu_hours)

        return charges

# Usage
tiered = TieredChargeback()

# Define tiers (volume discounts)
tiered.define_tiers([
    {"up_to_cu_hours": 100, "rate": 0.25},   # First 100 hours at premium
    {"up_to_cu_hours": 500, "rate": 0.18},   # 100-500 at standard
    {"up_to_cu_hours": float('inf'), "rate": 0.12}  # 500+ at discount
])

# Record usage
tiered.record_usage("Sales", 600)
tiered.record_usage("Marketing", 200)
tiered.record_usage("Finance", 50)

# Generate charges
charges = tiered.generate_charges()

for bu, details in charges.items():
    print(f"{bu}:")
    print(f"  Total CU-hours: {details['total_cu_hours']}")
    print(f"  Total cost: ${details['total_cost']:.2f}")
    print(f"  Effective rate: ${details['effective_rate']:.3f}/CU-hour")
```

## Implementing Chargeback

### Step 1: Define Cost Centers

```python
class CostCenterManager:
    """Manage cost centers for chargeback."""

    def __init__(self):
        self.cost_centers = {}

    def create_cost_center(
        self,
        code: str,
        name: str,
        owner: str,
        budget: float,
        parent: str = None
    ):
        """Create a cost center."""

        self.cost_centers[code] = {
            "name": name,
            "owner": owner,
            "budget": budget,
            "parent": parent,
            "workspaces": [],
            "charges": []
        }

    def assign_workspace(self, cost_center_code: str, workspace_name: str):
        """Assign workspace to cost center."""

        if cost_center_code in self.cost_centers:
            self.cost_centers[cost_center_code]["workspaces"].append(workspace_name)

    def record_charge(
        self,
        cost_center_code: str,
        amount: float,
        description: str,
        period: str
    ):
        """Record a charge to cost center."""

        if cost_center_code in self.cost_centers:
            self.cost_centers[cost_center_code]["charges"].append({
                "amount": amount,
                "description": description,
                "period": period
            })

    def get_budget_status(self, cost_center_code: str) -> dict:
        """Get budget status for cost center."""

        cc = self.cost_centers.get(cost_center_code)
        if not cc:
            return {"error": "Cost center not found"}

        total_charges = sum(c["amount"] for c in cc["charges"])

        return {
            "cost_center": cc["name"],
            "budget": cc["budget"],
            "total_charges": total_charges,
            "remaining_budget": cc["budget"] - total_charges,
            "utilization_percent": total_charges / cc["budget"] * 100 if cc["budget"] > 0 else 0
        }

# Usage
cc_manager = CostCenterManager()

# Create cost centers
cc_manager.create_cost_center("SALES-001", "Sales Analytics", "John Smith", 5000)
cc_manager.create_cost_center("MKT-001", "Marketing Data", "Jane Doe", 3000)
cc_manager.create_cost_center("FIN-001", "Finance Reporting", "Bob Wilson", 2000)

# Assign workspaces
cc_manager.assign_workspace("SALES-001", "Sales Dashboard Workspace")
cc_manager.assign_workspace("SALES-001", "Sales ETL Workspace")
cc_manager.assign_workspace("MKT-001", "Marketing Analytics Workspace")

# Record charges
cc_manager.record_charge("SALES-001", 2500, "August compute usage", "2024-08")
cc_manager.record_charge("MKT-001", 1200, "August compute usage", "2024-08")

# Check budget status
status = cc_manager.get_budget_status("SALES-001")
print(f"Sales budget status: ${status['remaining_budget']:.2f} remaining ({status['utilization_percent']:.1f}% used)")
```

### Step 2: Automate Allocation

```python
class ChargebackAutomation:
    """Automate chargeback processes."""

    def __init__(self, cost_center_manager: CostCenterManager):
        self.cc_manager = cost_center_manager

    def process_monthly_charges(
        self,
        usage_data: dict,
        period: str
    ) -> dict:
        """Process end-of-month chargeback."""

        results = []

        for workspace, usage in usage_data.items():
            # Find cost center for workspace
            cost_center = self._find_cost_center(workspace)

            if cost_center:
                # Calculate charge
                charge_amount = usage["cu_hours"] * usage.get("rate", 0.18)

                # Record charge
                self.cc_manager.record_charge(
                    cost_center,
                    charge_amount,
                    f"Compute usage for {workspace}",
                    period
                )

                results.append({
                    "workspace": workspace,
                    "cost_center": cost_center,
                    "cu_hours": usage["cu_hours"],
                    "charge": charge_amount
                })
            else:
                results.append({
                    "workspace": workspace,
                    "cost_center": None,
                    "error": "No cost center assigned"
                })

        return {
            "period": period,
            "processed": len([r for r in results if "error" not in r]),
            "unallocated": len([r for r in results if "error" in r]),
            "details": results
        }

    def _find_cost_center(self, workspace: str) -> str:
        """Find cost center for workspace."""

        for code, cc in self.cc_manager.cost_centers.items():
            if workspace in cc["workspaces"]:
                return code
        return None

    def generate_invoice(self, cost_center_code: str, period: str) -> dict:
        """Generate invoice for cost center."""

        cc = self.cc_manager.cost_centers.get(cost_center_code)
        if not cc:
            return {"error": "Cost center not found"}

        period_charges = [
            c for c in cc["charges"]
            if c["period"] == period
        ]

        total = sum(c["amount"] for c in period_charges)

        return {
            "invoice_to": cc["name"],
            "owner": cc["owner"],
            "period": period,
            "line_items": period_charges,
            "subtotal": total,
            "total": total
        }

# Usage
automation = ChargebackAutomation(cc_manager)

# Process monthly usage
usage_data = {
    "Sales Dashboard Workspace": {"cu_hours": 300, "rate": 0.18},
    "Sales ETL Workspace": {"cu_hours": 400, "rate": 0.18},
    "Marketing Analytics Workspace": {"cu_hours": 200, "rate": 0.18},
    "Unassigned Workspace": {"cu_hours": 100, "rate": 0.18}
}

results = automation.process_monthly_charges(usage_data, "2024-08")
print(f"Processed: {results['processed']}, Unallocated: {results['unallocated']}")

# Generate invoice
invoice = automation.generate_invoice("SALES-001", "2024-08")
print(f"\nInvoice for {invoice['invoice_to']}:")
print(f"Total: ${invoice['total']:.2f}")
```

## Best Practices

1. **Start with showback**: Build understanding before chargeback
2. **Keep it simple**: Complex models create disputes
3. **Automate collection**: Manual processes don't scale
4. **Provide visibility**: Let teams see their consumption
5. **Review regularly**: Adjust models based on feedback

## Conclusion

Effective chargeback models drive accountability and efficient resource usage. Choose the model that fits your organization's culture and complexity, starting simple and evolving as needed.

Clear allocation rules, automation, and regular communication ensure chargeback success without creating friction between teams.

