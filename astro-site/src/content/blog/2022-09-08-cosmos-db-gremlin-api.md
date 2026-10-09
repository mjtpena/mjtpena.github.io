---
title: "Azure Cosmos DB for Apache Gremlin"
description: "Graph databases excel at representing relationships between entities. Unlike relational databases where joins can become expensive, graph databases traverse…"
author: "Michael John Peña"
draft: false
date: 2022-09-08
tags: ["Azure", "Cosmos DB", "Gremlin", "Graph Database", "NoSQL"]
---

## Introduction to Graph Databases

Graph databases excel at representing relationships between entities. Unlike relational databases where joins can become expensive, graph databases traverse relationships efficiently.

### Setting Up the Gremlin Client

```csharp
using Gremlin.Net.Driver;
using Gremlin.Net.Driver.Remote;
using Gremlin.Net.Structure.IO.GraphSON;

public class GremlinConnectionManager
{
    private readonly GremlinServer _gremlinServer;
    private readonly GremlinClient _gremlinClient;

    public GremlinConnectionManager(string hostname, string database, string container, string primaryKey)
    {
        var containerLink = $"/dbs/{database}/colls/{container}";

        _gremlinServer = new GremlinServer(
            hostname,
            443,
            enableSsl: true,
            username: containerLink,
            password: primaryKey);

        var connectionPoolSettings = new ConnectionPoolSettings
        {
            MaxInProcessPerConnection = 10,
            PoolSize = 30,
            ReconnectionAttempts = 3,
            ReconnectionBaseDelay = TimeSpan.FromMilliseconds(500)
        };

        _gremlinClient = new GremlinClient(
            _gremlinServer,
            new GraphSON2MessageSerializer(),
            connectionPoolSettings);
    }

    public async Task<ResultSet<dynamic>> ExecuteQueryAsync(string query)
    {
        return await _gremlinClient.SubmitAsync<dynamic>(query);
    }

    public void Dispose()
    {
        _gremlinClient?.Dispose();
    }
}
```

### Creating Vertices and Edges

```csharp
public class GraphOperations
{
    private readonly GremlinClient _client;

    public GraphOperations(GremlinClient client)
    {
        _client = client;
    }

    public async Task CreatePersonAsync(string id, string name, int age, string city)
    {
        var query = $@"
            g.addV('person')
                .property('id', '{id}')
                .property('name', '{name}')
                .property('age', {age})
                .property('city', '{city}')
                .property('pk', '{city}')";

        await _client.SubmitAsync<dynamic>(query);
        Console.WriteLine($"Created person: {name}");
    }

    public async Task CreateCompanyAsync(string id, string name, string industry)
    {
        var query = $@"
            g.addV('company')
                .property('id', '{id}')
                .property('name', '{name}')
                .property('industry', '{industry}')
                .property('pk', '{industry}')";

        await _client.SubmitAsync<dynamic>(query);
        Console.WriteLine($"Created company: {name}");
    }

    public async Task CreateRelationshipAsync(
        string fromId,
        string toId,
        string edgeLabel,
        Dictionary<string, object> properties = null)
    {
        var propsString = "";
        if (properties != null)
        {
            foreach (var prop in properties)
            {
                propsString += $".property('{prop.Key}', '{prop.Value}')";
            }
        }

        var query = $@"
            g.V('{fromId}')
                .addE('{edgeLabel}')
                .to(g.V('{toId}'))
                {propsString}";

        await _client.SubmitAsync<dynamic>(query);
        Console.WriteLine($"Created edge: {fromId} --[{edgeLabel}]--> {toId}");
    }

    // Build a social network
    public async Task BuildSocialNetworkAsync()
    {
        // Create people
        await CreatePersonAsync("alice", "Alice Smith", 30, "Seattle");
        await CreatePersonAsync("bob", "Bob Johnson", 35, "Portland");
        await CreatePersonAsync("charlie", "Charlie Brown", 28, "Seattle");
        await CreatePersonAsync("diana", "Diana Ross", 32, "San Francisco");

        // Create companies
        await CreateCompanyAsync("techcorp", "TechCorp", "Technology");
        await CreateCompanyAsync("datasoft", "DataSoft", "Technology");

        // Create relationships
        await CreateRelationshipAsync("alice", "bob", "knows",
            new Dictionary<string, object> { { "since", "2020" } });
        await CreateRelationshipAsync("alice", "charlie", "knows");
        await CreateRelationshipAsync("bob", "diana", "knows");
        await CreateRelationshipAsync("charlie", "diana", "knows");

        // Employment relationships
        await CreateRelationshipAsync("alice", "techcorp", "works_at",
            new Dictionary<string, object> { { "role", "Engineer" }, { "since", "2019" } });
        await CreateRelationshipAsync("bob", "techcorp", "works_at",
            new Dictionary<string, object> { { "role", "Manager" } });
        await CreateRelationshipAsync("charlie", "datasoft", "works_at");
        await CreateRelationshipAsync("diana", "datasoft", "works_at",
            new Dictionary<string, object> { { "role", "Director" } });
    }
}
```

### Querying the Graph

```csharp
public class GraphQueries
{
    private readonly GremlinClient _client;

    public GraphQueries(GremlinClient client)
    {
        _client = client;
    }

    // Find all friends of a person
    public async Task<List<string>> GetFriendsAsync(string personId)
    {
        var query = $@"
            g.V('{personId}')
                .out('knows')
                .values('name')";

        var result = await _client.SubmitAsync<string>(query);
        return result.ToList();
    }

    // Find friends of friends
    public async Task<List<string>> GetFriendsOfFriendsAsync(string personId)
    {
        var query = $@"
            g.V('{personId}')
                .out('knows')
                .out('knows')
                .where(neq('{personId}'))
                .dedup()
                .values('name')";

        var result = await _client.SubmitAsync<string>(query);
        return result.ToList();
    }

    // Find shortest path between two people
    public async Task<dynamic> GetShortestPathAsync(string fromId, string toId)
    {
        var query = $@"
            g.V('{fromId}')
                .repeat(out('knows').simplePath())
                .until(hasId('{toId}'))
                .path()
                .limit(1)";

        var result = await _client.SubmitAsync<dynamic>(query);
        return result.FirstOrDefault();
    }

    // Find people who work at the same company
    public async Task<List<string>> GetColleaguesAsync(string personId)
    {
        var query = $@"
            g.V('{personId}')
                .out('works_at')
                .in('works_at')
                .where(neq('{personId}'))
                .values('name')";

        var result = await _client.SubmitAsync<string>(query);
        return result.ToList();
    }

    // Count connections by type
    public async Task<Dictionary<string, long>> GetConnectionStatsAsync(string personId)
    {
        var query = $@"
            g.V('{personId}')
                .outE()
                .groupCount()
                .by(label)";

        var result = await _client.SubmitAsync<Dictionary<string, long>>(query);
        return result.FirstOrDefault() ?? new Dictionary<string, long>();
    }

    // Find most connected people
    public async Task<List<dynamic>> GetMostConnectedPeopleAsync(int limit = 10)
    {
        var query = $@"
            g.V()
                .hasLabel('person')
                .project('name', 'connections')
                .by('name')
                .by(both('knows').count())
                .order()
                .by(select('connections'), desc)
                .limit({limit})";

        var result = await _client.SubmitAsync<dynamic>(query);
        return result.ToList();
    }
}
```

### Python Gremlin Client

```python
from gremlin_python.driver import client, serializer
from gremlin_python.driver.protocol import GremlinServerError
import asyncio

class GremlinGraph:
    def __init__(self, endpoint, database, container, primary_key):
        self.client = client.Client(
            f'wss://{endpoint}:443/',
            'g',
            username=f'/dbs/{database}/colls/{container}',
            password=primary_key,
            message_serializer=serializer.GraphSONSerializersV2d0()
        )

    def execute(self, query):
        try:
            callback = self.client.submitAsync(query)
            result = callback.result()
            return result.all().result()
        except GremlinServerError as e:
            print(f'Query error: {e}')
            return None

    def add_vertex(self, label, vertex_id, pk, properties):
        props = ''.join([f".property('{k}', '{v}')" for k, v in properties.items()])
        query = f"g.addV('{label}').property('id', '{vertex_id}').property('pk', '{pk}'){props}"
        return self.execute(query)

    def add_edge(self, from_id, to_id, label, properties=None):
        props = ''
        if properties:
            props = ''.join([f".property('{k}', '{v}')" for k, v in properties.items()])
        query = f"g.V('{from_id}').addE('{label}').to(g.V('{to_id}')){props}"
        return self.execute(query)

    def find_path(self, from_id, to_id):
        query = f"""
            g.V('{from_id}')
             .repeat(both().simplePath())
             .until(hasId('{to_id}'))
             .path()
             .by('name')
             .limit(5)
        """
        return self.execute(query)

    def get_recommendations(self, user_id, limit=5):
        """Find people the user might know based on mutual connections"""
        query = f"""
            g.V('{user_id}')
             .as('user')
             .out('knows')
             .out('knows')
             .where(neq('user'))
             .where(without(g.V('{user_id}').out('knows').fold()))
             .groupCount()
             .by('name')
             .order(local)
             .by(values, desc)
             .limit(local, {limit})
        """
        return self.execute(query)

    def close(self):
        self.client.close()


# Usage
if __name__ == '__main__':
    graph = GremlinGraph(
        'myaccount.gremlin.cosmos.azure.com',
        'socialdb',
        'people',
        'primary-key'
    )

    # Build graph
    graph.add_vertex('person', 'p1', 'seattle', {'name': 'Alice', 'age': '30'})
    graph.add_vertex('person', 'p2', 'portland', {'name': 'Bob', 'age': '35'})
    graph.add_edge('p1', 'p2', 'knows', {'since': '2020'})

    # Query
    paths = graph.find_path('p1', 'p2')
    print(f'Paths: {paths}')

    graph.close()
```

## Use Cases for Graph Databases

1. **Social networks** - Model friendships and interactions
2. **Recommendation engines** - Find related items or people
3. **Fraud detection** - Identify suspicious connection patterns
4. **Knowledge graphs** - Model complex domain relationships
5. **Network topology** - Map infrastructure dependencies

Azure Cosmos DB for Apache Gremlin provides the scalability and global distribution needed for enterprise graph applications.
