---
title: Implementing Azure Advisor Recommendations at Scale
description: "Azure Advisor is the free recommendation service that surfaces findings your team should have already found—and usually hasn't. The five categories (Cost…"
author: Michael John Peña
draft: false
date: 2021-06-18
url: /blog/azure-advisor-recommendations/
tags:
  - Azure
  - Advisor
  - Optimization
  - Best Practices
---

Azure Advisor is the free recommendation service that surfaces findings your team should have already found—and usually hasn't. The five categories (Cost, Security, Reliability, Operational Excellence, Performance) each surface recommendations based on actual resource configuration and usage data. The Cost category identified idle ExpressRoute circuits and underutilised Reserved Instances on the first scan of a client estate; those two findings alone recovered more budget than a week of manual analysis would have. The recommendation API is the part I use most in automation: pull Advisor recommendations via the API, create work items in Azure DevOps for security recommendations, alert on new reliability recommendations via Logic Apps. Treating Advisor as a continuous signal rather than a periodic report changes its value significantly.

## Accessing Advisor Recommendations

### Azure CLI Queries

```bash
# List all recommendations
az advisor recommendation list --output table

# Filter by category
az advisor recommendation list --category Cost --output table

# Get recommendations for specific resource
az advisor recommendation list \
  --resource-group myResourceGroup \
  --category Performance

# Get high-impact recommendations
az advisor recommendation list \
  --query "[?impact=='High']" \
  --output table
```

### PowerShell Access

```powershell
# Get all recommendations
$recommendations = Get-AzAdvisorRecommendation

# Group by category
$recommendations | Group-Object Category | Select-Object Name, Count

# Filter cost recommendations with potential savings
$costRecs = Get-AzAdvisorRecommendation |
    Where-Object { $_.Category -eq 'Cost' } |
    Select-Object ResourceId, ShortDescription, ExtendedProperties

# Show potential savings
$costRecs | ForEach-Object {
    $savings = $_.ExtendedProperties['annualSavingsAmount']
    if ($savings) {
        [PSCustomObject]@{
            Resource = ($_.ResourceId -split '/')[-1]
            Description = $_.ShortDescription.Problem
            AnnualSavings = "$" + $savings
        }
    }
}
```

## C# SDK Integration

```csharp
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.Advisor;

public class AdvisorService
{
    private readonly ArmClient _armClient;

    public AdvisorService()
    {
        _armClient = new ArmClient(new DefaultAzureCredential());
    }

    public async Task<IList<RecommendationSummary>> GetRecommendationsAsync(
        string? category = null)
    {
        var recommendations = new List<RecommendationSummary>();
        var subscription = await _armClient.GetDefaultSubscriptionAsync();

        await foreach (var rec in subscription.GetAdvisorRecommendationsAsync())
        {
            if (category == null ||
                rec.Data.Category.ToString().Equals(category, StringComparison.OrdinalIgnoreCase))
            {
                recommendations.Add(new RecommendationSummary
                {
                    Id = rec.Data.Id,
                    Category = rec.Data.Category.ToString(),
                    Impact = rec.Data.Impact.ToString(),
                    ResourceId = rec.Data.ResourceId,
                    Problem = rec.Data.ShortDescription?.Problem,
                    Solution = rec.Data.ShortDescription?.Solution,
                    PotentialBenefits = rec.Data.ExtendedProperties
                        ?.GetValueOrDefault("annualSavingsAmount")
                });
            }
        }

        return recommendations;
    }

    public async Task<Dictionary<string, int>> GetRecommendationCountsAsync()
    {
        var counts = new Dictionary<string, int>();
        var subscription = await _armClient.GetDefaultSubscriptionAsync();

        await foreach (var rec in subscription.GetAdvisorRecommendationsAsync())
        {
            var category = rec.Data.Category.ToString();
            counts[category] = counts.GetValueOrDefault(category) + 1;
        }

        return counts;
    }

    public async Task SuppressRecommendationAsync(
        string recommendationId,
        string suppressionName,
        TimeSpan? duration = null)
    {
        var subscription = await _armClient.GetDefaultSubscriptionAsync();

        // Create suppression
        // Note: Implementation depends on specific SDK version
    }
}

public record RecommendationSummary
{
    public string Id { get; init; }
    public string Category { get; init; }
    public string Impact { get; init; }
    public string ResourceId { get; init; }
    public string Problem { get; init; }
    public string Solution { get; init; }
    public string PotentialBenefits { get; init; }
}
```

## Automated Recommendation Processing

### Azure Function for Daily Processing

```csharp
public class AdvisorProcessingFunction
{
    private readonly ILogger<AdvisorProcessingFunction> _logger;
    private readonly AdvisorService _advisorService;
    private readonly NotificationService _notificationService;

    [Function("ProcessAdvisorRecommendations")]
    public async Task Run([TimerTrigger("0 0 6 * * *")] TimerInfo timer)
    {
        _logger.LogInformation("Processing Advisor recommendations");

        var recommendations = await _advisorService.GetRecommendationsAsync();

        // Group by category
        var grouped = recommendations.GroupBy(r => r.Category);

        foreach (var group in grouped)
        {
            await ProcessCategoryAsync(group.Key, group.ToList());
        }

        // Generate daily report
        await GenerateDailyReportAsync(recommendations);
    }

    private async Task ProcessCategoryAsync(
        string category,
        List<RecommendationSummary> recommendations)
    {
        switch (category)
        {
            case "Cost":
                await ProcessCostRecommendationsAsync(recommendations);
                break;
            case "Security":
                await ProcessSecurityRecommendationsAsync(recommendations);
                break;
            case "HighAvailability":
                await ProcessReliabilityRecommendationsAsync(recommendations);
                break;
            default:
                _logger.LogInformation(
                    "{Count} {Category} recommendations to review",
                    recommendations.Count,
                    category);
                break;
        }
    }

    private async Task ProcessCostRecommendationsAsync(
        List<RecommendationSummary> recommendations)
    {
        var highImpact = recommendations
            .Where(r => r.Impact == "High")
            .ToList();

        if (highImpact.Any())
        {
            // Notify finance team
            await _notificationService.SendTeamsMessageAsync(
                "finance-channel",
                $"Found {highImpact.Count} high-impact cost recommendations",
                highImpact.Select(r => $"- {r.Problem}").ToList());
        }

        // Auto-implement safe recommendations
        foreach (var rec in recommendations.Where(r => IsSafeToAutoImplement(r)))
        {
            await AutoImplementRecommendationAsync(rec);
        }
    }

    private bool IsSafeToAutoImplement(RecommendationSummary recommendation)
    {
        // Define criteria for auto-implementation
        var safePatterns = new[]
        {
            "Delete unattached disk",
            "Delete unused public IP",
            "Delete empty resource group"
        };

        return safePatterns.Any(p =>
            recommendation.Problem?.Contains(p, StringComparison.OrdinalIgnoreCase) == true);
    }

    private async Task AutoImplementRecommendationAsync(RecommendationSummary rec)
    {
        _logger.LogInformation("Auto-implementing: {Problem}", rec.Problem);
        // Implementation logic based on recommendation type
    }
}
```

## Resource Graph for Advisor Data

```kusto
// Query Advisor recommendations via Resource Graph
AdvisorResources
| where type == 'microsoft.advisor/recommendations'
| extend
    category = tostring(properties.category),
    impact = tostring(properties.impact),
    problem = tostring(properties.shortDescription.problem),
    solution = tostring(properties.shortDescription.solution),
    resourceId = tostring(properties.resourceMetadata.resourceId)
| summarize count() by category, impact

// Find high-impact recommendations
AdvisorResources
| where type == 'microsoft.advisor/recommendations'
| where properties.impact == 'High'
| project
    category = properties.category,
    problem = properties.shortDescription.problem,
    resource = properties.resourceMetadata.resourceId
| order by category

// Calculate potential cost savings
AdvisorResources
| where type == 'microsoft.advisor/recommendations'
| where properties.category == 'Cost'
| extend savings = todouble(properties.extendedProperties.annualSavingsAmount)
| summarize TotalSavings = sum(savings)
```

## Implementing Specific Recommendations

### Right-Size Virtual Machines

```csharp
public async Task RightSizeVirtualMachinesAsync()
{
    var armClient = new ArmClient(new DefaultAzureCredential());
    var subscription = await armClient.GetDefaultSubscriptionAsync();

    // Get right-sizing recommendations
    var recommendations = await subscription.GetAdvisorRecommendationsAsync()
        .Where(r => r.Data.ShortDescription?.Problem?.Contains("right-size") == true)
        .ToListAsync();

    foreach (var rec in recommendations)
    {
        var vmId = rec.Data.ResourceId;
        var recommendedSize = rec.Data.ExtendedProperties?
            .GetValueOrDefault("recommendedSku");

        if (recommendedSize != null)
        {
            _logger.LogInformation(
                "VM {VmId} recommended to resize to {Size}",
                vmId, recommendedSize);

            // Create work item for manual review
            await CreateResizeWorkItemAsync(vmId, recommendedSize);
        }
    }
}
```

### Delete Unused Resources

```csharp
public async Task CleanupUnusedResourcesAsync()
{
    var armClient = new ArmClient(new DefaultAzureCredential());
    var subscription = await armClient.GetDefaultSubscriptionAsync();

    // Get recommendations for unused resources
    var unusedResourceRecs = await subscription.GetAdvisorRecommendationsAsync()
        .Where(r => r.Data.Category == Category.Cost)
        .Where(r => IsUnusedResourceRecommendation(r))
        .ToListAsync();

    foreach (var rec in unusedResourceRecs)
    {
        var resourceId = rec.Data.ResourceId;
        var resource = armClient.GetGenericResource(new ResourceIdentifier(resourceId));

        // Check tags for auto-cleanup eligibility
        var resourceData = await resource.GetAsync();
        if (resourceData.Value.Data.Tags?.TryGetValue("AutoCleanup", out var value) == true &&
            value == "true")
        {
            _logger.LogInformation("Auto-deleting unused resource: {Id}", resourceId);
            await resource.DeleteAsync(Azure.WaitUntil.Started);
        }
        else
        {
            // Notify owner
            var owner = resourceData.Value.Data.Tags?.GetValueOrDefault("Owner");
            if (owner != null)
            {
                await NotifyOwnerAsync(owner, resourceId, rec.Data.ShortDescription?.Problem);
            }
        }
    }
}

private bool IsUnusedResourceRecommendation(AdvisorRecommendationResource rec)
{
    var problem = rec.Data.ShortDescription?.Problem?.ToLower() ?? "";
    return problem.Contains("unused") ||
           problem.Contains("unattached") ||
           problem.Contains("idle");
}
```

## Advisor Score Tracking

```csharp
public class AdvisorScoreService
{
    public async Task<AdvisorScoreReport> GetScoreReportAsync()
    {
        var armClient = new ArmClient(new DefaultAzureCredential());
        var subscription = await armClient.GetDefaultSubscriptionAsync();

        var scores = new Dictionary<string, double>();
        var recommendations = await subscription.GetAdvisorRecommendationsAsync()
            .ToListAsync();

        // Calculate category scores
        var categories = new[] { "Cost", "Security", "HighAvailability", "OperationalExcellence", "Performance" };

        foreach (var category in categories)
        {
            var categoryRecs = recommendations
                .Where(r => r.Data.Category.ToString() == category)
                .ToList();

            var implemented = categoryRecs.Count(r =>
                r.Data.SuppressionIds?.Any() == true);
            var total = categoryRecs.Count;

            scores[category] = total > 0
                ? (double)implemented / total * 100
                : 100;
        }

        return new AdvisorScoreReport
        {
            Date = DateTime.UtcNow,
            OverallScore = scores.Values.Average(),
            CategoryScores = scores,
            TotalRecommendations = recommendations.Count,
            HighImpactCount = recommendations.Count(r => r.Data.Impact.ToString() == "High")
        };
    }
}

public record AdvisorScoreReport
{
    public DateTime Date { get; init; }
    public double OverallScore { get; init; }
    public Dictionary<string, double> CategoryScores { get; init; }
    public int TotalRecommendations { get; init; }
    public int HighImpactCount { get; init; }
}
```

## Weekly Advisor Report

```csharp
public class WeeklyAdvisorReportService
{
    [Function("WeeklyAdvisorReport")]
    public async Task GenerateReport([TimerTrigger("0 0 9 * * MON")] TimerInfo timer)
    {
        var report = new StringBuilder();
        report.AppendLine("# Weekly Azure Advisor Report\n");

        var recommendations = await _advisorService.GetRecommendationsAsync();
        var scores = await _scoreService.GetScoreReportAsync();

        // Overall Score
        report.AppendLine($"## Advisor Score: {scores.OverallScore:0.0}/100\n");

        // Category Breakdown
        report.AppendLine("## Category Scores");
        foreach (var (category, score) in scores.CategoryScores)
        {
            var emoji = score >= 80 ? "OK" : score >= 60 ? "WARN" : "CRIT";
            report.AppendLine($"- {category}: {score:0.0} [{emoji}]");
        }

        // High Impact Items
        report.AppendLine("\n## High Impact Recommendations");
        var highImpact = recommendations.Where(r => r.Impact == "High").Take(10);
        foreach (var rec in highImpact)
        {
            report.AppendLine($"- [{rec.Category}] {rec.Problem}");
        }

        // Potential Savings
        var savings = recommendations
            .Where(r => r.PotentialBenefits != null)
            .Sum(r => double.TryParse(r.PotentialBenefits, out var v) ? v : 0);
        report.AppendLine($"\n## Potential Annual Savings: ${savings:N0}");

        await _emailService.SendAsync("ops-team@company.com", "Weekly Advisor Report", report.ToString());
    }
}
```

## Conclusion

Azure Advisor provides actionable recommendations that can significantly improve your cloud infrastructure. By programmatically accessing these recommendations and implementing automation, you can maintain optimal configurations across large Azure estates. Regular review and action on Advisor recommendations should be part of every organization's cloud operations practice.

## References

- [Azure Advisor Documentation](https://docs.microsoft.com/en-us/azure/advisor/)
- [Advisor REST API](https://docs.microsoft.com/en-us/rest/api/advisor/)
