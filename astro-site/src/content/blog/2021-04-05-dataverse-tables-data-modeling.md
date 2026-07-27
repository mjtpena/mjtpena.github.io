---
title: Dataverse Tables - Data Modeling for the Power Platform
author: Michael John Peña
draft: false
date: 2021-04-05
url: /blog/dataverse-tables-data-modeling/
tags:
  - Power Platform
  - Dataverse
  - Data Modeling
  - Microsoft 365
  - Low-Code

---

I wrote "2021-04-05-dataverse-tables-data-modeling" to share practical, production-minded guidance on this topic.

## Understanding Dataverse Tables

Dataverse tables are similar to database tables but come with built-in capabilities:

- **Security** - Row-level and column-level security
- **Business logic** - Business rules, workflows, plugins
- **Relationships** - One-to-many, many-to-many, lookups
- **Auditing** - Track changes automatically
- **Calculated fields** - Computed values without code

## Table Types

### Standard Tables
Pre-built tables that come with Dataverse:
- Account
- Contact
- Activity
- Task
- User

### Custom Tables
Tables you create for your specific business needs.

### Virtual Tables
Connect to external data sources without importing data.

## Creating a Custom Table

### Using the Maker Portal

Navigate to make.powerapps.com > Tables > New table

```yaml
Table Properties:
  Display Name: "Project"
  Plural Name: "Projects"
  Primary Column: "Project Name"
  Schema Name: "cr_project"
  Description: "Stores project information"

Options:
  Enable attachments: true
  Enable activities: true
  Enable business process flows: true
  Enable auditing: true
```

### Using Power Platform CLI

```bash
# Connect to environment
pac auth create --environment https://yourorg.crm.dynamics.com

# Create table definition
pac solution init --publisher-name "MyPublisher" --publisher-prefix "cr"
pac solution add-reference --path ./MyTable
```

## Designing Column Types

### Standard Columns

```yaml
Columns:
  - Name: "Project Name"
    Type: "Single Line of Text"
    Max Length: 100
    Required: "Business Required"

  - Name: "Description"
    Type: "Multiple Lines of Text"
    Max Length: 2000
    Required: "Optional"

  - Name: "Start Date"
    Type: "Date Only"
    Format: "Date Only"
    Required: "Business Required"

  - Name: "Budget"
    Type: "Currency"
    Precision: 2
    Min: 0
    Max: 999999999

  - Name: "Status"
    Type: "Choice"
    Options:
      - Label: "Not Started"
        Value: 100000000
      - Label: "In Progress"
        Value: 100000001
      - Label: "On Hold"
        Value: 100000002
      - Label: "Completed"
        Value: 100000003
```

### Calculated Columns

```yaml
Calculated Column:
  Name: "Days Until Deadline"
  Type: "Whole Number"
  Formula: "DIFFINDAYS(NOW(), cr_enddate)"
```

### Rollup Columns

```yaml
Rollup Column:
  Name: "Total Task Hours"
  Type: "Decimal Number"
  Related Table: "Tasks"
  Aggregation: "SUM"
  Source Column: "cr_estimatedhours"
  Filter: "cr_status ne 100000003"  # Exclude completed
```

## Establishing Relationships

### One-to-Many (1:N)

```yaml
Relationship:
  Name: "Project_Tasks"
  Related Table: "Task"
  Lookup Column: "Project"
  Behavior:
    Delete: "Remove Link"  # Or Restrict, Cascade
    Assign: "Cascade"
    Share: "Cascade"
    Unshare: "Cascade"
    Reparent: "Cascade"
```

### Many-to-Many (N:N)

```yaml
Relationship:
  Name: "Project_TeamMembers"
  Tables: ["Project", "Contact"]
  Intersect Table: "cr_project_contact"
  Display Options:
    Project Display: "Team Members"
    Contact Display: "Projects"
```

## Business Rules

Create no-code validation and automation:

```yaml
Business Rule:
  Name: "Set Default Status"
  Scope: "Entity"
  Condition:
    Field: "cr_startdate"
    Operator: "On or Before"
    Value: "Today"
  Actions:
    - Type: "Set Field Value"
      Field: "cr_status"
      Value: "In Progress"
    - Type: "Show Error Message"
      Field: "cr_budget"
      Message: "Budget is required for active projects"
      Condition:
        Field: "cr_budget"
        Operator: "Does Not Contain Data"
```

## Working with the Web API

### Query Data

```javascript
// Fetch projects with related tasks
const fetchXml = `
<fetch top="50">
  <entity name="cr_project">
    <attribute name="cr_name" />
    <attribute name="cr_budget" />
    <attribute name="cr_status" />
    <filter>
      <condition attribute="cr_status" operator="ne" value="100000003" />
    </filter>
    <link-entity name="cr_task" from="cr_projectid" to="cr_projectid" alias="tasks">
      <attribute name="cr_name" />
      <attribute name="cr_estimatedhours" />
    </link-entity>
  </entity>
</fetch>`;

const response = await fetch(
  `${orgUrl}/api/data/v9.2/cr_projects?fetchXml=${encodeURIComponent(fetchXml)}`,
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0'
    }
  }
);

const data = await response.json();
```

### Create Record

```javascript
const project = {
  "cr_name": "New Website Redesign",
  "cr_description": "Complete website overhaul",
  "cr_startdate": "2021-04-15",
  "cr_budget": 50000,
  "cr_status": 100000000,
  "cr_customerid@odata.bind": "/accounts(00000000-0000-0000-0000-000000000001)"
};

const response = await fetch(`${orgUrl}/api/data/v9.2/cr_projects`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0'
  },
  body: JSON.stringify(project)
});
```

### Batch Operations

```javascript
const batchId = `batch_${Date.now()}`;
const changesetId = `changeset_${Date.now()}`;

const batchBody = `
--${batchId}
Content-Type: multipart/mixed; boundary=${changesetId}

--${changesetId}
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 1

POST ${orgUrl}/api/data/v9.2/cr_projects HTTP/1.1
Content-Type: application/json

{"cr_name":"Project A","cr_status":100000000}

--${changesetId}
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: 2

POST ${orgUrl}/api/data/v9.2/cr_projects HTTP/1.1
Content-Type: application/json

{"cr_name":"Project B","cr_status":100000000}

--${changesetId}--
--${batchId}--
`;

await fetch(`${orgUrl}/api/data/v9.2/$batch`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': `multipart/mixed; boundary=${batchId}`,
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0'
  },
  body: batchBody
});
```

## Security Model

### Configure Table Permissions

```yaml
Security Role: "Project Manager"
Table: "Project"
Permissions:
  Create: "Organization"
  Read: "Organization"
  Write: "Business Unit"
  Delete: "User"
  Append: "Organization"
  Append To: "Organization"
  Assign: "Business Unit"
  Share: "User"
```

### Column Security Profile

```yaml
Column Security Profile:
  Name: "Hide Budget from Non-Managers"
  Columns:
    - cr_budget:
        Read: "Allowed"  # For managers
        Update: "Allowed"
        Create: "Allowed"
  Teams:
    - "Project Managers"
```

## Data Import and Export

### Using Power Query

```m
let
    Source = CommonDataService.Database("yourorg.crm.dynamics.com"),
    cr_projects = Source{[Schema="dbo",Item="cr_project"]}[Data],
    FilteredRows = Table.SelectRows(cr_projects, each [cr_status] = 100000001),
    SelectedColumns = Table.SelectColumns(FilteredRows,
        {"cr_name", "cr_budget", "cr_startdate", "cr_enddate"})
in
    SelectedColumns
```

### Bulk Data Loading

```csharp
// Using Dataverse SDK for bulk insert
var entityCollection = new EntityCollection();

foreach (var projectData in projectsToImport)
{
    var entity = new Entity("cr_project")
    {
        ["cr_name"] = projectData.Name,
        ["cr_budget"] = new Money(projectData.Budget),
        ["cr_status"] = new OptionSetValue(100000000)
    };
    entityCollection.Entities.Add(entity);
}

var request = new ExecuteMultipleRequest
{
    Requests = new OrganizationRequestCollection(),
    Settings = new ExecuteMultipleSettings
    {
        ContinueOnError = true,
        ReturnResponses = false
    }
};

foreach (var entity in entityCollection.Entities)
{
    request.Requests.Add(new CreateRequest { Target = entity });
}

var response = (ExecuteMultipleResponse)service.Execute(request);
```

## Best Practices

1. **Use solution-aware development** - Always create tables in solutions
2. **Follow naming conventions** - Use consistent prefixes
3. **Normalize appropriately** - Balance normalization with performance
4. **Plan for scalability** - Consider data volumes early
5. **Implement auditing** - Enable for compliance requirements
6. **Use choice columns** - Instead of text for fixed values
7. **Document your model** - Maintain data dictionaries

## Conclusion

Dataverse provides a powerful, enterprise-grade data platform that integrates seamlessly with the Power Platform. By understanding table design, relationships, security, and the Web API, you can build robust data models that support your business applications. The built-in features like business rules, auditing, and security make it an excellent choice for business data management.

