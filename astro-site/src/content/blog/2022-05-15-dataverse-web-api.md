---
title: "Dataverse Web API: Building Enterprise Data Solutions"
author: Michael John Peña
draft: false
date: 2022-05-15
tags:
  - dataverse
  - power-platform
  - API
  - dynamics-365
---

## Understanding Dataverse

Dataverse offers:
- Relational data storage
- Built-in security model
- Business logic capabilities
- Integration with Power Platform

## Authentication Setup

Configure authentication for Dataverse:

```csharp
using Azure.Identity;
using System.Net.Http.Headers;

public class DataverseClient
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public DataverseClient(string environmentUrl)
    {
        _baseUrl = $"{environmentUrl}/api/data/v9.2/";

        var credential = new DefaultAzureCredential();
        var token = credential.GetToken(
            new Azure.Core.TokenRequestContext(
                new[] { $"{environmentUrl}/.default" }));

        _httpClient = new HttpClient();
        _httpClient.BaseAddress = new Uri(_baseUrl);
        _httpClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token.Token);
        _httpClient.DefaultRequestHeaders.Add("OData-MaxVersion", "4.0");
        _httpClient.DefaultRequestHeaders.Add("OData-Version", "4.0");
        _httpClient.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));
    }
}
```

## CRUD Operations

Perform basic data operations:

```csharp
public class AccountService
{
    private readonly HttpClient _client;

    public AccountService(HttpClient client)
    {
        _client = client;
    }

    // Create
    public async Task<Guid> CreateAccountAsync(Account account)
    {
        var json = JsonSerializer.Serialize(new
        {
            name = account.Name,
            telephone1 = account.Phone,
            emailaddress1 = account.Email,
            address1_city = account.City,
            revenue = account.Revenue,
            industrycode = account.IndustryCode
        });

        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("accounts", content);

        response.EnsureSuccessStatusCode();

        // Get created record ID from header
        var entityUrl = response.Headers.GetValues("OData-EntityId").First();
        var idMatch = Regex.Match(entityUrl, @"\(([^)]+)\)");
        return Guid.Parse(idMatch.Groups[1].Value);
    }

    // Read single
    public async Task<Account?> GetAccountAsync(Guid accountId)
    {
        var response = await _client.GetAsync(
            $"accounts({accountId})?$select=name,telephone1,emailaddress1,revenue");

        if (response.StatusCode == HttpStatusCode.NotFound)
            return null;

        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<JsonElement>(json);

        return new Account
        {
            Id = accountId,
            Name = data.GetProperty("name").GetString(),
            Phone = data.GetProperty("telephone1").GetString(),
            Email = data.GetProperty("emailaddress1").GetString(),
            Revenue = data.GetProperty("revenue").GetDecimal()
        };
    }

    // Read multiple with filter
    public async Task<List<Account>> GetAccountsAsync(string? nameFilter = null, int top = 50)
    {
        var query = $"accounts?$select=accountid,name,telephone1,emailaddress1,revenue&$top={top}";

        if (!string.IsNullOrEmpty(nameFilter))
        {
            query += $"&$filter=contains(name,'{nameFilter}')";
        }

        query += "&$orderby=name asc";

        var response = await _client.GetAsync(query);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<JsonElement>(json);

        var accounts = new List<Account>();
        foreach (var item in data.GetProperty("value").EnumerateArray())
        {
            accounts.Add(new Account
            {
                Id = Guid.Parse(item.GetProperty("accountid").GetString()!),
                Name = item.GetProperty("name").GetString(),
                Phone = item.TryGetProperty("telephone1", out var phone) ? phone.GetString() : null,
                Email = item.TryGetProperty("emailaddress1", out var email) ? email.GetString() : null,
                Revenue = item.TryGetProperty("revenue", out var rev) ? rev.GetDecimal() : 0
            });
        }

        return accounts;
    }

    // Update
    public async Task UpdateAccountAsync(Guid accountId, Account account)
    {
        var json = JsonSerializer.Serialize(new
        {
            name = account.Name,
            telephone1 = account.Phone,
            emailaddress1 = account.Email,
            revenue = account.Revenue
        });

        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var request = new HttpRequestMessage(HttpMethod.Patch, $"accounts({accountId})")
        {
            Content = content
        };

        var response = await _client.SendAsync(request);
        response.EnsureSuccessStatusCode();
    }

    // Delete
    public async Task DeleteAccountAsync(Guid accountId)
    {
        var response = await _client.DeleteAsync($"accounts({accountId})");
        response.EnsureSuccessStatusCode();
    }
}

public record Account
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string? City { get; init; }
    public decimal Revenue { get; init; }
    public int? IndustryCode { get; init; }
}
```

## Working with Relationships

Handle related records:

```csharp
public class RelationshipService
{
    private readonly HttpClient _client;

    public RelationshipService(HttpClient client)
    {
        _client = client;
    }

    // Create contact with account relationship
    public async Task<Guid> CreateContactWithAccountAsync(Contact contact, Guid accountId)
    {
        var json = JsonSerializer.Serialize(new
        {
            firstname = contact.FirstName,
            lastname = contact.LastName,
            emailaddress1 = contact.Email,
            // Reference to parent account
            @"parentcustomerid_account@odata.bind" = $"/accounts({accountId})"
        });

        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("contacts", content);
        response.EnsureSuccessStatusCode();

        var entityUrl = response.Headers.GetValues("OData-EntityId").First();
        var idMatch = Regex.Match(entityUrl, @"\(([^)]+)\)");
        return Guid.Parse(idMatch.Groups[1].Value);
    }

    // Get account with related contacts
    public async Task<AccountWithContacts> GetAccountWithContactsAsync(Guid accountId)
    {
        var query = $"accounts({accountId})?" +
            "$select=name,telephone1,revenue" +
            "&$expand=contact_customer_accounts($select=contactid,firstname,lastname,emailaddress1)";

        var response = await _client.GetAsync(query);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<JsonElement>(json);

        var account = new AccountWithContacts
        {
            Id = accountId,
            Name = data.GetProperty("name").GetString()!,
            Revenue = data.GetProperty("revenue").GetDecimal(),
            Contacts = new List<Contact>()
        };

        if (data.TryGetProperty("contact_customer_accounts", out var contacts))
        {
            foreach (var contact in contacts.EnumerateArray())
            {
                account.Contacts.Add(new Contact
                {
                    Id = Guid.Parse(contact.GetProperty("contactid").GetString()!),
                    FirstName = contact.GetProperty("firstname").GetString(),
                    LastName = contact.GetProperty("lastname").GetString(),
                    Email = contact.GetProperty("emailaddress1").GetString()
                });
            }
        }

        return account;
    }

    // Associate records
    public async Task AssociateContactToAccountAsync(Guid contactId, Guid accountId)
    {
        var json = JsonSerializer.Serialize(new
        {
            @"@odata.id" = $"{_client.BaseAddress}accounts({accountId})"
        });

        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _client.PostAsync(
            $"contacts({contactId})/parentcustomerid_account/$ref",
            content);

        response.EnsureSuccessStatusCode();
    }
}

public record Contact
{
    public Guid Id { get; init; }
    public string? FirstName { get; init; }
    public string? LastName { get; init; }
    public string? Email { get; init; }
}

public record AccountWithContacts : Account
{
    public List<Contact> Contacts { get; init; } = new();
}
```

## Batch Operations

Execute multiple operations in a single request:

```csharp
public class BatchService
{
    private readonly HttpClient _client;

    public BatchService(HttpClient client)
    {
        _client = client;
    }

    public async Task ExecuteBatchAsync()
    {
        var batchId = Guid.NewGuid().ToString();
        var changesetId = Guid.NewGuid().ToString();

        var batchContent = new StringBuilder();

        // Batch boundary start
        batchContent.AppendLine($"--batch_{batchId}");
        batchContent.AppendLine($"Content-Type: multipart/mixed; boundary=changeset_{changesetId}");
        batchContent.AppendLine();

        // Changeset item 1: Create account
        batchContent.AppendLine($"--changeset_{changesetId}");
        batchContent.AppendLine("Content-Type: application/http");
        batchContent.AppendLine("Content-Transfer-Encoding: binary");
        batchContent.AppendLine("Content-ID: 1");
        batchContent.AppendLine();
        batchContent.AppendLine("POST accounts HTTP/1.1");
        batchContent.AppendLine("Content-Type: application/json");
        batchContent.AppendLine();
        batchContent.AppendLine(JsonSerializer.Serialize(new { name = "New Account 1", revenue = 100000 }));

        // Changeset item 2: Create another account
        batchContent.AppendLine($"--changeset_{changesetId}");
        batchContent.AppendLine("Content-Type: application/http");
        batchContent.AppendLine("Content-Transfer-Encoding: binary");
        batchContent.AppendLine("Content-ID: 2");
        batchContent.AppendLine();
        batchContent.AppendLine("POST accounts HTTP/1.1");
        batchContent.AppendLine("Content-Type: application/json");
        batchContent.AppendLine();
        batchContent.AppendLine(JsonSerializer.Serialize(new { name = "New Account 2", revenue = 200000 }));

        // Close changeset
        batchContent.AppendLine($"--changeset_{changesetId}--");

        // Close batch
        batchContent.AppendLine($"--batch_{batchId}--");

        var content = new StringContent(
            batchContent.ToString(),
            Encoding.UTF8,
            $"multipart/mixed; boundary=batch_{batchId}");

        var response = await _client.PostAsync("$batch", content);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadAsStringAsync();
        Console.WriteLine(result);
    }
}
```

## FetchXML Queries

Use FetchXML for complex queries:

```csharp
public class FetchXmlService
{
    private readonly HttpClient _client;

    public FetchXmlService(HttpClient client)
    {
        _client = client;
    }

    public async Task<List<AccountSummary>> GetTopAccountsByRevenueAsync(int top = 10)
    {
        var fetchXml = $@"
            <fetch top='{top}'>
                <entity name='account'>
                    <attribute name='accountid' />
                    <attribute name='name' />
                    <attribute name='revenue' />
                    <attribute name='industrycode' />
                    <order attribute='revenue' descending='true' />
                    <filter type='and'>
                        <condition attribute='statecode' operator='eq' value='0' />
                        <condition attribute='revenue' operator='not-null' />
                    </filter>
                </entity>
            </fetch>";

        var encodedFetch = Uri.EscapeDataString(fetchXml);
        var response = await _client.GetAsync($"accounts?fetchXml={encodedFetch}");
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<JsonElement>(json);

        var accounts = new List<AccountSummary>();
        foreach (var item in data.GetProperty("value").EnumerateArray())
        {
            accounts.Add(new AccountSummary
            {
                Id = Guid.Parse(item.GetProperty("accountid").GetString()!),
                Name = item.GetProperty("name").GetString()!,
                Revenue = item.GetProperty("revenue").GetDecimal()
            });
        }

        return accounts;
    }

    public async Task<List<ContactsByIndustry>> GetContactsGroupedByIndustryAsync()
    {
        var fetchXml = @"
            <fetch aggregate='true'>
                <entity name='contact'>
                    <attribute name='contactid' alias='contact_count' aggregate='count' />
                    <link-entity name='account' from='accountid' to='parentcustomerid' alias='acc'>
                        <attribute name='industrycode' alias='industry' groupby='true' />
                    </link-entity>
                </entity>
            </fetch>";

        var encodedFetch = Uri.EscapeDataString(fetchXml);
        var response = await _client.GetAsync($"contacts?fetchXml={encodedFetch}");
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<JsonElement>(json);

        var results = new List<ContactsByIndustry>();
        foreach (var item in data.GetProperty("value").EnumerateArray())
        {
            results.Add(new ContactsByIndustry
            {
                IndustryCode = item.GetProperty("industry").GetInt32(),
                ContactCount = item.GetProperty("contact_count").GetInt32()
            });
        }

        return results;
    }
}

public record AccountSummary
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public decimal Revenue { get; init; }
}

public record ContactsByIndustry
{
    public int IndustryCode { get; init; }
    public int ContactCount { get; init; }
}
```

## Summary

Dataverse Web API provides:

- RESTful access to Dataverse data
- OData query capabilities
- Batch operations for efficiency
- FetchXML for complex queries
- Relationship management

Build enterprise-grade applications with Microsoft's data platform.
