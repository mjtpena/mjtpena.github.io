---
title: "Model-Driven Apps on Common Data Service: Where the Logic Goes"
description: "Building a project tracker as a Power Apps model-driven app, and deciding what belongs in business rules, form scripts, and security roles."
author: Michael John Peña
draft: false
date: 2020-08-14
tags:
  - Power Platform
  - Power Apps
  - Model-Driven Apps
  - Low-Code
  - Dynamics 365
---

Model-driven apps are quick to build and easy to get wrong, because the designer lets you click together entities, forms, views and a site map in an afternoon. Six months later you find validation that only works on one form, JavaScript doing what a business rule could do, and security added as an afterthought. The fix is deciding, layer by layer, where each piece of logic belongs, and a small project tracker on Common Data Service is enough to show it.

## Model-driven or canvas?

My rule of thumb for picking between canvas and model-driven is simple: if the app is a *form over data* with relationships, security roles, and audit requirements, go model-driven. If it's a customer-facing kiosk or a polished mobile experience for a single workflow, go canvas. Mixing the two in one solution is fine and often correct: model-driven for the back office, with a canvas app embedded for the screens users see most.

| Aspect | Model-driven | Canvas |
|--------|--------------|--------|
| Design approach | Data first: the UI is generated from entities, forms and views | UI first: you place every control |
| Layout | Responsive by default (Unified Interface) | You design for each screen size |
| Data | Common Data Service only | Hundreds of connectors, including CDS |
| Logic | Business rules, form scripts, plug-ins, flows | Power Apps formulas, flows |
| Best for | Back-office apps with many related records | Focused, task-specific apps |

The trade-off is control. A model-driven app gives you consistent forms, views, search, audit and security for free, but you accept its layout. If the business keeps asking for pixel-level design, that's a canvas requirement, not a model-driven one.

One timing note for anyone still on Dynamics 365 or older CDS environments: the legacy web client is being retired and environments must be on Unified Interface by 1 December 2020 (see [About Unified Interface](https://learn.microsoft.com/en-us/power-platform/admin/about-unified-interface)). Build and test new apps in Unified Interface only.

## Start with the data model

Everything in a model-driven app hangs off entities in Common Data Service, so the data model is the design. Create a solution first, with your own publisher and prefix, and build every component inside it. Building in the default solution with the `new_` prefix is the most common mistake I see, because untangling it later for ALM is painful.

For the tracker I'd use two custom entities.

**Project** (primary field: Project Name)

| Field | Type | Notes |
|-------|------|-------|
| Start Date | Date Only | |
| End Date | Date Only | |
| Project Status | Option Set | Active, On Hold, Completed |
| Budget | Currency | Picks up the currency and exchange rate behaviour of CDS |
| Description | Multiple Lines of Text | |

**Task** (primary field: Task Name)

| Field | Type | Notes |
|-------|------|-------|
| Due Date | Date Only | |
| Priority | Option Set | Low, Medium, High |
| Task Status | Option Set | Not Started, In Progress, Completed |
| Project | Lookup | Creates a 1:N relationship from Project to Task |

Two design calls are worth making explicitly.

First, I use a custom **Project Status** option set rather than adding values to the built-in Status Reason (`statuscode`). Status Reason is tied to the record's active/inactive state, and deactivating a record makes it read-only. That's a good fit for "archived", not for "on hold". Keep lifecycle state (active/inactive) and business state (your option set) separate.

Second, think about the relationship behaviour on the Project–Task lookup. The default is referential, which means deleting a project leaves orphaned tasks. If tasks have no meaning without their project, set the relationship to parental so deletes, assigns and shares cascade. Make that decision before go-live. Changing cascade behaviour once there's data is possible, but it means reviewing every existing record the change touches.

## Forms and views

The main form for Project is where users spend most of their time:

- **Header:** Project Status, Owner
- **General tab:** a details section (Project Name, Start Date, End Date, Project Status, Budget) and a full-width Description section
- **Tasks tab:** a subgrid of related Tasks
- **Timeline tab:** the timeline control for notes and activities (enable notes and activities on the entity when you create it)

Keep one main form per entity unless roles genuinely need different layouts. Every extra form doubles the places where logic has to be tested.

Views are cheap, so create the ones people actually ask for:

- **Active Projects:** Project Status equals Active, sorted by Start Date descending
- **My Projects:** Owner equals current user, sorted by End Date ascending
- **Overdue Tasks:** Due Date Older Than X Days with X = 1, and Task Status does not equal Completed

View filters support relative date conditions, which makes them the right place for "overdue" style questions rather than a stored "overdue" field. Older Than X Days with X = 1 compares Due Date against the current time minus 24 hours, so a Date Only task due yesterday is included and one due today is not. A fixed condition such as On or Before a chosen date goes stale the next day, so avoid it.

## Business rules first, script second

Microsoft's [business rules](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-create-business-rule) cover more than people expect, and they have one big advantage over JavaScript: with the scope set to **Entity**, the rule runs both on the form and server-side when data is created or updated. Validation in a form script only protects that form. A record created through the Web API, an import, or a flow never sees it.

Two rules for the tracker:

**Validate the date range** (scope: Entity)

- Condition: End Date contains data, and End Date is less than Start Date (compare to the Start Date field value)
- Action: Show error message on End Date: "End date can't be before the start date."

The Show error message action blocks the save, and on the server it returns the error to the calling process.

**Require an End Date for active projects** (scope: All Forms)

- Condition: Project Status equals Active
- Action: Set business required on End Date
- Else: Set not business required on End Date

Know the limits before you commit. A business rule can only work with fields on the entity itself, not related records. Its calculations are basic arithmetic on two values. Set visibility applies to fields only, not tabs or sections. Server-side behaviour comes only from the Entity scope, and only some actions apply there (visibility and requirement level are form behaviours). When you hit one of those walls, that's the point to reach for script.

## Form scripts for what rules can't do

Hiding the Tasks tab once a project is completed is a good example: business rules can't hide a tab, and hiding it is pure UI, so it's a legitimate form script job. The script below also disables Budget on completed projects, as a convenience for users rather than a control.

Add this as a web resource in your solution, then register `Contoso.Project.applyStatusRules` on the form's OnLoad event and on the OnChange event of Project Status, with "Pass execution context as first parameter" ticked. It assumes a custom publisher with the prefix `contoso` and an option value prefix of 12345, and a tab named `tab_tasks`. New option values are the publisher's option value prefix (10,000 to 99,999) followed by four digits, so Completed, the third value, is 123,450,002. Read the actual value from the option set in your solution, and check your schema names, before using it.

```javascript
// Web resource: contoso_/scripts/project.form.js
var Contoso = Contoso || {};
Contoso.Project = Contoso.Project || {};

(function (ns) {
    "use strict";

    // Replace with your Completed option value
    var STATUS_COMPLETED = 123450002;

    ns.applyStatusRules = function (executionContext) {
        var formContext = executionContext.getFormContext();
        var statusAttribute = formContext.getAttribute("contoso_projectstatus");
        if (!statusAttribute) {
            return;
        }

        var isCompleted = statusAttribute.getValue() === STATUS_COMPLETED;

        var tasksTab = formContext.ui.tabs.get("tab_tasks");
        if (tasksTab) {
            tasksTab.setVisible(!isCompleted);
        }

        var budgetControl = formContext.getControl("contoso_budget");
        if (budgetControl) {
            budgetControl.setDisabled(isCompleted);
        }
    };
})(Contoso.Project);
```

A few habits matter more than the code itself:

- Use `executionContext.getFormContext()`. `Xrm.Page` has been deprecated since version 9.0, and the [Client API reference](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/executioncontext/getformcontext) is built around `formContext`.
- Namespace your functions. Global functions from different web resources collide.
- Null-check controls. Someone will remove a field from the form, and your script shouldn't break the whole form when they do.
- Don't use script for security. Disabling a control on the form is a convenience, not a control. A user with Write privilege can still change the value through bulk edit, an editable grid, Excel or the Web API. If a completed project's budget must never change, reject the update in a synchronous plug-in or real-time workflow, or restrict the field with field security.

If a rule needs related records or must hold for every write, it belongs on the server: a plug-in, a real-time workflow, or a Power Automate flow, depending on whether it has to be synchronous.

## Security roles

Model-driven apps inherit the Common Data Service security model, and that is the main reason to choose them for back-office work. Privileges are set per entity, with an access level of User, Business Unit, Parent: Child Business Units or Organization. The [security roles and privileges](https://learn.microsoft.com/en-us/power-platform/admin/security-roles-privileges) documentation covers how they combine.

A reasonable starting point for a Project Manager role:

| Entity | Create | Read | Write | Delete |
|--------|--------|------|-------|--------|
| Project | Business Unit | Organization | Business Unit | User |
| Task | Business Unit | Organization | Business Unit | Business Unit |

I start from least privilege and widen when someone gives me a reason. Organization-level Delete is almost never the right answer for a line-of-business entity. Copy a minimal role rather than editing the out-of-the-box ones, and remember that a user also needs basic privileges on system entities before the app will load at all.

## Assemble, publish and share

With the entities, forms, views and roles in place, building the app itself is the quick part:

1. Create the model-driven app in your solution and define the site map: one area, a **Projects** group with Projects and Tasks, and a **Reports** group with a dashboard.
2. Add the Project and Task forms and views you want exposed. Leave out the rest so users aren't shown every system view.
3. Build a dashboard with a Projects by Status chart, a Budget by Project chart, and the My Projects and Overdue Tasks views.
4. Validate the app, then publish all customisations.
5. Share the app by assigning security roles to it, and assign those roles to users. Users need a Power Apps licence that includes Common Data Service. Office 365 seeded rights don't cover it.

Users open the app from apps.powerapps.com (or Office.com and home.dynamics.com), or the Power Apps mobile app; make.powerapps.com is where makers build it. The same Unified Interface forms render on phones without a separate build. That's useful, but test the main form on a phone anyway, because a ten-field header section that works on a desktop is miserable on mobile.

## Where I'd draw the lines

The order of preference I use on model-driven projects:

1. **The data model and view filters** answer most "can the app show me…" questions.
2. **Business rules at Entity scope** handle validation that must always hold.
3. **Security roles** decide who can do what, not form scripts.
4. **Form scripts** handle UI behaviour that rules can't express, and nothing else.
5. **Plug-ins and flows** handle logic that involves related records or other systems.

If the requirements keep pushing you toward lots of script to reshape the UI, step back and ask whether part of the app should be a canvas app embedded in a model-driven one. When the reverse happens and a canvas app starts rebuilding security, relationships and audit by hand, it probably should have been model-driven from the start.
