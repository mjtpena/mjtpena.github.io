---
title: "Microsoft Dataverse: The Power Platform Database"
author: Michael John Peña
draft: false
date: 2020-10-06
tags:
  - Power Platform
  - Dataverse
  - Low-Code
  - Database

---

I wrote "Microsoft Dataverse: The Power Platform Database" to share practical, production-minded guidance on this topic.

## Key Features

- **Relational data** with relationships and constraints
- **Standard tables** for common entities (Account, Contact, etc.)
- **Business logic** (workflows, plugins)
- **Security** (row-level, field-level)
- **Integration** via OData API

## Creating a Custom Table

In Power Apps:
1. Tables → New table
2. Define columns
3. Set relationships
4. Configure security

## Accessing via Web API

```javascript
// Get records
fetch("https://org.api.crm.dynamics.com/api/data/v9.2/accounts?$select=name,revenue&$top=10", {
    method: "GET",
    headers: {
        "Authorization": "Bearer " + accessToken,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0"
    }
})

// Create record
fetch("https://org.api.crm.dynamics.com/api/data/v9.2/accounts", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify({
        "name": "New Account",
        "revenue": 1000000
    })
})
```

## Power Automate Integration

```
When a record is created (Trigger: Dataverse)
  ↓
Get related records
  ↓
Send email notification
  ↓
Update status field
```

## Power BI DirectQuery

```dax
// Direct connection to Dataverse
// Real-time data in reports
TotalRevenue = SUM(Accounts[Revenue])
```

## When to Use Dataverse

Use Dataverse when:
- Building Power Apps
- Need business logic in database
- Require row-level security
- Integrating Dynamics 365

Consider alternatives for:
- Big data workloads (use Azure)
- High-volume transactional (use SQL)
- Document storage (use SharePoint)

Dataverse is the glue that connects Power Platform components.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
