---
title: "Row-Level Security in Fabric: Data Access at the Row Level"
description: "RLS provides essential data security for multi-tenant and sensitive data scenarios. Tomorrow, I will cover Azure OpenAI function calling patterns."
author: Michael John Peña
draft: false
date: 2023-06-17
tags:
  - Microsoft Fabric
  - RLS
  - Security
  - DAX
  - Power BI
---

## RLS Fundamentals

RLS filters data so users only see rows they are authorized to access:

```python
rls_concepts = {
    "static_rls": {
        "description": "Fixed filter rules per role",
        "example": "Sales role sees only sales data",
        "use_case": "Simple department-based access"
    },
    "dynamic_rls": {
        "description": "Filter based on user identity",
        "example": "User sees only their region's data",
        "use_case": "User-specific data access"
    },
    "hybrid_rls": {
        "description": "Combination of static and dynamic",
        "example": "Managers see their team's data",
        "use_case": "Hierarchical access patterns"
    }
}
```

## Implementing Static RLS

```dax
// Static RLS: Define fixed filters for each role

// Role: US_Sales
// Table: Sales
// DAX Filter:
[Country] = "United States"

// Role: EMEA_Sales
// Table: Sales
// DAX Filter:
[Country] IN {"United Kingdom", "Germany", "France", "Netherlands", "Spain"}

// Role: APAC_Sales
// Table: Sales
// DAX Filter:
[Country] IN {"Australia", "Japan", "Singapore", "India", "China"}
```

## Implementing Dynamic RLS

```dax
// Dynamic RLS: Filter based on logged-in user

// Step 1: Create security mapping table
// Table: UserSecurity
// | UserEmail              | Region    | Department |
// | alice@company.com      | US-West   | Sales      |
// | bob@company.com        | US-East   | Sales      |
// | carol@company.com      | EMEA      | Marketing  |

// Step 2: Define RLS filter on fact table
// Role: SalesTeam
// Table: Sales
// DAX Filter:
[Region] = LOOKUPVALUE(
    UserSecurity[Region],
    UserSecurity[UserEmail],
    USERPRINCIPALNAME()
)

// Alternative using CALCULATE
VAR CurrentUserRegion =
    CALCULATE(
        VALUES(UserSecurity[Region]),
        UserSecurity[UserEmail] = USERPRINCIPALNAME()
    )
RETURN
    [Region] IN CurrentUserRegion
```

## Multi-Table RLS

```dax
// RLS that filters multiple tables

// Step 1: Create comprehensive security table
// Table: Security
// | UserEmail         | CustomerAccess | ProductAccess | RegionAccess |
// | user@company.com  | C001,C002      | P001,P002     | US-West      |

// Step 2: Apply filter to Customers dimension
// Role: FilteredAccess
// Table: Customers
// DAX Filter:
VAR UserCustomers =
    SUBSTITUTE(
        LOOKUPVALUE(
            Security[CustomerAccess],
            Security[UserEmail],
            USERPRINCIPALNAME()
        ),
        ",",
        "|"
    )
RETURN
    CONTAINSSTRING(UserCustomers, [CustomerID])

// Step 3: Apply filter to Products dimension
// Table: Products
// DAX Filter:
VAR UserProducts =
    LOOKUPVALUE(
        Security[ProductAccess],
        Security[UserEmail],
        USERPRINCIPALNAME()
    )
RETURN
    PATHCONTAINS(UserProducts, [ProductID])
```

## Hierarchical RLS (Manager Access)

```dax
// Managers see their direct and indirect reports' data

// Step 1: Create org hierarchy table
// Table: OrgHierarchy
// | EmployeeID | EmployeeEmail     | ManagerID | ManagerPath      |
// | E001       | ceo@company.com   | NULL      | E001             |
// | E002       | vp@company.com    | E001      | E001|E002        |
// | E003       | mgr@company.com   | E002      | E001|E002|E003   |
// | E004       | rep@company.com   | E003      | E001|E002|E003|E004 |

// Step 2: Define RLS filter
// Role: HierarchicalAccess
// Table: Sales
// DAX Filter:
VAR CurrentUserID =
    LOOKUPVALUE(
        OrgHierarchy[EmployeeID],
        OrgHierarchy[EmployeeEmail],
        USERPRINCIPALNAME()
    )
VAR UserAndReports =
    FILTER(
        OrgHierarchy,
        PATHCONTAINS(OrgHierarchy[ManagerPath], CurrentUserID)
    )
RETURN
    [SalesRepID] IN SELECTCOLUMNS(UserAndReports, "ID", OrgHierarchy[EmployeeID])
```

## Testing RLS

```python
# Test RLS using Power BI REST API
import requests

def test_rls(
    dataset_id: str,
    role_name: str,
    user_email: str,
    dax_query: str,
    headers: dict
):
    """Execute DAX query impersonating specific user to test RLS"""

    url = f"https://api.powerbi.com/v1.0/myorg/datasets/{dataset_id}/executeQueries"

    payload = {
        "queries": [
            {
                "query": dax_query
            }
        ],
        "impersonatedUserName": user_email
    }

    response = requests.post(url, headers=headers, json=payload)
    return response.json()

# Test what data a user can see
result = test_rls(
    dataset_id="dataset-guid",
    role_name="SalesTeam",
    user_email="alice@company.com",
    dax_query="EVALUATE SUMMARIZE(Sales, Sales[Region], \"Total\", SUM(Sales[Amount]))",
    headers=headers
)

print("Data visible to alice@company.com:")
for row in result.get("results", [{}])[0].get("tables", [{}])[0].get("rows", []):
    print(f"  {row}")
```

### Test in Power BI Desktop

```
1. Open semantic model in Power BI Desktop
2. Modeling > View as > Select roles
3. Choose role and optionally specify user
4. Browse reports to verify filtering
```

## RLS Best Practices

```python
rls_best_practices = {
    "design": [
        "Keep filter expressions simple for performance",
        "Use dimension tables for filtering, not fact tables",
        "Avoid complex DAX in RLS filters",
        "Test with representative data volumes"
    ],
    "security_table": [
        "Maintain in source system, not manually",
        "Sync with HR/identity systems",
        "Include audit columns (created, modified)",
        "Handle users with no mapping (fail secure)"
    ],
    "testing": [
        "Test each role with multiple users",
        "Verify edge cases (no access, all access)",
        "Test with actual production users",
        "Document expected behavior per role"
    ],
    "performance": [
        "Minimize the number of RLS roles",
        "Use indexed columns in filter expressions",
        "Avoid bi-directional relationships",
        "Monitor query performance with RLS"
    ]
}
```

## Common Patterns

```dax
// Pattern 1: User sees own data only
[OwnerEmail] = USERPRINCIPALNAME()

// Pattern 2: User sees team data
[TeamID] IN
    CALCULATETABLE(
        VALUES(UserTeam[TeamID]),
        UserTeam[UserEmail] = USERPRINCIPALNAME()
    )

// Pattern 3: Admin bypass (sees all)
IF(
    CONTAINS(
        Admins,
        Admins[UserEmail],
        USERPRINCIPALNAME()
    ),
    TRUE(),
    [Region] = LOOKUPVALUE(UserRegion[Region], UserRegion[UserEmail], USERPRINCIPALNAME())
)

// Pattern 4: Date-based access
[TransactionDate] >= LOOKUPVALUE(
    UserAccess[StartDate],
    UserAccess[UserEmail],
    USERPRINCIPALNAME()
)
```

RLS provides essential data security for multi-tenant and sensitive data scenarios. Tomorrow, I will cover Azure OpenAI function calling patterns.

## Resources

- [RLS in Power BI](https://learn.microsoft.com/en-us/power-bi/enterprise/service-admin-rls)
- [Dynamic RLS](https://learn.microsoft.com/en-us/power-bi/guidance/rls-guidance)
- [RLS Best Practices](https://learn.microsoft.com/en-us/power-bi/guidance/rls-guidance)
