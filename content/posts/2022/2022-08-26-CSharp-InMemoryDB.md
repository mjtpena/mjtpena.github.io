---
title: "In Memory SQLite database on C#"
author: MJ Peña
draft: false
url: /blog/csharp-inmemory-sqlite/
tags:
  - csharp
  - SQLite
  - dotnet
  - Memory
---

If you're running a .NET application that doesn't require a database, one of the options that you can use is having `In Memory Database`. What this means is that you are using the machine's RAM to store data for your application.

There are multiple ways of implemeting these:

- Plain C# object / list / dictionary / hash table
- Dependency Injection with proper lifetime (singleton/trancient/scoped)
- Using SQLite

## Why use it?

- If you need a temporary place to store your data. This is often used when the machine is offline.
- An efficient (cheap and fast) way of retrieving small data within a short lifecycle such as configurations and logs.
- The machine is capable enough to handle the storage size. As of right now, RAM is relatively cheap compared to latency (network) costs.

## When not to use it?

- If you need to store the data for future use. When the machine restarts, or when the application closes, all of your data will be flushed.
- If you need to centrally store it so that other applications can consume it.
- This is not meant to store large number of data set.

## Sample Application in SQLite

One of the advantages of using SQLite is the ability to treat the data store just like a SQL database. You can perform simple T-SQL query statements and even use Entity Framework.

```csharp

using Microsoft.Data.Sqlite;

const string connectionString = "Data Source=InMemorySample;Mode=Memory;Cache=Shared";

var masterConnection = new SqliteConnection(connectionString);
masterConnection.Open();

var createCommand = masterConnection.CreateCommand();
createCommand.CommandText =
@"
                CREATE TABLE data (
                    value TEXT
                )
            ";
createCommand.ExecuteNonQuery();

using (var firstConnection = new SqliteConnection(connectionString))
{
    firstConnection.Open();

    var updateCommand = firstConnection.CreateCommand();
    updateCommand.CommandText =
    @"
                    INSERT INTO data
                    VALUES ('Hello, memory!')
                ";
    updateCommand.ExecuteNonQuery();
}

using (var secondConnection = new SqliteConnection(connectionString))
{
    secondConnection.Open();
    var queryCommand = secondConnection.CreateCommand();
    queryCommand.CommandText =
    @"
                    SELECT *
                    FROM data
                ";
    var value = (string)queryCommand.ExecuteScalar();
    Console.WriteLine(value);
}

// After all the connections are closed, the database is deleted.
masterConnection.Close();

```

The most important bits:

- Reference the `Microsoft.Data.Sqlite` nuget package.
- In the connection string, add the following `Mode=Memory;Cache=Shared`

---

References:
[InMemory Database Provider - EF Core | Microsoft Docs](https://docs.microsoft.com/en-us/ef/core/providers/in-memory/?tabs=dotnet-core-cli)
[In-memory databases - Microsoft.Data.Sqlite | Microsoft Docs](https://docs.microsoft.com/en-us/dotnet/standard/data/sqlite/in-memory-databases)
[docs/Program.cs at main · dotnet/docs (github.com)](https://github.com/dotnet/docs/blob/main/samples/snippets/standard/data/sqlite/InMemorySample/Program.cs)
