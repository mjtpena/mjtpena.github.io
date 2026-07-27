---
title: "Power Apps Model-Driven Apps: Data-First Design"
author: Michael John Peña
draft: false
date: 2020-10-30
tags:
  - Power Apps
  - Power Platform
  - Low-Code
  - Dataverse
---

A finance team I'm working with this month wanted "a Power App" for vendor onboarding. They drew screens. I asked about the data first—who owns vendors, what relationships exist, what permissions matter—and the conversation turned into a Dataverse model. That's the moment a canvas app stops making sense and a model-driven app starts. You define tables and relationships, and the UI mostly generates itself.

## When to Use Model-Driven

| Model-Driven | Canvas |
|--------------|--------|
| Complex data relationships | Simple data needs |
| Business processes | Custom UI designs |
| Security requirements | Pixel-perfect control |
| Dataverse-centric | Any data source |

## Creating a Model-Driven App

1. **Design data model** in Dataverse
2. **Create app** in Power Apps maker
3. **Add tables** to site map
4. **Configure forms and views**
5. **Publish**

## Data Model Example

```
Customer (Table)
├── Name (Text)
├── Email (Text)
├── Company (Lookup → Account)
└── Status (Choice: Active/Inactive)

Order (Table)
├── Order Number (Autonumber)
├── Customer (Lookup → Customer)
├── Order Date (Date)
├── Total (Currency)
└── Status (Choice: Draft/Submitted/Completed)

Order Line (Table)
├── Order (Lookup → Order)
├── Product (Lookup → Product)
├── Quantity (Number)
└── Line Total (Currency, Calculated)
```

## Site Map Configuration

```xml
<SiteMap>
  <Area Id="Sales" Title="Sales">
    <Group Id="Customers" Title="Customers">
      <SubArea Id="Customers" Entity="customer" />
      <SubArea Id="Accounts" Entity="account" />
    </Group>
    <Group Id="Orders" Title="Orders">
      <SubArea Id="Orders" Entity="order" />
      <SubArea Id="Products" Entity="product" />
    </Group>
  </Area>
  <Area Id="Settings" Title="Settings">
    <Group Id="Admin" Title="Administration">
      <SubArea Id="Users" Entity="systemuser" />
    </Group>
  </Area>
</SiteMap>
```

## Form Customization

Forms control record create/edit experience:

- **Main form**: Full record editing
- **Quick create**: Fast inline creation
- **Quick view**: Embedded related data
- **Card form**: Compact display

## Business Rules

No-code field logic:

```
If Status = "Submitted"
Then
  - Lock "Customer" field
  - Lock "Order Date" field
  - Show notification "Order is submitted"
```

## Business Process Flows

Guide users through stages:

```
Lead Qualification Process
┌─────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐
│ Qualify │ → │ Develop  │ → │ Propose │ → │  Close  │
│         │   │          │   │         │   │         │
│ □ Budget│   │ □ Demo   │   │ □ Quote │   │ □ Sign  │
│ □ Auth  │   │ □ Trial  │   │ □ Nego  │   │ □ Pay   │
└─────────┘   └──────────┘   └─────────┘   └─────────┘
```

## Views

Display record lists:

```
Active Orders View
├── Filter: Status != Completed
├── Columns: Order#, Customer, Date, Total, Status
├── Sort: Order Date (Descending)
└── Default view for Orders table
```

## Dashboards

```
Sales Dashboard
┌────────────────┬────────────────┐
│ Orders by      │ Revenue by     │
│ Status (Chart) │ Month (Chart)  │
├────────────────┼────────────────┤
│ My Active      │ Recent         │
│ Orders (List)  │ Customers      │
└────────────────┴────────────────┘
```

## Security Roles

Control access at row and field level:

```
Sales Role
├── Customer: Create, Read, Write (User scope)
├── Order: Create, Read, Write (User scope)
├── Product: Read (Organization scope)
└── Settings: None
```

Model-driven apps: enterprise apps from data models.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
