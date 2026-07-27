---
title: "Azure DevOps Test Plans: Quality Assurance at Scale"
author: Michael John Peña
draft: false
date: 2020-11-30
tags:
  - Azure DevOps
  - Testing
  - Quality
  - DevOps
---

Automated tests are the bulk of my testing pyramid, but there's a tier you can't replace: the human running through a workflow looking for the thing nobody specified. Azure Test Plans is built for that work. Manual test cases tied back to user stories, exploratory test sessions with screen capture, and traceability between bug, test, and the requirement that started it. It's the part of Azure DevOps that QA leads quietly love and developers usually never see.

## Test Plan Hierarchy

```
Test Plan (Release 2.0)
├── Test Suite (User Authentication)
│   ├── Test Case: Login with valid credentials
│   ├── Test Case: Login with invalid password
│   └── Test Case: Password reset flow
├── Test Suite (Shopping Cart)
│   ├── Test Case: Add item to cart
│   ├── Test Case: Remove item from cart
│   └── Test Case: Apply discount code
└── Test Suite (Checkout)
    ├── Test Case: Complete purchase
    └── Test Case: Cancel order
```

## Creating Test Plans

```bash
# Create test plan
az devops invoke \
    --area test \
    --resource plans \
    --route-parameters project=MyProject \
    --http-method POST \
    --in-file test-plan.json

# test-plan.json
{
    "name": "Release 2.0 Test Plan",
    "area": {
        "name": "MyProject\\Release 2.0"
    },
    "iteration": "MyProject\\Sprint 10"
}
```

## Test Cases

```markdown
**Test Case: Login with valid credentials**

**Preconditions:**
- User account exists in system
- User is on login page

**Steps:**
| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Enter valid username | Username field populated |
| 2 | Enter valid password | Password field shows dots |
| 3 | Click Login button | Redirected to dashboard |
| 4 | Verify user name displayed | Name shown in header |

**Shared Parameters:**
@username, @password (from data set)
```

## Parameterized Tests

```xml
<!-- Shared parameter data -->
<ParameterizedData>
  <DataTable>
    <Row>
      <username>user1@test.com</username>
      <password>Pass123!</password>
      <role>Admin</role>
    </Row>
    <Row>
      <username>user2@test.com</username>
      <password>Pass456!</password>
      <role>User</role>
    </Row>
  </DataTable>
</ParameterizedData>
```

## Test Execution

### Web Runner

1. Open Test Plans
2. Select test suite
3. Click "Run"
4. Execute steps, mark pass/fail
5. Add comments and attachments
6. Submit results

### Test Runner Extension

```javascript
// Azure DevOps REST API
const testRun = await client.createTestRun({
    name: "Automated Run",
    plan: { id: planId },
    pointIds: [pointId1, pointId2]
});

// Update results
await client.updateTestResults(testRunId, [{
    id: resultId,
    state: "Completed",
    outcome: "Passed"
}]);
```

## Exploratory Testing

```
Test & Feedback Extension
├── Capture screenshots
├── Record screen
├── Create bugs inline
├── Add annotations
└── Capture user actions
```

## Linked Work Items

```
Test Case ←→ User Story
    ↓
Test Run
    ↓
Bug (on failure)
    ↓
Linked to failing test
```

## Test Analytics

```kusto
// Query test results
TestResultsDaily
| where Date >= ago(30d)
| summarize
    TotalTests = sum(TotalCount),
    PassedTests = sum(ResultPassedCount),
    FailedTests = sum(ResultFailedCount)
    by TestPlanId, Date
| extend PassRate = round(100.0 * PassedTests / TotalTests, 2)
| order by Date desc
```

## REST API Examples

```python
from azure.devops.connection import Connection
from msrest.authentication import BasicAuthentication

credentials = BasicAuthentication('', personal_access_token)
connection = Connection(base_url=organization_url, creds=credentials)

test_client = connection.clients.get_test_client()

# Get test plans
plans = test_client.get_plans(project)

# Get test results
results = test_client.get_test_results(project, run_id)

# Create test run
run = test_client.create_test_run(
    test_run={
        'name': 'API Test Run',
        'plan': {'id': plan_id},
        'isAutomated': True
    },
    project=project
)
```

## Integration with Pipelines

```yaml
# Run tests and publish results
- task: VSTest@2
  inputs:
    testSelector: 'testAssemblies'
    testAssemblyVer2: '**\*Tests*.dll'
    testPlan: 123
    testSuite: 456
    testConfiguration: 789
```

Azure Test Plans: structured testing for quality delivery.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
