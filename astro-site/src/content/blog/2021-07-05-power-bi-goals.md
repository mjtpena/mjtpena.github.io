---
title: Introducing Power BI Goals for OKR and KPI Tracking
description: "Power BI Goals arrived in 2021 as Microsoft's answer to OKR tracking inside the BI platform, and I think it was better conceived than it might sound. The…"
author: Michael John Peña
draft: false
date: 2021-07-05
url: /blog/power-bi-goals/
tags:
  - Azure
  - Power BI
  - Analytics
  - OKR
  - Business Intelligence
---

Power BI Goals arrived in 2021 as Microsoft's answer to OKR tracking inside the BI platform, and I think it was better conceived than it might sound. The core idea: instead of leadership reading dashboard numbers and manually updating a spreadsheet OKR tracker, connect goals directly to Power BI measures. A revenue target connects to the actual revenue measure in your dataset; the scorecard turns red or green based on live data, not manual updates. Goals can have sub-goals with cascading relationships. For organisations already running their analytics on Power BI, keeping performance management in the same platform reduces the context switching that makes OKR reviews feel like extra overhead.

## Understanding Power BI Goals

Power BI Goals provides:

- Scorecard creation for tracking multiple goals
- Automatic data connection to existing Power BI datasets
- Manual and automatic check-ins
- Goal hierarchies and rollups
- Mobile-friendly goal tracking
- Integration with Microsoft Teams

## Creating Your First Scorecard

Set up a scorecard programmatically using the REST API:

```python
import requests
import json

# Power BI REST API configuration
base_url = "https://api.powerbi.com/v1.0/myorg"
headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json"
}

# Create a new scorecard
scorecard_data = {
    "name": "Q3 2021 Business Goals",
    "description": "Quarterly objectives and key results",
    "sensitivityLabel": None
}

response = requests.post(
    f"{base_url}/groups/{workspace_id}/scorecards",
    headers=headers,
    json=scorecard_data
)

scorecard = response.json()
scorecard_id = scorecard["id"]
print(f"Created scorecard: {scorecard_id}")
```

## Defining Goals

Create goals with targets and owners:

```python
# Define a goal structure
def create_goal(scorecard_id, goal_config):
    goal_data = {
        "name": goal_config["name"],
        "description": goal_config["description"],
        "startDate": goal_config["start_date"],
        "completionDate": goal_config["end_date"],
        "owner": {
            "principal": {
                "identifier": goal_config["owner_email"],
                "principalType": "User"
            }
        },
        "valuesFormatString": goal_config.get("format", "0.00"),
        "status": {
            "rules": [
                {"min": 0, "max": 50, "color": "#FF0000"},
                {"min": 50, "max": 80, "color": "#FFA500"},
                {"min": 80, "max": 100, "color": "#00FF00"}
            ]
        }
    }

    response = requests.post(
        f"{base_url}/groups/{workspace_id}/scorecards/{scorecard_id}/goals",
        headers=headers,
        json=goal_data
    )
    return response.json()

# Create sales goals
sales_goal = create_goal(scorecard_id, {
    "name": "Quarterly Revenue",
    "description": "Achieve $10M in Q3 revenue",
    "start_date": "2021-07-01",
    "end_date": "2021-09-30",
    "owner_email": "sales.lead@company.com",
    "format": "$#,##0"
})

# Create customer success goals
nps_goal = create_goal(scorecard_id, {
    "name": "Customer NPS Score",
    "description": "Maintain NPS above 50",
    "start_date": "2021-07-01",
    "end_date": "2021-09-30",
    "owner_email": "cs.lead@company.com",
    "format": "0"
})
```

## Connecting Goals to Data

Link goals to existing Power BI datasets:

```python
# Connect a goal to a dataset measure
def connect_goal_to_data(scorecard_id, goal_id, connection_config):
    connection_data = {
        "datasetId": connection_config["dataset_id"],
        "currentValueConnection": {
            "tableName": connection_config["table"],
            "columnName": connection_config["current_column"]
        },
        "targetValueConnection": {
            "tableName": connection_config["table"],
            "columnName": connection_config["target_column"]
        },
        "dateColumnConnection": {
            "tableName": connection_config["date_table"],
            "columnName": connection_config["date_column"]
        }
    }

    response = requests.put(
        f"{base_url}/groups/{workspace_id}/scorecards/{scorecard_id}/goals/{goal_id}/connections",
        headers=headers,
        json=connection_data
    )
    return response.json()

# Connect revenue goal to sales dataset
connect_goal_to_data(scorecard_id, sales_goal["id"], {
    "dataset_id": "sales-dataset-guid",
    "table": "SalesMeasures",
    "current_column": "TotalRevenue",
    "target_column": "RevenueTarget",
    "date_table": "Date",
    "date_column": "Date"
})
```

## Creating Goal Hierarchies

Build hierarchical goal structures for OKRs:

```python
# Create an objective with key results
def create_okr_structure(scorecard_id, objective, key_results):
    # Create the main objective
    obj_response = create_goal(scorecard_id, objective)
    objective_id = obj_response["id"]

    # Create key results as child goals
    for kr in key_results:
        kr_response = requests.post(
            f"{base_url}/groups/{workspace_id}/scorecards/{scorecard_id}/goals",
            headers=headers,
            json={
                **kr,
                "parentGoalId": objective_id
            }
        )
        print(f"Created KR: {kr_response.json()['name']}")

    return objective_id

# Define OKR structure
objective = {
    "name": "Expand Market Presence",
    "description": "Grow our market share in APAC region",
    "start_date": "2021-07-01",
    "end_date": "2021-09-30",
    "owner_email": "vp.sales@company.com"
}

key_results = [
    {
        "name": "New Customer Acquisition",
        "description": "Acquire 50 new enterprise customers",
        "start_date": "2021-07-01",
        "end_date": "2021-09-30",
        "owner_email": "sales.apac@company.com",
        "valuesFormatString": "0"
    },
    {
        "name": "Partner Channel Revenue",
        "description": "Generate $2M from partner channels",
        "start_date": "2021-07-01",
        "end_date": "2021-09-30",
        "owner_email": "partnerships@company.com",
        "valuesFormatString": "$#,##0"
    },
    {
        "name": "Customer Retention Rate",
        "description": "Maintain 95% retention rate",
        "start_date": "2021-07-01",
        "end_date": "2021-09-30",
        "owner_email": "cs.apac@company.com",
        "valuesFormatString": "0%"
    }
]

create_okr_structure(scorecard_id, objective, key_results)
```

## Manual Check-ins

Record manual updates for goals:

```python
def record_checkin(scorecard_id, goal_id, checkin_data):
    payload = {
        "value": checkin_data["value"],
        "timestamp": checkin_data["date"],
        "notes": checkin_data.get("notes", ""),
        "status": checkin_data.get("status", "onTrack")
    }

    response = requests.post(
        f"{base_url}/groups/{workspace_id}/scorecards/{scorecard_id}/goals/{goal_id}/checkins",
        headers=headers,
        json=payload
    )
    return response.json()

# Record weekly check-in
record_checkin(scorecard_id, nps_goal["id"], {
    "value": 52,
    "date": "2021-07-05T00:00:00Z",
    "notes": "NPS improved after implementing new support chat feature",
    "status": "onTrack"
})
```

## Embedding Goals in Reports

Embed scorecards in Power BI reports:

```javascript
// Power BI JavaScript SDK - Embed scorecard
const embedConfig = {
    type: 'scorecard',
    id: scorecardId,
    embedUrl: embedUrl,
    accessToken: accessToken,
    tokenType: models.TokenType.Aad,
    settings: {
        filterPaneEnabled: false,
        navContentPaneEnabled: false
    }
};

const scorecardContainer = document.getElementById('scorecard-container');
const scorecard = powerbi.embed(scorecardContainer, embedConfig);

// Listen for events
scorecard.on('loaded', function() {
    console.log('Scorecard loaded');
});

scorecard.on('goalSelected', function(event) {
    console.log('Goal selected:', event.detail.goalId);
    // Navigate to detailed view
});
```

## Teams Integration

Add scorecards to Microsoft Teams:

```typescript
// Teams Tab configuration for Power BI Goals
import * as microsoftTeams from "@microsoft/teams-js";

microsoftTeams.initialize();

// Configure the tab with scorecard
microsoftTeams.settings.setSettings({
    entityId: `scorecard_${scorecardId}`,
    contentUrl: `https://app.powerbi.com/scorecardEmbed?scorecardId=${scorecardId}`,
    suggestedDisplayName: "Q3 Goals Dashboard",
    websiteUrl: `https://app.powerbi.com/groups/${workspaceId}/scorecards/${scorecardId}`
});

// Set up notifications for goal updates
async function subscribeToGoalUpdates(goalId: string) {
    const subscription = {
        changeType: "updated",
        notificationUrl: `${webhookUrl}/goals/notifications`,
        resource: `/scorecards/${scorecardId}/goals/${goalId}`,
        expirationDateTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    // Register webhook for goal updates
    await registerWebhook(subscription);
}
```

## Automating Goal Updates

Create automated check-ins with Power Automate:

```json
{
    "definition": {
        "triggers": {
            "Recurrence": {
                "type": "Recurrence",
                "recurrence": {
                    "frequency": "Day",
                    "interval": 1,
                    "schedule": {
                        "hours": ["9"],
                        "minutes": ["0"]
                    }
                }
            }
        },
        "actions": {
            "Get_Current_Metrics": {
                "type": "Http",
                "inputs": {
                    "method": "GET",
                    "uri": "https://api.company.com/metrics/daily",
                    "authentication": {
                        "type": "ManagedServiceIdentity"
                    }
                }
            },
            "Update_Goal_Value": {
                "type": "Http",
                "inputs": {
                    "method": "POST",
                    "uri": "https://api.powerbi.com/v1.0/myorg/groups/@{variables('workspaceId')}/scorecards/@{variables('scorecardId')}/goals/@{variables('goalId')}/checkins",
                    "headers": {
                        "Authorization": "Bearer @{body('Get_Access_Token')?['access_token']}",
                        "Content-Type": "application/json"
                    },
                    "body": {
                        "value": "@{body('Get_Current_Metrics')?['revenue']}",
                        "timestamp": "@{utcNow()}",
                        "notes": "Automated daily sync"
                    }
                },
                "runAfter": {
                    "Get_Current_Metrics": ["Succeeded"]
                }
            }
        }
    }
}
```

## Conclusion

Power BI Goals brings OKR and KPI tracking directly into your business intelligence platform. By connecting goals to existing datasets, you can automate progress tracking while providing manual check-in capabilities for qualitative updates.

The integration with Microsoft Teams and the ability to embed scorecards in reports makes goal tracking accessible throughout your organization. Start using Power BI Goals to align your teams around measurable objectives and track progress in real-time.
