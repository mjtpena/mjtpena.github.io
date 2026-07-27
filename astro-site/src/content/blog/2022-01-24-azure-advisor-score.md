---
title: "Azure Advisor Score: Measuring Your Cloud Excellence"
author: Michael John Peña
draft: false
date: 2022-01-24
url: /blog/azure-advisor-score/
tags:
  - azure
  - advisor
  - optimization
  - best-practices

---

I wrote "Azure Advisor Score: Measuring Your Cloud Excellence" to share practical, production-minded guidance on this topic.

## Understanding Advisor Score

Advisor Score is calculated across five categories:
- Cost (reduce spending)
- Security (protect workloads)
- Reliability (ensure availability)
- Operational Excellence (improve operations)
- Performance (optimize speed)

## Getting Your Advisor Score

```powershell
# Get overall Advisor score
$score = Invoke-AzRestMethod -Method GET `
    -Path "/subscriptions/$((Get-AzContext).Subscription.Id)/providers/Microsoft.Advisor/advisorScore?api-version=2020-09-01"

$scoreData = ($score.Content | ConvertFrom-Json).value

foreach ($category in $scoreData) {
    Write-Host "$($category.name): $([math]::Round($category.properties.score * 100, 1))%"
}
```

## Retrieving Recommendations

```csharp
using Azure.ResourceManager;
using Azure.ResourceManager.Advisor;
using Azure.Identity;

public class AdvisorService
{
    private readonly ArmClient _armClient;

    public AdvisorService()
    {
        _armClient = new ArmClient(new DefaultAzureCredential());
    }

    public async Task<List<RecommendationSummary>> GetRecommendationsAsync(string subscriptionId)
    {
        var subscription = _armClient.GetSubscriptionResource(
            new ResourceIdentifier($"/subscriptions/{subscriptionId}"));

        var recommendations = new List<RecommendationSummary>();

        await foreach (var rec in subscription.GetAdvisorRecommendations().GetAllAsync())
        {
            recommendations.Add(new RecommendationSummary
            {
                Category = rec.Data.Category.ToString(),
                Impact = rec.Data.Impact.ToString(),
                Problem = rec.Data.ShortDescription?.Problem,
                Solution = rec.Data.ShortDescription?.Solution,
                ResourceId = rec.Data.ResourceMetadata?.ResourceId,
                PotentialBenefits = rec.Data.ExtendedProperties?.GetValueOrDefault("annualSavingsAmount")
            });
        }

        return recommendations.OrderByDescending(r => r.Impact).ToList();
    }
}

public class RecommendationSummary
{
    public string Category { get; set; }
    public string Impact { get; set; }
    public string Problem { get; set; }
    public string Solution { get; set; }
    public string ResourceId { get; set; }
    public string PotentialBenefits { get; set; }
}
```

## Automating Recommendation Implementation

```powershell
# Auto-implement safe recommendations
param(
    [string]$SubscriptionId,
    [string[]]$Categories = @('Cost'),
    [switch]$WhatIf
)

$recommendations = Get-AzAdvisorRecommendation |
    Where-Object { $_.Category -in $Categories -and $_.Impact -eq 'High' }

foreach ($rec in $recommendations) {
    Write-Host "Processing: $($rec.ShortDescription.Problem)"

    # Handle specific recommendation types
    switch -Regex ($rec.RecommendationTypeId) {
        'e10b1381-5f0a-47ff-8c7b-37bd13d7c974' {
            # Right-size or shutdown underutilized VMs
            $vmId = $rec.ResourceMetadata.ResourceId
            $vm = Get-AzVM -ResourceId $vmId

            if ($rec.ExtendedProperties.recommendedSku) {
                $newSize = $rec.ExtendedProperties.recommendedSku
                Write-Host "  Recommended resize: $($vm.HardwareProfile.VmSize) -> $newSize"

                if (-not $WhatIf) {
                    $vm.HardwareProfile.VmSize = $newSize
                    Update-AzVM -VM $vm -ResourceGroupName $vm.ResourceGroupName
                }
            }
        }

        '57f30416-aa4d-45dc-b85a-b55c31fbd67e' {
            # Delete unattached disks
            $diskId = $rec.ResourceMetadata.ResourceId
            Write-Host "  Deleting unattached disk: $diskId"

            if (-not $WhatIf) {
                Remove-AzDisk -ResourceId $diskId -Force
            }
        }

        default {
            Write-Host "  Manual review required for: $($rec.RecommendationTypeId)"
        }
    }
}
```

## Creating a Score Dashboard

```kusto
// Log Analytics query for Advisor trends
AdvisorResources
| where type == "microsoft.advisor/recommendations"
| extend category = tostring(properties.category),
         impact = tostring(properties.impact),
         resourceId = tostring(properties.resourceMetadata.resourceId)
| summarize
    TotalRecommendations = count(),
    HighImpact = countif(impact == "High"),
    MediumImpact = countif(impact == "Medium"),
    LowImpact = countif(impact == "Low")
    by category
| order by HighImpact desc
```

## CI/CD Integration

```yaml
# .github/workflows/advisor-gate.yml
name: Advisor Score Gate

on:
  pull_request:
    branches: [main]
    paths:
      - 'infrastructure/**'

jobs:
  check-advisor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Get Advisor Score
        id: advisor
        run: |
          # Get current score
          score=$(az rest --method get \
            --url "https://management.azure.com/subscriptions/${{ secrets.SUBSCRIPTION_ID }}/providers/Microsoft.Advisor/advisorScore?api-version=2020-09-01" \
            --query "value[?name=='Cost'].properties.score" -o tsv)

          echo "score=$score" >> $GITHUB_OUTPUT

          # Check for high-impact recommendations
          high_impact=$(az advisor recommendation list \
            --filter "Impact eq 'High'" \
            --query "length(@)")

          echo "high_impact=$high_impact" >> $GITHUB_OUTPUT

      - name: Check Score Threshold
        run: |
          score=${{ steps.advisor.outputs.score }}
          threshold=0.7

          if (( $(echo "$score < $threshold" | bc -l) )); then
            echo "::error::Advisor score ($score) is below threshold ($threshold)"
            exit 1
          fi

      - name: Comment on PR
        uses: actions/github-script@v6
        with:
          script: |
            const score = (${{ steps.advisor.outputs.score }} * 100).toFixed(1);
            const highImpact = ${{ steps.advisor.outputs.high_impact }};

            const body = `## Azure Advisor Score Report
            | Metric | Value |
            |--------|-------|
            | Current Score | ${score}% |
            | High Impact Recommendations | ${highImpact} |

            ${highImpact > 0 ? '**Action Required**: Address high-impact recommendations before deployment.' : 'No high-impact recommendations.'}`;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });
```

## Scheduling Regular Reviews

```bicep
// automation/advisor-review-automation.bicep
param location string = 'australiaeast'

resource automationAccount 'Microsoft.Automation/automationAccounts@2021-06-22' = {
  name: 'aa-advisor-automation'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    sku: {
      name: 'Basic'
    }
  }
}

resource schedule 'Microsoft.Automation/automationAccounts/schedules@2021-06-22' = {
  parent: automationAccount
  name: 'weekly-advisor-review'
  properties: {
    frequency: 'Week'
    interval: 1
    startTime: '2022-01-01T09:00:00+00:00'
    timeZone: 'Australia/Sydney'
  }
}
```

Azure Advisor Score provides actionable insights to continuously improve your Azure environment's health and efficiency.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
