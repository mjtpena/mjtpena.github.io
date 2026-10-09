---
title: "Power BI Object-Level Security: Protecting Tables and Columns"
author: Michael John Peña
draft: false
date: 2022-04-23
tags:
  - Power BI
  - Security
  - OLS
  - Data Protection
  - Enterprise
---

## Understanding OLS

```yaml
scope:
  - Table-level: Hide entire tables
  - Column-level: Hide specific columns

use_cases:
  - Hide sensitive columns (SSN, salary)
  - Restrict access to financial tables
  - Protect PII data
  - Different views for different roles
```

## Implementing OLS

### Using Tabular Editor

```csharp
// In Tabular Editor, set object permissions
// Table-level security
Table["Salaries"].ObjectLevelSecurity["Finance"] = MetadataPermission.Read;
Table["Salaries"].ObjectLevelSecurity["General"] = MetadataPermission.None;

// Column-level security
Column["Employees", "SSN"].ObjectLevelSecurity["HR"] = MetadataPermission.Read;
Column["Employees", "SSN"].ObjectLevelSecurity["General"] = MetadataPermission.None;

Column["Employees", "Salary"].ObjectLevelSecurity["Finance"] = MetadataPermission.Read;
Column["Employees", "Salary"].ObjectLevelSecurity["Manager"] = MetadataPermission.Read;
Column["Employees", "Salary"].ObjectLevelSecurity["General"] = MetadataPermission.None;
```

### TMSL Script

```json
{
    "createOrReplace": {
        "object": {
            "database": "SalesDB",
            "role": "GeneralUser"
        },
        "role": {
            "name": "GeneralUser",
            "modelPermission": "read",
            "tablePermissions": [
                {
                    "name": "Employees",
                    "columnPermissions": [
                        {
                            "name": "SSN",
                            "metadataPermission": "none"
                        },
                        {
                            "name": "Salary",
                            "metadataPermission": "none"
                        }
                    ]
                },
                {
                    "name": "ConfidentialFinancials",
                    "metadataPermission": "none"
                }
            ]
        }
    }
}
```

## Combining RLS and OLS

```yaml
strategy:
  rls: Controls which rows users see
  ols: Controls which columns/tables are visible

example:
  hr_role:
    rls: See all employee rows in their department
    ols: Can see SSN, salary columns

  manager_role:
    rls: See employees in their team
    ols: Can see salary, not SSN

  general_role:
    rls: See only their own row
    ols: Cannot see SSN or salary
```

## Testing OLS

```csharp
// Test with XMLA endpoint
var connectionString = "Data Source=powerbi://api.powerbi.com/v1.0/myorg/workspace;" +
                       "Initial Catalog=dataset;" +
                       "User ID=testuser@company.com;" +
                       "Password=***;" +
                       "Effective User Name=testuser@company.com;" +
                       "Roles=GeneralUser";

using var connection = new OleDbConnection(connectionString);
connection.Open();

// Query should fail for hidden columns
var command = new OleDbCommand("SELECT SSN FROM Employees", connection);
// Throws error: Column not found
```

## Best Practices

```yaml
design:
  - Document security requirements
  - Create role matrix
  - Consider report impact
  - Plan for exceptions

implementation:
  - Use Tabular Editor for management
  - Test all role combinations
  - Verify reports work with OLS
  - Handle errors gracefully

maintenance:
  - Version control TMSL scripts
  - Regular security reviews
  - Document column classifications
```

## Conclusion

Object-Level Security provides an additional security layer:
- Protect sensitive columns from unauthorized access
- Hide entire tables from roles
- Complement RLS for comprehensive security
- Meet regulatory requirements

## Resources

- [OLS Documentation](https://docs.microsoft.com/en-us/analysis-services/tabular-models/object-level-security)
- [Tabular Editor](https://tabulareditor.com/)
