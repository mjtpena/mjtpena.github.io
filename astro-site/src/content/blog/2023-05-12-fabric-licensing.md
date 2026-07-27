---
title: "Microsoft Fabric Licensing: Understanding Your Options"
author: Michael John Peña
draft: false
date: 2023-05-12
tags:
  - Microsoft Fabric
  - Licensing
  - Power BI
  - Azure
  - Enterprise

---

I wrote "Microsoft Fabric Licensing: Understanding Your Options" to share practical, production-minded guidance on this topic.

## Fabric Licensing Model

Fabric uses a combination of:
1. **Capacity licenses**: Compute resources (F SKUs or Power BI Premium)
2. **User licenses**: Per-user access to Fabric features

```
┌─────────────────────────────────────────────────────┐
│              Fabric Licensing Model                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │           Capacity License (F SKU)              ││
│  │      Powers all workloads in workspaces         ││
│  └─────────────────────────────────────────────────┘│
│                        +                             │
│  ┌─────────────────────────────────────────────────┐│
│  │              User Licenses                       ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      ││
│  │  │ Free     │  │ Pro      │  │ Premium  │      ││
│  │  │ (View)   │  │ (Create) │  │Per User  │      ││
│  │  └──────────┘  └──────────┘  └──────────┘      ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## Capacity Licenses

### Fabric Capacities (F SKUs)

```python
# Fabric capacity SKUs and pricing (approximate monthly USD)
fabric_skus = {
    "F2":   {"cu": 2,    "price": 262.80,   "use_case": "Trial/Testing"},
    "F4":   {"cu": 4,    "price": 525.60,   "use_case": "Small workloads"},
    "F8":   {"cu": 8,    "price": 1051.20,  "use_case": "Small teams"},
    "F16":  {"cu": 16,   "price": 2102.40,  "use_case": "Department"},
    "F32":  {"cu": 32,   "price": 4204.80,  "use_case": "Department"},
    "F64":  {"cu": 64,   "price": 4995.84,  "use_case": "Enterprise"},
    "F128": {"cu": 128,  "price": 9991.68,  "use_case": "Enterprise"},
    "F256": {"cu": 256,  "price": 19983.36, "use_case": "Large Enterprise"},
    "F512": {"cu": 512,  "price": 39966.72, "use_case": "Large Enterprise"},
    "F1024":{"cu": 1024, "price": 79933.44, "use_case": "Very Large"},
    "F2048":{"cu": 2048, "price": 159866.88,"use_case": "Massive Scale"}
}
```

### Power BI Premium Capacities

Existing Power BI Premium (P SKUs) also support Fabric workloads:

```python
# Power BI Premium mapping to Fabric
pbi_premium_mapping = {
    "P1": {"fabric_equivalent": "F64",  "cu": 64},
    "P2": {"fabric_equivalent": "F128", "cu": 128},
    "P3": {"fabric_equivalent": "F256", "cu": 256},
    "P4": {"fabric_equivalent": "F512", "cu": 512},
    "P5": {"fabric_equivalent": "F1024","cu": 1024}
}

# If you have P1, you can enable Fabric workloads
# No additional capacity purchase needed
```

## User Licenses

### Power BI Free

```python
# Free user capabilities
free_license = {
    "view_reports": True,       # View in workspaces with Premium/Fabric capacity
    "use_apps": True,           # Consume published apps
    "create_content": False,    # Cannot create in Premium workspaces
    "share_content": False,     # Cannot share
    "fabric_items": False       # Cannot create Fabric items
}
```

### Power BI Pro

```python
# Pro user capabilities ($10/user/month)
pro_license = {
    "view_reports": True,
    "create_reports": True,     # Create in Pro and Premium workspaces
    "share_content": True,      # Share with other Pro users
    "fabric_items": True,       # Create Fabric items in Fabric workspaces
    "publish_apps": True,
    "collaborate": True
}

# Required for:
# - Creating content in Fabric workspaces
# - Sharing content with others
# - Data engineering, data science tasks
```

### Power BI Premium Per User (PPU)

```python
# PPU capabilities ($20/user/month)
ppu_license = {
    "all_pro_features": True,
    "premium_features": True,   # AI, paginated reports, deployment pipelines
    "personal_capacity": True,  # Each user gets Premium-level features
    "large_models": True,       # Larger semantic model limits
    "fabric_items": True
}

# PPU is good for:
# - Small teams needing Premium features
# - Individual analysts with complex needs
# - Testing Premium features before org-wide deployment
```

## Licensing Scenarios

### Scenario 1: Small Team Starting with Fabric

```python
# 10 data engineers and analysts
# Light workloads, learning Fabric

recommendation = {
    "capacity": "F8",           # $1,051/month
    "user_licenses": "10x Pro", # $100/month
    "total_monthly": 1151,
    "notes": "Start small, scale up as needed"
}
```

### Scenario 2: Enterprise Data Platform

```python
# 50 content creators, 500 report consumers
# Heavy data engineering workloads

recommendation = {
    "capacity": "F128",               # $9,992/month
    "creator_licenses": "50x Pro",    # $500/month
    "consumer_licenses": "500x Free", # $0 (Premium capacity)
    "total_monthly": 10492,
    "notes": "Free users can view on Premium capacity"
}
```

### Scenario 3: Migration from Synapse + Power BI

```python
# Existing:
# - Azure Synapse dedicated pool (DW1000c): ~$12,000/month
# - Power BI Premium P1: ~$5,000/month
# - Azure Data Factory: ~$1,000/month
# Total: ~$18,000/month

# Fabric alternative:
fabric_recommendation = {
    "capacity": "F256",  # $19,983/month (includes all workloads)
    "comparison": {
        "existing_total": 18000,
        "fabric_total": 19983,
        "difference": 1983,
        "benefits": [
            "Unified platform",
            "Simplified management",
            "OneLake (no separate storage costs)",
            "No data movement between services",
            "Single security model"
        ]
    }
}
```

## License Assignment

### Via Microsoft 365 Admin Center

```powershell
# PowerShell: Assign Power BI Pro licenses
Connect-MgGraph -Scopes "User.ReadWrite.All"

# Get license SKU
$sku = Get-MgSubscribedSku | Where-Object SkuPartNumber -eq "POWER_BI_PRO"

# Assign to user
Set-MgUserLicense -UserId "user@contoso.com" `
    -AddLicenses @{SkuId = $sku.SkuId} `
    -RemoveLicenses @()
```

### Via Azure AD Group-Based Licensing

```python
# Assign licenses via group membership
# 1. Create Azure AD group "Fabric-Pro-Users"
# 2. Assign Power BI Pro license to group
# 3. Add users to group - licenses assigned automatically

group_licensing = {
    "group_name": "Fabric-Pro-Users",
    "license_sku": "POWER_BI_PRO",
    "auto_assignment": True,
    "benefits": [
        "Automatic license management",
        "Easy onboarding/offboarding",
        "Role-based assignment"
    ]
}
```

## Trial Options

```python
# Fabric trial options
trial_options = {
    "individual_trial": {
        "duration": "60 days",
        "capacity": "F64 equivalent",
        "requirements": "Power BI Pro or PPU license",
        "activation": "Fabric portal > Account > Start trial"
    },
    "tenant_trial": {
        "duration": "60 days",
        "capacity": "F64",
        "requirements": "Global admin or Fabric admin",
        "activation": "Admin portal > Trials"
    }
}
```

## Monitoring License Usage

```python
# Check user license assignments
# Via Microsoft 365 Admin Center or PowerShell

# Get all users with Power BI licenses
from msgraph import GraphServiceClient

async def get_pbi_licensed_users(client: GraphServiceClient):
    users = await client.users.get()
    pbi_users = []

    for user in users.value:
        licenses = await client.users.by_user_id(user.id).license_details.get()
        for license in licenses.value:
            if "POWER_BI" in license.sku_part_number:
                pbi_users.append({
                    "user": user.display_name,
                    "email": user.mail,
                    "license": license.sku_part_number
                })

    return pbi_users
```

Understanding Fabric licensing helps you plan costs and ensure users have appropriate access. Tomorrow, I will cover Fabric Workspace configuration and management.

## Resources

- [Fabric Licenses](https://learn.microsoft.com/en-us/fabric/enterprise/licenses)
- [Power BI Licensing](https://learn.microsoft.com/en-us/power-bi/fundamentals/service-features-license-type)
- [Fabric Pricing](https://azure.microsoft.com/en-us/pricing/details/microsoft-fabric/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
