---
title: "Graph Traversal Patterns in Azure Cosmos DB"
description: "Exploring the local neighborhood of a vertex is one of the most common operations in graph databases."
author: "Michael John Peña"
draft: false
date: 2022-09-11
tags: ["Azure", "Cosmos DB", "Graph", "Gremlin", "Patterns"]
---

## Pattern 1: Neighborhood Exploration

Exploring the local neighborhood of a vertex is one of the most common operations in graph databases.

```groovy
// Direct neighbors (1 hop)
g.V('user-1').out('follows').values('name')

// Two-hop neighborhood
g.V('user-1').out('follows').out('follows').dedup().values('name')

// N-hop with depth control
g.V('user-1')
    .repeat(out('follows'))
    .times(3)
    .dedup()
    .values('name')

// Neighborhood with distance tracking
g.V('user-1')
    .repeat(out('follows').simplePath())
    .emit()
    .times(3)
    .project('name', 'distance')
    .by('name')
    .by(path().count(local))
```

### C# Implementation

```csharp
public class NeighborhoodExplorer
{
    private readonly GremlinClient _client;

    public async Task<List<Neighbor>> GetNeighborhoodAsync(string vertexId, int maxHops)
    {
        var query = $@"
            g.V('{vertexId}')
                .repeat(out().simplePath())
                .emit()
                .times({maxHops})
                .project('id', 'name', 'distance')
                .by(id())
                .by('name')
                .by(path().count(local).math('_ - 1'))
                .dedup()";

        var results = await _client.SubmitAsync<dynamic>(query);

        return results.Select(r => new Neighbor
        {
            Id = r["id"],
            Name = r["name"],
            Distance = (int)r["distance"]
        }).ToList();
    }
}

public class Neighbor
{
    public string Id { get; set; }
    public string Name { get; set; }
    public int Distance { get; set; }
}
```

## Pattern 2: Path Finding

Finding paths between vertices is crucial for social networks, navigation, and dependency analysis.

```groovy
// Shortest path
g.V('start')
    .repeat(out().simplePath())
    .until(hasId('end'))
    .path()
    .by('name')
    .limit(1)

// All paths up to length N
g.V('start')
    .repeat(out().simplePath())
    .until(hasId('end').or().loops().is(5))
    .hasId('end')
    .path()
    .by('name')

// Weighted shortest path (approximate)
g.V('start')
    .repeat(
        outE().as('e')
        .inV()
        .simplePath()
    )
    .until(hasId('end'))
    .path()
    .by('name')
    .by('weight')
    .limit(10)
    // Post-process to find minimum weight path
```

### Path Analysis

```csharp
public class PathAnalyzer
{
    private readonly GremlinClient _client;

    public async Task<PathResult> FindShortestPathAsync(string fromId, string toId, int maxDepth = 6)
    {
        var query = $@"
            g.V('{fromId}')
                .repeat(out().simplePath())
                .until(hasId('{toId}').or().loops().is({maxDepth}))
                .hasId('{toId}')
                .path()
                .by(project('id', 'name').by(id()).by('name'))
                .limit(1)";

        var results = await _client.SubmitAsync<dynamic>(query);
        var path = results.FirstOrDefault();

        if (path == null)
            return new PathResult { Found = false };

        var nodes = ((IEnumerable<dynamic>)path["objects"]).ToList();

        return new PathResult
        {
            Found = true,
            Length = nodes.Count - 1,
            Nodes = nodes.Select(n => new PathNode
            {
                Id = n["id"],
                Name = n["name"]
            }).ToList()
        };
    }

    public async Task<List<PathResult>> FindAllPathsAsync(string fromId, string toId, int maxDepth = 4)
    {
        var query = $@"
            g.V('{fromId}')
                .repeat(out().simplePath())
                .until(hasId('{toId}').or().loops().is({maxDepth}))
                .hasId('{toId}')
                .path()
                .by('name')";

        var results = await _client.SubmitAsync<dynamic>(query);

        return results.Select(path =>
        {
            var nodes = ((IEnumerable<dynamic>)path["objects"]).ToList();
            return new PathResult
            {
                Found = true,
                Length = nodes.Count - 1,
                Nodes = nodes.Select(n => new PathNode { Name = n.ToString() }).ToList()
            };
        }).ToList();
    }
}

public class PathResult
{
    public bool Found { get; set; }
    public int Length { get; set; }
    public List<PathNode> Nodes { get; set; }
}

public class PathNode
{
    public string Id { get; set; }
    public string Name { get; set; }
}
```

## Pattern 3: Subgraph Extraction

Extract relevant portions of the graph for analysis or visualization.

```groovy
// Extract subgraph around a vertex
g.V('center')
    .repeat(both().simplePath())
    .times(2)
    .path()
    .by(elementMap())

// Extract with specific edge types
g.V('user-1')
    .union(
        identity(),
        out('follows'),
        out('follows').out('follows')
    )
    .dedup()
    .project('vertices', 'edges')
    .by(fold())
    .by(
        unfold()
        .outE('follows')
        .where(inV().within(__.V('user-1').union(identity(), out('follows'), out('follows').out('follows')).fold()))
        .fold()
    )
```

### Subgraph Builder

```csharp
public class SubgraphBuilder
{
    private readonly GremlinClient _client;

    public async Task<Subgraph> ExtractSubgraphAsync(string centerId, int radius)
    {
        // Get vertices
        var verticesQuery = $@"
            g.V('{centerId}')
                .repeat(both().simplePath())
                .emit()
                .times({radius})
                .dedup()
                .union(identity(), g.V('{centerId}'))
                .project('id', 'label', 'properties')
                .by(id())
                .by(label())
                .by(valueMap())";

        var vertices = await _client.SubmitAsync<dynamic>(verticesQuery);

        // Get edges
        var edgesQuery = $@"
            g.V('{centerId}')
                .repeat(both().simplePath())
                .emit()
                .times({radius})
                .dedup()
                .union(identity(), g.V('{centerId}'))
                .aggregate('verts')
                .bothE()
                .where(otherV().where(within('verts')))
                .dedup()
                .project('id', 'label', 'source', 'target')
                .by(id())
                .by(label())
                .by(outV().id())
                .by(inV().id())";

        var edges = await _client.SubmitAsync<dynamic>(edgesQuery);

        return new Subgraph
        {
            Vertices = vertices.Select(v => new SubgraphVertex
            {
                Id = v["id"],
                Label = v["label"],
                Properties = v["properties"]
            }).ToList(),
            Edges = edges.Select(e => new SubgraphEdge
            {
                Id = e["id"],
                Label = e["label"],
                SourceId = e["source"],
                TargetId = e["target"]
            }).ToList()
        };
    }
}

public class Subgraph
{
    public List<SubgraphVertex> Vertices { get; set; }
    public List<SubgraphEdge> Edges { get; set; }
}

public class SubgraphVertex
{
    public string Id { get; set; }
    public string Label { get; set; }
    public dynamic Properties { get; set; }
}

public class SubgraphEdge
{
    public string Id { get; set; }
    public string Label { get; set; }
    public string SourceId { get; set; }
    public string TargetId { get; set; }
}
```

## Pattern 4: Aggregation and Statistics

Calculate metrics across the graph structure.

```groovy
// Degree distribution
g.V().hasLabel('person')
    .project('name', 'outDegree', 'inDegree', 'totalDegree')
    .by('name')
    .by(out().count())
    .by(in().count())
    .by(both().count())

// Clustering coefficient approximation
g.V('user-1').as('v')
    .out('follows').as('n')
    .out('follows')
    .where(within(g.V('user-1').out('follows').fold()))
    .count()

// Average path length sample
g.V().hasLabel('person').limit(100).as('start')
    .V().hasLabel('person').where(neq('start')).limit(100).as('end')
    .select('start')
    .repeat(out().simplePath())
    .until(where(eq('end')).or().loops().is(10))
    .where(eq('end'))
    .path()
    .count(local)
    .mean()
```

### Statistics Calculator

```csharp
public class GraphStatistics
{
    private readonly GremlinClient _client;

    public async Task<GraphStats> CalculateStatsAsync()
    {
        var stats = new GraphStats();

        // Vertex count by label
        var vertexCountQuery = @"
            g.V().groupCount().by(label())";
        var vertexCounts = await _client.SubmitAsync<Dictionary<string, long>>(vertexCountQuery);
        stats.VertexCounts = vertexCounts.FirstOrDefault() ?? new Dictionary<string, long>();

        // Edge count by label
        var edgeCountQuery = @"
            g.E().groupCount().by(label())";
        var edgeCounts = await _client.SubmitAsync<Dictionary<string, long>>(edgeCountQuery);
        stats.EdgeCounts = edgeCounts.FirstOrDefault() ?? new Dictionary<string, long>();

        // Degree statistics
        var degreeQuery = @"
            g.V().hasLabel('person')
                .project('out', 'in')
                .by(out().count())
                .by(in().count())
                .fold()
                .project('avgOutDegree', 'avgInDegree', 'maxOutDegree', 'maxInDegree')
                .by(unfold().select('out').mean())
                .by(unfold().select('in').mean())
                .by(unfold().select('out').max())
                .by(unfold().select('in').max())";

        var degreeStats = await _client.SubmitAsync<dynamic>(degreeQuery);
        var ds = degreeStats.FirstOrDefault();

        if (ds != null)
        {
            stats.AverageOutDegree = ds["avgOutDegree"];
            stats.AverageInDegree = ds["avgInDegree"];
            stats.MaxOutDegree = ds["maxOutDegree"];
            stats.MaxInDegree = ds["maxInDegree"];
        }

        return stats;
    }
}

public class GraphStats
{
    public Dictionary<string, long> VertexCounts { get; set; }
    public Dictionary<string, long> EdgeCounts { get; set; }
    public double AverageOutDegree { get; set; }
    public double AverageInDegree { get; set; }
    public long MaxOutDegree { get; set; }
    public long MaxInDegree { get; set; }
}
```

## Pattern 5: Temporal Traversals

Working with time-based graph data.

```groovy
// Events in time range
g.V('user-1')
    .outE('purchased')
    .has('timestamp', between(datetime('2022-01-01'), datetime('2022-12-31')))
    .order().by('timestamp', desc)
    .inV()
    .values('name')

// Activity timeline
g.V('user-1')
    .outE()
    .has('timestamp', gte(datetime('2022-09-01')))
    .project('action', 'target', 'time')
    .by(label())
    .by(inV().values('name'))
    .by('timestamp')
    .order()
    .by(select('time'), desc)
```

These traversal patterns form the foundation for building sophisticated graph-based applications on Azure Cosmos DB.
