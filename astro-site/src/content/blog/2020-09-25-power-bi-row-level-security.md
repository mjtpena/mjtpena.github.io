---
title: "Power BI Row-Level Security: Data Access Control"
description: "In Desktop: Modeling → View as Roles → Select role → Enter email to test RLS enables true multi-tenancy in Power BI, where one dataset serves many users…"
author: Michael John Peña
draft: false
date: 2020-09-25
tags:
  - Power BI
  - Security
  - DAX
  - Multi-Tenancy
---

## Defining Roles

In Power BI Desktop, Modeling tab → Manage Roles:

```dax
// Region Manager role
// Filter: Sales table
[Region] = USERPRINCIPALNAME()

// Or with a security table lookup
[Region] IN
VALUES(FILTER(
    'UserRegionMapping',
    'UserRegionMapping'[UserEmail] = USERPRINCIPALNAME()
)[Region])
```

## Dynamic RLS Pattern

Security table approach for flexibility:

```sql
-- UserPermissions table
CREATE TABLE UserPermissions (
    UserEmail VARCHAR(256),
    Region VARCHAR(50),
    Department VARCHAR(50)
);

INSERT INTO UserPermissions VALUES
('alice@company.com', 'North', 'Sales'),
('bob@company.com', 'South', 'Sales'),
('charlie@company.com', 'ALL', 'Executive');
```

```dax
// DAX Filter on Sales table
VAR CurrentUser = USERPRINCIPALNAME()
VAR UserRegions =
    CALCULATETABLE(
        VALUES('UserPermissions'[Region]),
        'UserPermissions'[UserEmail] = CurrentUser
    )
RETURN
    IF(
        "ALL" IN UserRegions,
        TRUE(),
        [Region] IN UserRegions
    )
```

## Testing Roles

In Desktop: Modeling → View as Roles → Select role → Enter email to test

## Publishing and Assigning

1. Publish to Power BI Service
2. Dataset Settings → Security
3. Assign users/groups to roles

```powershell
# Using Power BI REST API
$body = @{
    identities = @(
        @{
            username = "alice@company.com"
            roles = @("Regional Manager")
        }
    )
}

Invoke-PowerBIRestMethod -Url "datasets/$datasetId/users" -Method POST -Body ($body | ConvertTo-Json)
```

## Common Pitfalls

1. **USERPRINCIPALNAME() returns blank** in Desktop - use test mode
2. **Service accounts** - RLS applies to interactive users, not service principals by default
3. **Performance** - Complex RLS filters can slow queries

RLS enables true multi-tenancy in Power BI, where one dataset serves many users with appropriate data isolation.
