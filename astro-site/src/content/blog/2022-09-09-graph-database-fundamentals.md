---
title: "Graph Database Fundamentals for Azure Developers"
description: "Graph databases unlock powerful relationship-based queries that would be complex or impossible with traditional relational approaches."
author: "Michael John Peña"
draft: false
date: 2022-09-09
tags: ["Azure", "Graph Database", "Data Modeling", "Architecture"]
---

## Understanding Graph Data Models

### Core Concepts

```text
Graph Structure:
    [Vertex/Node] ---(Edge/Relationship)---> [Vertex/Node]

    Properties:
    - Vertices have labels and properties
    - Edges have labels, direction, and properties
    - Both can store key-value pairs
```

### When to Use Graph Databases

```csharp
// Example: Social Network Model
// Relational approach requires expensive JOINs
/*
SELECT DISTINCT f2.name
FROM users u
JOIN friendships f1 ON u.id = f1.user_id
JOIN friendships f2 ON f1.friend_id = f2.user_id
WHERE u.name = 'Alice'
AND f2.friend_id NOT IN (SELECT friend_id FROM friendships WHERE user_id = u.id)
*/

// Graph approach - natural traversal
/*
g.V().has('name', 'Alice')
    .out('knows')
    .out('knows')
    .where(neq('Alice'))
    .dedup()
    .values('name')
*/
```

### Modeling Entities as Vertices

```csharp
public class GraphVertex
{
    public string Id { get; set; }
    public string Label { get; set; }
    public string PartitionKey { get; set; }
    public Dictionary<string, object> Properties { get; set; }

    public string ToGremlinQuery()
    {
        var props = string.Join("",
            Properties.Select(p => $".property('{p.Key}', {FormatValue(p.Value)})"));

        return $"g.addV('{Label}').property('id', '{Id}').property('pk', '{PartitionKey}'){props}";
    }

    private string FormatValue(object value)
    {
        return value switch
        {
            string s => $"'{s}'",
            int i => i.ToString(),
            double d => d.ToString(),
            bool b => b.ToString().ToLower(),
            DateTime dt => $"'{dt:O}'",
            _ => $"'{value}'"
        };
    }
}

// Domain-specific vertices
public class PersonVertex : GraphVertex
{
    public PersonVertex(string id, string name, int age, string city)
    {
        Id = id;
        Label = "person";
        PartitionKey = city;
        Properties = new Dictionary<string, object>
        {
            ["name"] = name,
            ["age"] = age,
            ["city"] = city,
            ["createdAt"] = DateTime.UtcNow
        };
    }
}

public class ProductVertex : GraphVertex
{
    public ProductVertex(string id, string name, decimal price, string category)
    {
        Id = id;
        Label = "product";
        PartitionKey = category;
        Properties = new Dictionary<string, object>
        {
            ["name"] = name,
            ["price"] = price,
            ["category"] = category
        };
    }
}
```

### Modeling Relationships as Edges

```csharp
public class GraphEdge
{
    public string FromVertexId { get; set; }
    public string ToVertexId { get; set; }
    public string Label { get; set; }
    public Dictionary<string, object> Properties { get; set; }

    public string ToGremlinQuery()
    {
        var props = Properties != null
            ? string.Join("", Properties.Select(p => $".property('{p.Key}', '{p.Value}')"))
            : "";

        return $"g.V('{FromVertexId}').addE('{Label}').to(g.V('{ToVertexId}')){props}";
    }
}

// Common relationship types
public static class RelationshipTypes
{
    // Social
    public const string Knows = "knows";
    public const string Follows = "follows";
    public const string BlockedBy = "blocked_by";

    // Commerce
    public const string Purchased = "purchased";
    public const string Viewed = "viewed";
    public const string AddedToCart = "added_to_cart";
    public const string Reviewed = "reviewed";

    // Organizational
    public const string ReportsTo = "reports_to";
    public const string MemberOf = "member_of";
    public const string WorksAt = "works_at";

    // Content
    public const string CreatedBy = "created_by";
    public const string TaggedWith = "tagged_with";
    public const string RelatedTo = "related_to";
}
```

### Graph Database Design Patterns

```csharp
public class GraphDesignPatterns
{
    private readonly GremlinClient _client;

    // Pattern 1: Fan-out queries (one-to-many)
    public async Task<List<string>> GetUserPurchasesAsync(string userId)
    {
        // Find all products a user has purchased
        var query = $@"
            g.V('{userId}')
                .hasLabel('user')
                .out('purchased')
                .hasLabel('product')
                .values('name')";

        var result = await _client.SubmitAsync<string>(query);
        return result.ToList();
    }

    // Pattern 2: Fan-in queries (many-to-one)
    public async Task<List<string>> GetProductBuyersAsync(string productId)
    {
        // Find all users who purchased a product
        var query = $@"
            g.V('{productId}')
                .hasLabel('product')
                .in('purchased')
                .hasLabel('user')
                .values('name')";

        var result = await _client.SubmitAsync<string>(query);
        return result.ToList();
    }

    // Pattern 3: Path finding
    public async Task<List<dynamic>> FindConnectionPathAsync(string fromId, string toId)
    {
        var query = $@"
            g.V('{fromId}')
                .repeat(both().simplePath())
                .until(hasId('{toId}').or().loops().is(6))
                .hasId('{toId}')
                .path()
                .by('name')
                .limit(5)";

        var result = await _client.SubmitAsync<dynamic>(query);
        return result.ToList();
    }

    // Pattern 4: Recommendation through common connections
    public async Task<List<dynamic>> GetRecommendationsAsync(string userId)
    {
        var query = $@"
            g.V('{userId}')
                .as('user')
                .out('purchased')
                .in('purchased')
                .where(neq('user'))
                .out('purchased')
                .where(without(
                    g.V('{userId}').out('purchased').fold()
                ))
                .groupCount()
                .by('name')
                .order(local)
                .by(values, desc)
                .limit(local, 10)";

        var result = await _client.SubmitAsync<dynamic>(query);
        return result.ToList();
    }

    // Pattern 5: Aggregation across paths
    public async Task<dynamic> GetInfluenceScoreAsync(string userId)
    {
        var query = $@"
            g.V('{userId}')
                .project('direct', 'indirect', 'total')
                .by(out('follows').count())
                .by(out('follows').out('follows').dedup().count())
                .by(repeat(out('follows')).times(3).dedup().count())";

        var result = await _client.SubmitAsync<dynamic>(query);
        return result.FirstOrDefault();
    }
}
```

### Performance Optimization

```csharp
public class GraphPerformanceOptimizer
{
    // 1. Use partition keys effectively
    public string OptimizedLocalQuery(string partitionKey, string vertexId)
    {
        // Query within partition for better performance
        return $@"
            g.V()
                .has('pk', '{partitionKey}')
                .hasId('{vertexId}')
                .out('knows')
                .has('pk', '{partitionKey}')
                .values('name')";
    }

    // 2. Limit traversal depth
    public string BoundedTraversal(string startId, int maxDepth)
    {
        return $@"
            g.V('{startId}')
                .repeat(out().simplePath())
                .until(loops().is({maxDepth}))
                .path()
                .limit(100)";
    }

    // 3. Use projections to reduce data transfer
    public string EfficientProjection(string userId)
    {
        return $@"
            g.V('{userId}')
                .out('knows')
                .project('id', 'name', 'connectionCount')
                .by(id())
                .by('name')
                .by(out().count())";
    }

    // 4. Batch operations
    public string BatchVertexCreation(List<(string id, string name, string pk)> vertices)
    {
        var queries = vertices.Select(v =>
            $"g.addV('person').property('id', '{v.id}').property('name', '{v.name}').property('pk', '{v.pk}')");

        return string.Join("; ", queries);
    }
}
```

### Common Graph Algorithms

```python
from gremlin_python.driver import client, serializer

class GraphAlgorithms:
    def __init__(self, gremlin_client):
        self.client = gremlin_client

    def pagerank_approximation(self, iterations=3):
        """Approximate PageRank using iterative neighbor counting"""
        query = f"""
            g.V().hasLabel('person')
             .project('name', 'score')
             .by('name')
             .by(
                 repeat(both('knows'))
                 .times({iterations})
                 .dedup()
                 .count()
             )
             .order()
             .by(select('score'), desc)
        """
        return self._execute(query)

    def find_clusters(self, min_size=3):
        """Find tightly connected groups"""
        query = f"""
            g.V().hasLabel('person')
             .where(out('knows').count().is(gte({min_size})))
             .project('name', 'group')
             .by('name')
             .by(out('knows').values('name').fold())
        """
        return self._execute(query)

    def detect_bridges(self):
        """Find vertices that connect different communities"""
        query = """
            g.V().hasLabel('person')
             .as('p')
             .out('knows')
             .out('knows')
             .where(without('p'))
             .in('knows')
             .where(without('p').and(without(select('p').out('knows'))))
             .select('p')
             .dedup()
             .values('name')
        """
        return self._execute(query)

    def _execute(self, query):
        callback = self.client.submitAsync(query)
        return callback.result().all().result()
```

## Key Takeaways

1. **Model relationships first** - Think in terms of connections
2. **Choose partition keys wisely** - Affects query performance
3. **Limit traversal depth** - Unbounded queries can be expensive
4. **Use projections** - Return only needed data
5. **Leverage indexes** - Create indexes for frequently filtered properties

Graph databases unlock powerful relationship-based queries that would be complex or impossible with traditional relational approaches.
