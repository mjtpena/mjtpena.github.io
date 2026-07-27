---
title: "Power BI Row-Level Security: Securing Data at the Row Level"
author: Michael John Peña
draft: false
date: 2022-04-22
tags:
  - Power BI
  - Security
  - RLS
  - Data Security
  - Enterprise

---

I wrote "Power BI Row-Level Security: Securing Data at the Row Level" to share practical, production-minded guidance on this topic.

## RLS Concepts

```yaml
components:
  roles: Define who can access what data
  filters: DAX expressions that filter rows
  members: Users assigned to roles

filter_context:
  - Applied at query time
  - Transparent to end user
  - Works with all visuals
```

## Creating RLS Roles

### In Power BI Desktop

```dax
// Simple filter - user sees their own region
[Region] = USERPRINCIPALNAME()

// Lookup-based filter
[RegionId] IN
VALUES(
    FILTER(
        UserRegions,
        UserRegions[UserEmail] = USERPRINCIPALNAME()
    )[RegionId]
)

// Manager hierarchy
[EmployeeId] IN
PATH(
    PATHCONTAINS(
        LOOKUPVALUE(Employees[HierarchyPath], Employees[Email], USERPRINCIPALNAME()),
        [EmployeeId]
    )
)
```

### Dynamic RLS with Security Table

```sql
-- Create security table in your data source
CREATE TABLE UserSecurity (
    UserEmail NVARCHAR(255),
    Region NVARCHAR(100),
    Department NVARCHAR(100),
    AccessLevel INT
);

INSERT INTO UserSecurity VALUES
('alice@company.com', 'North', 'Sales', 1),
('bob@company.com', 'South', 'Sales', 1),
('carol@company.com', 'ALL', 'Sales', 2);  -- Manager sees all
```

```dax
// DAX filter using security table
VAR CurrentUser = USERPRINCIPALNAME()
VAR UserRegion = LOOKUPVALUE(UserSecurity[Region], UserSecurity[UserEmail], CurrentUser)
RETURN
    UserRegion = "ALL" || [Region] = UserRegion
```

## Testing RLS

```
In Power BI Desktop:
1. Modeling tab > View as > Roles
2. Select role to test
3. Optionally enter email to test USERPRINCIPALNAME()
4. Verify filtered data in visuals
```

## RLS with Embedded Analytics

```csharp
// Apply RLS in embed token
var tokenRequest = new GenerateTokenRequestV2
{
    Reports = new List<GenerateTokenRequestV2Report>
    {
        new GenerateTokenRequestV2Report(reportId)
    },
    Datasets = new List<GenerateTokenRequestV2Dataset>
    {
        new GenerateTokenRequestV2Dataset(datasetId)
    },
    Identities = new List<EffectiveIdentity>
    {
        new EffectiveIdentity(
            username: userEmail,           // Must match USERPRINCIPALNAME() in DAX
            datasets: new List<string> { datasetId },
            roles: new List<string> { "RegionalAccess" }  // Role name
        )
    }
};

var token = await _client.EmbedToken.GenerateTokenAsync(tokenRequest);
```

### Custom Data with RLS

```csharp
// Pass custom data for dynamic filtering
var identity = new EffectiveIdentity(
    username: "user@company.com",
    datasets: new List<string> { datasetId },
    roles: new List<string> { "DynamicFilter" },
    customData: "TenantA"  // Accessible via CUSTOMDATA() in DAX
);
```

```dax
// DAX using CUSTOMDATA()
[TenantId] = CUSTOMDATA()
```

## Common Patterns

### Hierarchical Security

```dax
// Manager sees their team's data
VAR CurrentUserPath =
    LOOKUPVALUE(
        Employees[OrgPath],
        Employees[Email],
        USERPRINCIPALNAME()
    )
RETURN
    PATHCONTAINS(CurrentUserPath, [EmployeeId])
    || [Email] = USERPRINCIPALNAME()
```

### Multi-Tenant

```dax
// Tenant isolation
[TenantId] =
    LOOKUPVALUE(
        TenantUsers[TenantId],
        TenantUsers[UserEmail],
        USERPRINCIPALNAME()
    )
```

### Date-Based Access

```dax
// Users can only see data from their start date
[TransactionDate] >= LOOKUPVALUE(
    Users[StartDate],
    Users[Email],
    USERPRINCIPALNAME()
)
```

## Performance Considerations

```yaml
optimization:
  - Use simple filters when possible
  - Avoid complex DAX in RLS
  - Index security lookup columns
  - Test with production data volumes

avoid:
  - CALCULATE in RLS filters
  - Multiple nested LOOKUPVALUEs
  - Large IN lists
```

## Best Practices

```yaml
design:
  - Design security model early
  - Document role assignments
  - Test with all role combinations
  - Plan for role maintenance

implementation:
  - Use security tables for flexibility
  - Keep DAX filters simple
  - Test performance with RLS enabled
  - Monitor query times

governance:
  - Regular access reviews
  - Audit role assignments
  - Document data classification
```

## Conclusion

Row-Level Security is essential for:
- Multi-tenant applications
- Regional data access
- Hierarchical visibility
- Regulatory compliance

Combined with proper testing and monitoring, RLS provides robust data security in Power BI.

## Resources

- [RLS Documentation](https://docs.microsoft.com/en-us/power-bi/admin/service-admin-rls)
- [RLS with Embedded](https://docs.microsoft.com/en-us/power-bi/developer/embedded/embedded-row-level-security)
- [Dynamic RLS Patterns](https://docs.microsoft.com/en-us/power-bi/guidance/rls-guidance)

