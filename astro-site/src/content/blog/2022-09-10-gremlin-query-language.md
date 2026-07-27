---
title: "Mastering Gremlin Query Language"
author: "Michael John Peña"
draft: false
date: 2022-09-10
tags: ["Azure", "Gremlin", "Graph Database", "Query Language"]

---

I wrote "Mastering Gremlin Query Language" to share practical, production-minded guidance on this topic.

## Gremlin Fundamentals

### Basic Vertex Operations

```groovy
// Create a vertex
g.addV('person')
    .property('id', 'person-1')
    .property('name', 'Alice')
    .property('age', 30)
    .property('pk', 'seattle')

// Read a vertex by ID
g.V('person-1')

// Read with filters
g.V().hasLabel('person').has('name', 'Alice')

// Update a vertex property
g.V('person-1').property('age', 31)

// Delete a vertex (and its edges)
g.V('person-1').drop()
```

### Basic Edge Operations

```groovy
// Create an edge between vertices
g.V('person-1').addE('knows').to(g.V('person-2')).property('since', 2020)

// Read edges from a vertex
g.V('person-1').outE('knows')

// Read the target of edges
g.V('person-1').out('knows')

// Update edge property
g.V('person-1').outE('knows').has('to', 'person-2').property('strength', 'strong')

// Delete an edge
g.V('person-1').outE('knows').where(inV().hasId('person-2')).drop()
```

### Traversal Steps

```groovy
// Outgoing edges and vertices
g.V('person-1').out('knows')           // Get adjacent vertices via 'knows' edges
g.V('person-1').outE('knows')          // Get outgoing 'knows' edges
g.V('person-1').outE().inV()           // Get edges then their target vertices

// Incoming edges and vertices
g.V('person-1').in('knows')            // Get vertices with 'knows' edges to person-1
g.V('person-1').inE('knows')           // Get incoming 'knows' edges
g.V('person-1').inE().outV()           // Get edges then their source vertices

// Both directions
g.V('person-1').both('knows')          // Adjacent vertices in both directions
g.V('person-1').bothE('knows')         // Edges in both directions
```

## Filtering and Predicates

```groovy
// Has step with predicates
g.V().has('age', gt(25))               // Greater than
g.V().has('age', gte(25))              // Greater than or equal
g.V().has('age', lt(40))               // Less than
g.V().has('age', lte(40))              // Less than or equal
g.V().has('age', between(25, 40))      // Between (inclusive start, exclusive end)
g.V().has('age', inside(25, 40))       // Inside range (exclusive both)
g.V().has('age', outside(25, 40))      // Outside range (exclusive both)
g.V().has('age', within(25, 30, 35))   // In list
g.V().has('age', without(25, 30, 35))  // Not in list
g.V().has('name', startingWith('Al'))  // String starts with
g.V().has('name', endingWith('ce'))    // String ends with
g.V().has('name', containing('lic'))   // String contains

// Multiple filters
g.V().hasLabel('person')
    .has('age', gt(25))
    .has('city', 'Seattle')

// Or conditions
g.V().or(
    has('city', 'Seattle'),
    has('city', 'Portland')
)

// And conditions (default behavior, but explicit)
g.V().and(
    has('age', gt(25)),
    has('city', 'Seattle')
)

// Not condition
g.V().hasLabel('person').not(has('verified', true))

// Where with traversals
g.V().hasLabel('person')
    .where(out('knows').count().is(gt(5)))  // People with more than 5 connections
```

## Aggregation and Grouping

```groovy
// Count
g.V().hasLabel('person').count()

// Group by property
g.V().hasLabel('person')
    .group()
    .by('city')
    .by(count())

// Group with value aggregation
g.V().hasLabel('person')
    .group()
    .by('city')
    .by(values('age').mean())

// Multiple aggregations
g.V().hasLabel('person')
    .group()
    .by('city')
    .by(
        fold()
        .project('count', 'avgAge', 'names')
        .by(count(local))
        .by(unfold().values('age').mean())
        .by(unfold().values('name').fold())
    )

// Sum, min, max, mean
g.V().hasLabel('order').values('total').sum()
g.V().hasLabel('order').values('total').min()
g.V().hasLabel('order').values('total').max()
g.V().hasLabel('order').values('total').mean()
```

## Path Traversals

```groovy
// Simple path
g.V('person-1')
    .repeat(out('knows'))
    .until(hasId('person-5'))
    .path()

// Path with labels
g.V('person-1')
    .repeat(out('knows'))
    .until(hasId('person-5'))
    .path()
    .by('name')

// Shortest path (limit depth and results)
g.V('person-1')
    .repeat(out('knows').simplePath())
    .until(hasId('person-5').or().loops().is(6))
    .hasId('person-5')
    .path()
    .by('name')
    .limit(1)

// All paths up to depth N
g.V('person-1')
    .repeat(out('knows').simplePath())
    .times(3)
    .path()
    .by('name')
```

## Projection and Transformation

```groovy
// Project to custom shape
g.V().hasLabel('person')
    .project('name', 'age', 'friendCount', 'company')
    .by('name')
    .by('age')
    .by(out('knows').count())
    .by(out('works_at').values('name').fold())

// Select labeled steps
g.V('person-1').as('source')
    .out('knows').as('friend')
    .out('knows').as('fof')
    .select('source', 'friend', 'fof')
    .by('name')

// Coalesce for default values
g.V('person-1')
    .project('name', 'nickname')
    .by('name')
    .by(coalesce(values('nickname'), constant('N/A')))

// Map transformation
g.V().hasLabel('person')
    .map(
        project('fullName', 'location')
        .by(values('firstName', 'lastName').fold())
        .by('city')
    )
```

## Advanced Patterns

```groovy
// Recommendation: Products bought by similar users
g.V('user-1')
    .out('purchased').as('owned')
    .in('purchased')
    .where(neq('user-1'))
    .out('purchased')
    .where(without('owned'))
    .groupCount()
    .by('name')
    .order(local)
    .by(values, desc)
    .limit(local, 10)

// Mutual friends
g.V('person-1').as('p1')
    .out('knows').as('mutual')
    .in('knows')
    .hasId('person-2')
    .select('mutual')
    .values('name')

// Influence score (followers of followers)
g.V('person-1')
    .project('direct', 'secondary', 'tertiary')
    .by(in('follows').count())
    .by(in('follows').in('follows').dedup().count())
    .by(repeat(in('follows')).times(3).dedup().count())

// Community detection (shared connections)
g.V('person-1').as('start')
    .out('knows').aggregate('friends')
    .out('knows')
    .where(within('friends'))
    .path()
    .by('name')

// Cycle detection
g.V().hasLabel('person')
    .as('start')
    .repeat(out('knows').simplePath())
    .until(where(eq('start')).or().loops().is(5))
    .where(eq('start'))
    .path()
    .by('name')
```

## C# Gremlin Examples

```csharp
public class GremlinQueryBuilder
{
    private readonly StringBuilder _query = new();

    public GremlinQueryBuilder V(string id = null)
    {
        _query.Append(id != null ? $"g.V('{id}')" : "g.V()");
        return this;
    }

    public GremlinQueryBuilder HasLabel(string label)
    {
        _query.Append($".hasLabel('{label}')");
        return this;
    }

    public GremlinQueryBuilder Has(string property, object value)
    {
        var valueStr = value is string ? $"'{value}'" : value.ToString();
        _query.Append($".has('{property}', {valueStr})");
        return this;
    }

    public GremlinQueryBuilder Out(string edge = null)
    {
        _query.Append(edge != null ? $".out('{edge}')" : ".out()");
        return this;
    }

    public GremlinQueryBuilder In(string edge = null)
    {
        _query.Append(edge != null ? $".in('{edge}')" : ".in()");
        return this;
    }

    public GremlinQueryBuilder Values(params string[] properties)
    {
        var props = string.Join("', '", properties);
        _query.Append($".values('{props}')");
        return this;
    }

    public GremlinQueryBuilder Project(params string[] fields)
    {
        var fieldList = string.Join("', '", fields);
        _query.Append($".project('{fieldList}')");
        return this;
    }

    public GremlinQueryBuilder By(string property)
    {
        _query.Append($".by('{property}')");
        return this;
    }

    public GremlinQueryBuilder ByTraversal(string traversal)
    {
        _query.Append($".by({traversal})");
        return this;
    }

    public GremlinQueryBuilder Count()
    {
        _query.Append(".count()");
        return this;
    }

    public GremlinQueryBuilder Limit(int n)
    {
        _query.Append($".limit({n})");
        return this;
    }

    public string Build() => _query.ToString();
}

// Usage
var query = new GremlinQueryBuilder()
    .V()
    .HasLabel("person")
    .Has("city", "Seattle")
    .Out("knows")
    .Project("name", "connections")
    .By("name")
    .ByTraversal("out('knows').count()")
    .Limit(10)
    .Build();

// Result: g.V().hasLabel('person').has('city', 'Seattle').out('knows').project('name', 'connections').by('name').by(out('knows').count()).limit(10)
```

## Best Practices

1. **Use simplePath()** - Prevents cycles in traversals
2. **Set limits** - Always limit unbounded queries
3. **Filter early** - Apply filters as early as possible
4. **Use indexes** - Create indexes for filtered properties
5. **Project only needed data** - Reduce data transfer

Mastering Gremlin opens up powerful graph analytics capabilities in Azure Cosmos DB.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
