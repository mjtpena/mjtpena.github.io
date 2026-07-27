---
title: Power Apps Model-Driven Apps - Building Enterprise Solutions
author: Michael John Peña
draft: false
date: 2021-04-07
url: /blog/power-apps-model-driven-apps-enterprise-solutions/
tags:
  - Power Platform
  - Power Apps
  - Model-Driven Apps
  - Dataverse
  - Enterprise
---

Model-driven apps are the Power Apps surface that professional developers habitually underestimate. "No-code" suggests toylike; what you get with a well-designed Dataverse schema is a full-featured CRM-style application with editable grids, relationship views, business process flows, custom ribbon commands, and PCF controls—all generated from the data model. The investment is in getting the Dataverse schema right: relationships, security roles, business rules, and calculated fields. Once that foundation is solid, the model-driven app's UI adapts automatically. I use canvas for consumer-grade experiences and field worker apps; I use model-driven for internal operations tools where richness and maintainability matter more than brand aesthetics.

## When to Choose Model-Driven Apps

Model-driven apps excel when you need:
- **Complex data relationships** - Multiple related tables
- **Consistent UX** - Standard navigation and forms
- **Enterprise features** - Business process flows, security roles
- **Rapid development** - Less UI design, more data modeling
- **Desktop-first** - Primary use on larger screens

## Understanding the Architecture

Model-driven apps consist of:

1. **Site Map** - Navigation structure
2. **Tables** - Data stored in Dataverse
3. **Forms** - Data entry and viewing
4. **Views** - Data lists and grids
5. **Business Process Flows** - Guided processes
6. **Dashboards** - Data visualizations

## Creating Your App

### Step 1: Define the Site Map

```xml
<?xml version="1.0" encoding="utf-8"?>
<SiteMap>
  <Area Id="ProjectManagement" Title="Project Management">
    <Group Id="Projects" Title="Projects">
      <SubArea Id="nav_projects"
               Entity="cr_project"
               Title="Projects"
               Icon="/WebResources/icon_project.svg" />
      <SubArea Id="nav_tasks"
               Entity="cr_task"
               Title="Tasks" />
    </Group>
    <Group Id="Resources" Title="Resources">
      <SubArea Id="nav_team"
               Entity="cr_teammember"
               Title="Team Members" />
      <SubArea Id="nav_resources"
               Entity="cr_resource"
               Title="Resources" />
    </Group>
    <Group Id="Reports" Title="Reports">
      <SubArea Id="nav_dashboard"
               DefaultDashboard="ProjectDashboard"
               Title="Dashboard" />
    </Group>
  </Area>
</SiteMap>
```

### Step 2: Design Main Form

```yaml
Form: Project Main Form
Type: Main
Tabs:
  - Name: General
    Sections:
      - Name: Project Information
        Columns: 2
        Fields:
          - cr_name (Required)
          - cr_status
          - cr_startdate
          - cr_enddate
          - cr_budget
          - cr_customerid (Lookup)

      - Name: Description
        Columns: 1
        Fields:
          - cr_description (Full Width, 4 rows)

  - Name: Tasks
    Sections:
      - Name: Related Tasks
        SubGrid:
          Entity: cr_task
          View: Active Tasks
          AllowQuickCreate: true

  - Name: Team
    Sections:
      - Name: Team Members
        SubGrid:
          Entity: cr_teammember
          View: Project Team
          AllowAddExisting: true

  - Name: Documents
    Sections:
      - Name: Related Documents
        Control: SharePoint Document Grid
```

### Step 3: Configure Views

```yaml
View: Active Projects
Columns:
  - cr_name (Primary, Link)
  - cr_status (Width: 100)
  - cr_customerid (Width: 150)
  - cr_startdate (Width: 100)
  - cr_enddate (Width: 100)
  - cr_budget (Width: 100)
  - ownerid (Width: 150)

Filter:
  - cr_statecode equals 0 (Active)
  - cr_status not equals Completed

Sort:
  - cr_enddate Ascending

View: My Active Projects
Inherits: Active Projects
Additional Filter:
  - ownerid equals Current User
```

## Business Process Flows

Create guided experiences for complex processes:

```yaml
Business Process Flow: Project Lifecycle
Entity: cr_project
Stages:
  - Name: Initiation
    Steps:
      - cr_name (Required)
      - cr_customerid (Required)
      - cr_description
    Exit Condition: cr_status = Initiated

  - Name: Planning
    Steps:
      - cr_startdate (Required)
      - cr_enddate (Required)
      - cr_budget (Required)
    Exit Condition: Budget Approved = Yes

  - Name: Execution
    Steps:
      - cr_progress (Required)
      - cr_actualhours
    Exit Condition: Progress >= 100%

  - Name: Closure
    Steps:
      - cr_lessonslearned
      - cr_customersignoff (Required)
    Exit Condition: Customer Signoff = Yes
```

## Business Rules in Forms

Create no-code form logic:

```yaml
Business Rule: Budget Validation
Scope: Form
Conditions:
  IF cr_status = "In Progress"
  AND cr_budget contains data
Actions:
  - Set cr_budget Required Level: Required
  - Show Error on cr_budget if cr_budget < 1000:
    "Budget must be at least $1,000 for active projects"

Business Rule: Date Validation
Scope: Form
Conditions:
  IF cr_enddate contains data
  AND cr_startdate contains data
Actions:
  - Show Error on cr_enddate if cr_enddate <= cr_startdate:
    "End date must be after start date"
```

## JavaScript Customizations

For complex scenarios, add JavaScript:

```javascript
// Project form script
var ProjectForm = (function () {
    "use strict";

    function onLoad(executionContext) {
        var formContext = executionContext.getFormContext();

        // Register event handlers
        formContext.getAttribute("cr_status").addOnChange(onStatusChange);
        formContext.getAttribute("cr_budget").addOnChange(calculateBudgetVariance);

        // Initial setup
        setFieldVisibility(formContext);
        loadRelatedData(formContext);
    }

    function onStatusChange(executionContext) {
        var formContext = executionContext.getFormContext();
        var status = formContext.getAttribute("cr_status").getValue();

        if (status === 100000003) { // Completed
            // Lock budget field
            formContext.getControl("cr_budget").setDisabled(true);

            // Show completion section
            formContext.ui.tabs.get("tab_completion").setVisible(true);

            // Require lessons learned
            formContext.getAttribute("cr_lessonslearned")
                .setRequiredLevel("required");
        }
    }

    function calculateBudgetVariance(executionContext) {
        var formContext = executionContext.getFormContext();

        var budget = formContext.getAttribute("cr_budget").getValue() || 0;
        var actualCost = formContext.getAttribute("cr_actualcost").getValue() || 0;

        var variance = budget - actualCost;
        var variancePercent = budget > 0 ? (variance / budget) * 100 : 0;

        formContext.getAttribute("cr_budgetvariance").setValue(variance);
        formContext.getAttribute("cr_variancepercent").setValue(variancePercent);

        // Visual indicator
        var varianceControl = formContext.getControl("cr_budgetvariance");
        if (variance < 0) {
            varianceControl.setNotification("Project is over budget!", "variance_warning");
        } else {
            varianceControl.clearNotification("variance_warning");
        }
    }

    async function loadRelatedData(formContext) {
        var projectId = formContext.data.entity.getId().replace(/[{}]/g, "");

        if (!projectId) return;

        try {
            // Get task summary
            var tasks = await Xrm.WebApi.retrieveMultipleRecords(
                "cr_task",
                `?$filter=_cr_projectid_value eq ${projectId}&$select=cr_estimatedhours,cr_actualhours,cr_status`
            );

            var totalEstimated = 0;
            var totalActual = 0;
            var completedTasks = 0;

            tasks.entities.forEach(function (task) {
                totalEstimated += task.cr_estimatedhours || 0;
                totalActual += task.cr_actualhours || 0;
                if (task.cr_status === 100000003) completedTasks++;
            });

            // Update summary fields
            formContext.getAttribute("cr_totalestimatedhours").setValue(totalEstimated);
            formContext.getAttribute("cr_totalactualhours").setValue(totalActual);
            formContext.getAttribute("cr_taskcompletionrate")
                .setValue(tasks.entities.length > 0
                    ? (completedTasks / tasks.entities.length) * 100
                    : 0);

        } catch (error) {
            console.error("Error loading related data:", error);
        }
    }

    function onSave(executionContext) {
        var formContext = executionContext.getFormContext();
        var saveEvent = executionContext.getEventArgs();

        // Custom validation
        var endDate = formContext.getAttribute("cr_enddate").getValue();
        var startDate = formContext.getAttribute("cr_startdate").getValue();

        if (endDate && startDate && endDate < startDate) {
            saveEvent.preventDefault();
            formContext.ui.setFormNotification(
                "End date cannot be before start date",
                "ERROR",
                "date_validation"
            );
            return;
        }

        formContext.ui.clearFormNotification("date_validation");
    }

    return {
        onLoad: onLoad,
        onSave: onSave,
        onStatusChange: onStatusChange
    };
})();
```

Register the script:

```yaml
Form Events:
  OnLoad: ProjectForm.onLoad
  OnSave: ProjectForm.onSave

Libraries:
  - cr_projectform.js
```

## Custom Commands (Command Bar)

Add custom buttons using Ribbon Workbench or Power Fx:

```javascript
// Custom command action
function approveProject(selectedItems) {
    var projectId = selectedItems[0].Id;

    Xrm.Utility.confirmDialog(
        "Are you sure you want to approve this project?",
        function () {
            // Call custom action
            var request = {
                entity: {
                    entityType: "cr_project",
                    id: projectId
                },
                getMetadata: function () {
                    return {
                        boundParameter: "entity",
                        operationType: 0,
                        operationName: "cr_ApproveProject"
                    };
                }
            };

            Xrm.WebApi.online.execute(request).then(
                function (response) {
                    Xrm.Navigation.openAlertDialog({
                        text: "Project approved successfully!"
                    });
                    // Refresh the form
                    Xrm.Page.data.refresh();
                },
                function (error) {
                    Xrm.Navigation.openAlertDialog({
                        text: "Error: " + error.message
                    });
                }
            );
        }
    );
}
```

## Dashboard Configuration

Create interactive dashboards:

```yaml
Dashboard: Project Overview
Type: Interactive
Layout: 3 Column

Charts:
  - Name: Projects by Status
    Type: Pie Chart
    Entity: cr_project
    Category: cr_status
    Series: COUNT(cr_projectid)

  - Name: Budget vs Actual
    Type: Bar Chart
    Entity: cr_project
    Category: cr_name
    Series:
      - cr_budget
      - cr_actualcost

Views:
  - Name: My Active Projects
    Entity: cr_project
    View: My Active Projects

  - Name: Overdue Tasks
    Entity: cr_task
    View: Overdue Tasks

Interactive Filters:
  - cr_status
  - cr_priority
  - ownerid
  - cr_customerid
```

## Best Practices

1. **Design data model first** - Forms and views follow the model
2. **Use business rules** before JavaScript
3. **Leverage security roles** - Built-in row-level security
4. **Create meaningful views** - Users rely on views heavily
5. **Use business process flows** for guided experiences
6. **Test on mobile** - Model-driven apps are responsive
7. **Use solutions** for ALM and deployment

## Conclusion

Model-driven apps provide a powerful framework for building enterprise applications rapidly. By focusing on data modeling and leveraging the platform's built-in capabilities, you can create sophisticated business applications with consistent UX and robust features. The combination of no-code business rules with pro-code extensibility makes model-driven apps suitable for a wide range of enterprise scenarios.
