---
title: "Building Model-Driven Apps with Power Apps"
description: "When I help clients pick between canvas and model-driven, my rule of thumb is simple: if the app is a form over data with relationships, security roles, and…"
author: Michael John Peña
draft: false
date: 2020-08-14
tags:
  - Power Platform
  - Power Apps
  - Low Code
  - Business Applications
---

## Understanding Model-Driven vs Canvas Apps

| Aspect | Model-Driven | Canvas |
|--------|--------------|--------|
| Design approach | Data-first | UI-first |
| Responsiveness | Automatic | Manual |
| Data source | Dataverse only | 200+ connectors |
| Best for | Complex business apps | Simple, focused apps |

## Setting Up Dataverse

Model-driven apps require Dataverse (formerly Common Data Service):

1. Create a new solution in Power Apps
2. Add custom tables (entities)
3. Define relationships
4. Create forms and views

## Creating a Custom Table

In the Power Apps maker portal:

1. Go to Tables > New table
2. Configure the table:

```
Display name: Project
Plural name: Projects
Primary column: Project Name
```

Add columns:
- **Start Date** (Date Only)
- **End Date** (Date Only)
- **Status** (Choice: Active, On Hold, Completed)
- **Budget** (Currency)
- **Description** (Multiple lines of text)

## Defining Relationships

Create a related table for Tasks:

```
Display name: Task
Plural name: Tasks

Columns:
- Task Name (Primary)
- Due Date (Date Only)
- Priority (Choice: Low, Medium, High)
- Status (Choice: Not Started, In Progress, Completed)
- Project (Lookup to Projects table)
```

## Creating Forms

Design forms for data entry:

### Main Form Structure

```
Header:
  - Status
  - Owner

Tab 1: General
  Section 1: Project Details
    - Project Name (required)
    - Start Date
    - End Date
    - Status
    - Budget

  Section 2: Description
    - Description (full width)

Tab 2: Tasks
  - Subgrid: Related Tasks

Tab 3: Timeline
  - Timeline control (activities)
```

## Creating Views

Set up views for different perspectives:

### Active Projects View

```
Columns:
  - Project Name
  - Status
  - Start Date
  - End Date
  - Budget
  - Owner

Filter: Status = Active
Sort: Start Date (descending)
```

### My Projects View

```
Columns:
  - Project Name
  - Status
  - End Date

Filter: Owner = Current User
Sort: End Date (ascending)
```

## Business Rules

Add logic without code:

### Auto-Set Status on Completion

```
Condition: End Date < Today AND Status != Completed
Action: Set Status = Completed, Show message "Project has been auto-completed"
```

### Require End Date for Active Projects

```
Condition: Status = Active
Action: Set End Date as required
```

## Building the App

1. Create a new model-driven app
2. Add the site map:

```
Area: Projects
  Group: Management
    - Projects (table)
    - Tasks (table)

  Group: Reports
    - Dashboard
```

3. Add forms and views to each table

## Customizing with JavaScript

For advanced scenarios, add JavaScript:

```javascript
// OnLoad of Project form
function onProjectFormLoad(executionContext) {
    var formContext = executionContext.getFormContext();

    // Show/hide sections based on status
    var status = formContext.getAttribute("statuscode").getValue();

    if (status === 100000002) { // Completed
        formContext.ui.tabs.get("tab_tasks").setVisible(false);
        formContext.getControl("budget").setDisabled(true);
    }
}

// OnChange of End Date
function onEndDateChange(executionContext) {
    var formContext = executionContext.getFormContext();

    var startDate = formContext.getAttribute("new_startdate").getValue();
    var endDate = formContext.getAttribute("new_enddate").getValue();

    if (startDate && endDate && endDate < startDate) {
        formContext.getControl("new_enddate").setNotification(
            "End date cannot be before start date",
            "dateValidation"
        );
    } else {
        formContext.getControl("new_enddate").clearNotification("dateValidation");
    }
}
```

## Adding Dashboards

Create interactive dashboards:

### Project Overview Dashboard

Components:
- **Chart**: Projects by Status (pie chart)
- **Chart**: Budget by Project (bar chart)
- **View**: My Active Projects
- **View**: Overdue Tasks

## Security Roles

Configure role-based access:

### Project Manager Role

```
Projects table:
  - Create: Organization
  - Read: Organization
  - Write: Business Unit
  - Delete: User

Tasks table:
  - Create: Organization
  - Read: Organization
  - Write: Organization
  - Delete: Business Unit
```

## Publishing and Sharing

1. Validate the solution
2. Publish all customizations
3. Share the app with security roles
4. Users access via apps.powerapps.com

## Mobile Experience

Model-driven apps automatically work on mobile:
- Dynamics 365 mobile app
- Power Apps mobile app
- Responsive forms adapt to screen size

When I help clients pick between canvas and model-driven, my rule of thumb is simple: if the app is a *form over data* with relationships, security roles, and audit requirements, go model-driven. If it's a customer-facing kiosk or a polished mobile experience for a single workflow, go canvas. Mixing the two in one solution is fine and often correct — model-driven for the back-office, canvas embedded for the polished bits users see most.
