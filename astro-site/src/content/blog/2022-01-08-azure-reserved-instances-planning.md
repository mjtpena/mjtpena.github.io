---
title: "Sizing an Azure VM Reservation: Buy the Floor, Not the Average"
description: "How to work out how many Azure Reserved VM Instances to buy: find your steady usage floor, use instance size flexibility, and read the recommendations API."
author: Michael John Peña
draft: false
date: 2022-01-08
url: /blog/azure-reserved-instances-planning/
tags:
  - Azure
  - Cost Optimization
  - Reserved Instances
  - FinOps
---

Most teams agree that Azure Reserved VM Instances save money. Where they go wrong is the quantity. Buy too few and you leave the discount on the table; buy too many and you pay every hour for capacity nothing is using, which can wipe out the saving on the rest. The useful question is not "should we reserve?" but "how many units, of which size group, at which scope?"

## What you are actually buying

A VM reservation is a billing discount, not a VM. You commit to one or three years of a VM size in a region, and every hour Azure looks for running VMs that match and applies the reserved rate to them instead of the pay-as-you-go rate. Two consequences follow, and both matter for sizing:

- **It is use-it-or-lose-it, by the hour.** If you reserve ten units and only six are running for a given hour, the four unused hours are gone. They don't roll over to next hour or next month.
- **It covers compute only.** For Windows VMs, the reservation discounts the infrastructure meter, not the Windows licence. You need Azure Hybrid Benefit to cover the licence part.

By default a reservation does not hold capacity for you. For reservations scoped to a single subscription you can switch the "Optimize for" setting from instance size flexibility to capacity priority, but if you need guaranteed capacity in a region, that is a different product: [on-demand capacity reservations](https://learn.microsoft.com/azure/virtual-machines/capacity-reservation-overview), which are in public preview as I write this. Keep the two ideas separate. One is a price, the other is a promise of hardware. (For the broader tour of what can be reserved and how purchasing works, see [Maximizing Savings with Azure Reservations](/blog/2021-02-26-azure-reservations/).)

## Why the average is the wrong number

Because unused hours are lost, the right amount to reserve is driven by your floor (the lowest level of usage you hold almost every hour), not your average.

Picture a workload that runs 20 VMs during business hours and 8 overnight and at weekends. The average is somewhere around 12. If you reserve 12, you pay for 4 idle reserved units every night and every weekend. If you reserve 8, every reserved hour is used and the remaining 12 daytime VMs stay on pay-as-you-go, or better, get shut down or autoscaled when nobody needs them.

There is a simple break-even test for anything above the floor. If a reservation gives you a discount of *d* against pay-as-you-go, a reserved unit pays for itself only if it is used for more than (1 − *d*) of the hours in the term. With a hypothetical 40% discount, a unit has to be busy more than 60% of the time. Units that only run during business hours (roughly 27% of the week) fail that test easily, no matter how attractive the headline discount looks. Microsoft quotes savings of up to 72% compared with pay-as-you-go, but that is the best case for a three-year term on specific sizes, not a number to plan with. Use the actual prices for your size and region from the [Reserved VM Instances documentation](https://learn.microsoft.com/azure/virtual-machines/prepay-reserved-vm-instances) and the pricing calculator.

My rule of thumb: reserve the floor, then revisit in a quarter. Topping up later is easy. Unwinding an oversized commitment is not.

## Instance size flexibility changes the unit of measure

Counting VMs by exact size understates how much you can cover. With instance size flexibility (the default setting), a reservation applies to any size in the same [instance size flexibility group](https://learn.microsoft.com/azure/virtual-machines/reserved-vm-instance-size-flexibility) in the same region, using a ratio for each size.

Within the Dsv3 group, for example, a D4s_v3 is twice a D2s_v3 and a D8s_v3 is twice a D4s_v3. So one D4s_v3 reservation covers two D2s_v3 VMs, or half of a D8s_v3. If you run four D2s_v3, two D4s_v3 and one D8s_v3, that is the equivalent of six D4s_v3 units:

| VM size | Count | D4s_v3 equivalent |
|---|---|---|
| Standard_D2s_v3 | 4 | 2 |
| Standard_D4s_v3 | 2 | 2 |
| Standard_D8s_v3 | 1 | 2 |
| **Total** | 7 | **6** |

This is the number to plan with: normalised units per flexibility group per region. It also means teams can resize within the group (D4s_v3 up to D8s_v3, say) without breaking the reservation. What it doesn't cover is a move to a different series, such as Dsv3 to Dsv4, or to another region. Those need an exchange.

A quick inventory from Azure Resource Graph gives you the starting shape of the estate:

```kusto
Resources
| where type =~ "microsoft.compute/virtualmachines"
| extend vmSize = tostring(properties.hardwareProfile.vmSize)
| extend power = tostring(properties.extended.instanceView.powerState.code)
| summarize VMs = count() by vmSize, location, power
| order by location asc, power asc, VMs desc
```

Only the `PowerState/running` rows matter for a reservation, since stopped and deallocated VMs earn no discount; add `| where power == "PowerState/running"` before the summarise if you want the running fleet alone. Even then, treat this as a snapshot. It tells you what is running right now, not how many hours each VM actually ran. For sizing you need usage history.

## Let the recommendations API do the hourly maths

Azure already calculates hourly usage per flexibility group for you. The [Reservation Recommendations API](https://learn.microsoft.com/rest/api/consumption/reservation-recommendations/list) in `Microsoft.Consumption` returns a recommended quantity based on a 7, 30 or 60-day look-back, along with the normalised quantity and expected net savings. The same data powers the recommendations in the portal and in Azure Advisor.

The trick I find most useful is to pull all three look-back periods side by side. If the 7-day recommendation is much higher than the 60-day one, your usage is growing or spiky, and the 60-day number is the safer commitment. If they agree, the workload is stable and you can buy with more confidence.

The response has two shapes. Enterprise Agreement and other older billing accounts return `kind: legacy` with plain numbers; Microsoft Customer Agreement accounts return `kind: modern`, where costs and savings are objects with `value` and `currency`. The script below handles both. I call the REST endpoint directly so the legacy and modern response shapes stay visible; `azure-mgmt-consumption` 9.x wraps the same 2021-10-01 API if you'd rather use the SDK.

```python
# pip install azure-identity requests
import requests
from azure.identity import DefaultAzureCredential

SUBSCRIPTION_ID = "<your-subscription-id>"
API_VERSION = "2021-10-01"
LOOK_BACKS = ["Last7Days", "Last30Days", "Last60Days"]


def amount(value):
    """Legacy recommendations return numbers; modern ones return {value, currency}."""
    if isinstance(value, dict):
        return value.get("value", 0.0)
    return value or 0.0


def get_recommendations(token, look_back):
    url = (
        f"https://management.azure.com/subscriptions/{SUBSCRIPTION_ID}"
        "/providers/Microsoft.Consumption/reservationRecommendations"
    )
    params = {
        "api-version": API_VERSION,
        "$filter": (
            "properties/scope eq 'Single' "
            f"and properties/lookBackPeriod eq '{look_back}' "
            "and properties/resourceType eq 'VirtualMachines'"
        ),
    }
    headers = {"Authorization": f"Bearer {token}"}
    results = []
    while url:
        response = requests.get(url, headers=headers, params=params, timeout=60)
        response.raise_for_status()
        body = response.json()
        results.extend(body.get("value", []))
        url = body.get("nextLink")
        params = None  # nextLink already includes the query string
    return results


def main():
    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default").token

    for look_back in LOOK_BACKS:
        print(f"=== {look_back} ===")
        for rec in get_recommendations(token, look_back):
            p = rec["properties"]
            print(
                f"{rec.get('location') or p.get('location') or '?':<14} "
                f"{p.get('instanceFlexibilityGroup') or '?':<28} "
                f"size={p.get('normalizedSize') or '?':<18} "
                f"qty={p.get('recommendedQuantity') or 0:>5} "
                f"normalised={p.get('recommendedQuantityNormalized') or 0:>7} "
                f"term={p.get('term') or '?'} "
                f"net_savings={amount(p.get('netSavings')):,.2f}"
            )


if __name__ == "__main__":
    main()
```

Run it with an identity that can read cost data for the subscription (for example via `az login` locally). Use `'Shared'` instead of `'Single'` in the filter to see what a shared-scope reservation would look like across the billing context.

The API is a calculator, not a decision. It doesn't know that a project is ending in March, that you're migrating to a newer VM series, or that half the fleet should be switched off at night. Cross-check every line against what you know about the roadmap.

## Pick the scope deliberately

Scope decides which VMs are eligible for the discount, and therefore how likely you are to use every reserved hour.

| Scope | Discount applies to | When I'd use it |
|---|---|---|
| Shared | Matching VMs in any subscription in the billing context | The default for most organisations; highest chance of full utilisation |
| Single subscription | Matching VMs in one subscription | Chargeback is per subscription, or you want capacity priority |
| Single resource group | Matching VMs in one resource group | A team funds its own reservation and wants the saving to stay with it |
| Management group | Matching VMs in subscriptions under that management group (in the billing context) | Business units mapped to management groups; in preview at the time of writing |

Narrow scopes look tidy on an internal invoice but strand reserved hours whenever that one subscription shrinks. I'd start with shared scope and solve chargeback with reporting, then narrow only where there is a strong political or budget reason. You can change the scope after purchase, so this isn't a one-way door.

## When not to reserve

Reservations are the wrong tool, or at least premature, in a few situations:

- **You haven't right-sized yet.** Reserving an oversized fleet locks in the waste. Fix sizes and shutdown schedules first, then reserve what remains. This is the same order I argued for in the [AKS cost review](/blog/2022-01-05-aks-cost-optimization/).
- **The workload is about to change shape.** A migration to PaaS, a move to a newer VM series, or a region consolidation in the next few months all argue for waiting.
- **The usage is bursty or interruptible.** Batch and dev/test fleets are usually better served by autoscale, scheduled shutdown or Spot VMs than by a commitment.
- **Nobody owns it after purchase.** A reservation with no one watching its utilisation will drift as the estate changes.

If you do overbuy, you have options. Reservations can be exchanged for another of the same type (for example, a different VM series or region), with the remaining value credited towards the new purchase, provided the new reservation is worth at least as much as the remaining value of the old one. Refunds are also possible but capped at USD 50,000 in a rolling 12-month window, so treat them as a safety net rather than a plan. The [exchange and refund policy](https://learn.microsoft.com/azure/cost-management-billing/reservations/exchange-and-refund-azure-reservations) has the details.

## The sizing decision in one paragraph

Normalise your VMs into flexibility-group units per region, pull the 7, 30 and 60-day recommendations, and commit to the lower, stable number rather than the average or the most optimistic one. Start with a one-year term unless the workload has a multi-year life you would bet on, put it at shared scope, and pay monthly if upfront cash is a concern, since monthly payment costs the same overall. Then check the utilisation figure in Cost Management every month. If it sits near 100% and the recommendations keep asking for more, top up; if it drops, exchange before the gap becomes a habit.
