---
title: "Azure Cosmos DB for Apache Cassandra"
author: "Michael John Peña"
draft: false
date: 2022-09-07
tags: ["Azure", "Cosmos DB", "Cassandra", "NoSQL", "Wide Column"]

---

I wrote "Azure Cosmos DB for Apache Cassandra" to share practical, production-minded guidance on this topic.

## Getting Started with Cassandra API

### Connection Setup

```csharp
using Cassandra;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;

public class CassandraConnection
{
    private readonly ICluster _cluster;
    private readonly ISession _session;

    public CassandraConnection(string contactPoint, string username, string password)
    {
        var options = new SSLOptions(SslProtocols.Tls12, true, ValidateServerCertificate);
        options.SetHostNameResolver((ipAddress) => contactPoint);

        _cluster = Cluster.Builder()
            .WithCredentials(username, password)
            .WithPort(10350)
            .AddContactPoint(contactPoint)
            .WithSSL(options)
            .WithLoadBalancingPolicy(new TokenAwarePolicy(new DCAwareRoundRobinPolicy()))
            .WithReconnectionPolicy(new ExponentialReconnectionPolicy(1000, 60000))
            .Build();

        _session = _cluster.Connect();
    }

    private static bool ValidateServerCertificate(
        object sender,
        X509Certificate certificate,
        X509Chain chain,
        SslPolicyErrors sslPolicyErrors)
    {
        return sslPolicyErrors == SslPolicyErrors.None;
    }

    public ISession GetSession() => _session;

    public void Dispose()
    {
        _session?.Dispose();
        _cluster?.Dispose();
    }
}
```

### Creating Keyspace and Tables

```csharp
public class SchemaManager
{
    private readonly ISession _session;

    public SchemaManager(ISession session)
    {
        _session = session;
    }

    public void CreateKeyspace(string keyspaceName)
    {
        var cql = $@"
            CREATE KEYSPACE IF NOT EXISTS {keyspaceName}
            WITH replication = {{'class': 'SimpleStrategy', 'replication_factor': 1}}";

        _session.Execute(cql);
        Console.WriteLine($"Keyspace '{keyspaceName}' created successfully");
    }

    public void CreateUserTable(string keyspace)
    {
        var cql = $@"
            CREATE TABLE IF NOT EXISTS {keyspace}.users (
                user_id UUID PRIMARY KEY,
                email TEXT,
                first_name TEXT,
                last_name TEXT,
                created_at TIMESTAMP,
                profile MAP<TEXT, TEXT>
            )";

        _session.Execute(cql);
        Console.WriteLine("Users table created successfully");
    }

    public void CreateTimeSeriesTable(string keyspace)
    {
        var cql = $@"
            CREATE TABLE IF NOT EXISTS {keyspace}.sensor_readings (
                device_id UUID,
                reading_time TIMESTAMP,
                temperature DOUBLE,
                humidity DOUBLE,
                pressure DOUBLE,
                PRIMARY KEY ((device_id), reading_time)
            ) WITH CLUSTERING ORDER BY (reading_time DESC)";

        _session.Execute(cql);
        Console.WriteLine("Sensor readings table created successfully");
    }

    public void CreateOrdersTable(string keyspace)
    {
        var cql = $@"
            CREATE TABLE IF NOT EXISTS {keyspace}.orders_by_customer (
                customer_id UUID,
                order_date DATE,
                order_id UUID,
                total_amount DECIMAL,
                status TEXT,
                items LIST<FROZEN<order_item>>,
                PRIMARY KEY ((customer_id), order_date, order_id)
            ) WITH CLUSTERING ORDER BY (order_date DESC, order_id ASC)";

        // First create the UDT
        var udtCql = $@"
            CREATE TYPE IF NOT EXISTS {keyspace}.order_item (
                product_id UUID,
                product_name TEXT,
                quantity INT,
                unit_price DECIMAL
            )";

        _session.Execute(udtCql);
        _session.Execute(cql);
        Console.WriteLine("Orders table created successfully");
    }
}
```

### CRUD Operations

```csharp
public class UserRepository
{
    private readonly ISession _session;
    private readonly PreparedStatement _insertUser;
    private readonly PreparedStatement _getUserById;
    private readonly PreparedStatement _updateUser;
    private readonly PreparedStatement _deleteUser;

    public UserRepository(ISession session, string keyspace)
    {
        _session = session;

        _insertUser = _session.Prepare($@"
            INSERT INTO {keyspace}.users
            (user_id, email, first_name, last_name, created_at, profile)
            VALUES (?, ?, ?, ?, ?, ?)");

        _getUserById = _session.Prepare($@"
            SELECT * FROM {keyspace}.users WHERE user_id = ?");

        _updateUser = _session.Prepare($@"
            UPDATE {keyspace}.users
            SET first_name = ?, last_name = ?, profile = ?
            WHERE user_id = ?");

        _deleteUser = _session.Prepare($@"
            DELETE FROM {keyspace}.users WHERE user_id = ?");
    }

    public async Task<Guid> CreateUserAsync(User user)
    {
        var userId = Guid.NewGuid();

        var statement = _insertUser.Bind(
            userId,
            user.Email,
            user.FirstName,
            user.LastName,
            DateTime.UtcNow,
            user.Profile);

        await _session.ExecuteAsync(statement);
        return userId;
    }

    public async Task<User> GetUserByIdAsync(Guid userId)
    {
        var statement = _getUserById.Bind(userId);
        var result = await _session.ExecuteAsync(statement);
        var row = result.FirstOrDefault();

        if (row == null) return null;

        return new User
        {
            UserId = row.GetValue<Guid>("user_id"),
            Email = row.GetValue<string>("email"),
            FirstName = row.GetValue<string>("first_name"),
            LastName = row.GetValue<string>("last_name"),
            CreatedAt = row.GetValue<DateTime>("created_at"),
            Profile = row.GetValue<IDictionary<string, string>>("profile")
        };
    }

    public async Task UpdateUserAsync(User user)
    {
        var statement = _updateUser.Bind(
            user.FirstName,
            user.LastName,
            user.Profile,
            user.UserId);

        await _session.ExecuteAsync(statement);
    }

    public async Task DeleteUserAsync(Guid userId)
    {
        var statement = _deleteUser.Bind(userId);
        await _session.ExecuteAsync(statement);
    }
}

public class User
{
    public Guid UserId { get; set; }
    public string Email { get; set; }
    public string FirstName { get; set; }
    public string LastName { get; set; }
    public DateTime CreatedAt { get; set; }
    public IDictionary<string, string> Profile { get; set; }
}
```

### Time Series Data Operations

```csharp
public class SensorDataRepository
{
    private readonly ISession _session;
    private readonly string _keyspace;

    public SensorDataRepository(ISession session, string keyspace)
    {
        _session = session;
        _keyspace = keyspace;
    }

    public async Task InsertReadingAsync(SensorReading reading)
    {
        var cql = $@"
            INSERT INTO {_keyspace}.sensor_readings
            (device_id, reading_time, temperature, humidity, pressure)
            VALUES (?, ?, ?, ?, ?)";

        var statement = new SimpleStatement(cql,
            reading.DeviceId,
            reading.ReadingTime,
            reading.Temperature,
            reading.Humidity,
            reading.Pressure);

        await _session.ExecuteAsync(statement);
    }

    public async Task BatchInsertReadingsAsync(IEnumerable<SensorReading> readings)
    {
        var batch = new BatchStatement();

        foreach (var reading in readings)
        {
            var cql = $@"
                INSERT INTO {_keyspace}.sensor_readings
                (device_id, reading_time, temperature, humidity, pressure)
                VALUES (?, ?, ?, ?, ?)";

            batch.Add(new SimpleStatement(cql,
                reading.DeviceId,
                reading.ReadingTime,
                reading.Temperature,
                reading.Humidity,
                reading.Pressure));
        }

        await _session.ExecuteAsync(batch);
    }

    public async Task<List<SensorReading>> GetReadingsAsync(
        Guid deviceId,
        DateTime startTime,
        DateTime endTime,
        int limit = 1000)
    {
        var cql = $@"
            SELECT * FROM {_keyspace}.sensor_readings
            WHERE device_id = ? AND reading_time >= ? AND reading_time <= ?
            LIMIT ?";

        var statement = new SimpleStatement(cql, deviceId, startTime, endTime, limit);
        var result = await _session.ExecuteAsync(statement);

        return result.Select(row => new SensorReading
        {
            DeviceId = row.GetValue<Guid>("device_id"),
            ReadingTime = row.GetValue<DateTime>("reading_time"),
            Temperature = row.GetValue<double>("temperature"),
            Humidity = row.GetValue<double>("humidity"),
            Pressure = row.GetValue<double>("pressure")
        }).ToList();
    }
}

public class SensorReading
{
    public Guid DeviceId { get; set; }
    public DateTime ReadingTime { get; set; }
    public double Temperature { get; set; }
    public double Humidity { get; set; }
    public double Pressure { get; set; }
}
```

### Python Client Example

```python
from cassandra.cluster import Cluster
from cassandra.auth import PlainTextAuthProvider
from ssl import SSLContext, PROTOCOL_TLS_CLIENT, CERT_REQUIRED
import uuid
from datetime import datetime

class CosmosDBCassandra:
    def __init__(self, contact_point, username, password):
        ssl_context = SSLContext(PROTOCOL_TLS_CLIENT)
        ssl_context.verify_mode = CERT_REQUIRED
        ssl_context.load_default_certs()

        auth_provider = PlainTextAuthProvider(username, password)

        self.cluster = Cluster(
            [contact_point],
            port=10350,
            auth_provider=auth_provider,
            ssl_context=ssl_context
        )
        self.session = self.cluster.connect()

    def create_keyspace(self, keyspace_name):
        self.session.execute(f"""
            CREATE KEYSPACE IF NOT EXISTS {keyspace_name}
            WITH replication = {{'class': 'SimpleStrategy', 'replication_factor': 1}}
        """)
        self.session.set_keyspace(keyspace_name)

    def insert_user(self, email, first_name, last_name):
        user_id = uuid.uuid4()
        self.session.execute("""
            INSERT INTO users (user_id, email, first_name, last_name, created_at)
            VALUES (%s, %s, %s, %s, %s)
        """, (user_id, email, first_name, last_name, datetime.utcnow()))
        return user_id

    def get_user(self, user_id):
        result = self.session.execute(
            "SELECT * FROM users WHERE user_id = %s", (user_id,))
        return result.one()

    def close(self):
        self.cluster.shutdown()


# Usage
if __name__ == '__main__':
    db = CosmosDBCassandra(
        'myaccount.cassandra.cosmos.azure.com',
        'myaccount',
        'mypassword'
    )

    db.create_keyspace('myapp')
    user_id = db.insert_user('john@example.com', 'John', 'Doe')
    user = db.get_user(user_id)
    print(f"User: {user.first_name} {user.last_name}")

    db.close()
```

## Key Features

1. **Wire protocol compatibility** - Use existing Cassandra drivers
2. **Global distribution** - Multi-region writes and reads
3. **Automatic indexing** - Secondary indexes for flexible queries
4. **Tunable consistency** - Five consistency levels available
5. **Serverless option** - Pay only for what you use

Azure Cosmos DB for Apache Cassandra bridges the gap between familiar Cassandra development and cloud-native scalability.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
