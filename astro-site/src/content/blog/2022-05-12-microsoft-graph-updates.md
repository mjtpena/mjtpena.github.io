---
title: "Microsoft Graph API: Latest Updates and Patterns"
author: Michael John Peña
draft: false
date: 2022-05-12
tags:
  - microsoft-graph
  - Azure
  - API
  - microsoft-365
---

## Graph SDK Setup

Install and configure the Microsoft Graph SDK:

```csharp
// Install packages
// dotnet add package Microsoft.Graph
// dotnet add package Azure.Identity

using Microsoft.Graph;
using Azure.Identity;

public class GraphService
{
    private readonly GraphServiceClient _graphClient;

    public GraphService(IConfiguration config)
    {
        var scopes = new[] { "https://graph.microsoft.com/.default" };

        var options = new TokenCredentialOptions
        {
            AuthorityHost = AzureAuthorityHosts.AzurePublicCloud
        };

        // For application permissions (daemon app)
        var credential = new ClientSecretCredential(
            config["AzureAd:TenantId"],
            config["AzureAd:ClientId"],
            config["AzureAd:ClientSecret"],
            options);

        _graphClient = new GraphServiceClient(credential, scopes);
    }

    // For user-delegated permissions
    public GraphService(string accessToken)
    {
        var authProvider = new DelegateAuthenticationProvider(request =>
        {
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", accessToken);
            return Task.CompletedTask;
        });

        _graphClient = new GraphServiceClient(authProvider);
    }
}
```

## Working with Users

Query and manage user data:

```csharp
public class UserService
{
    private readonly GraphServiceClient _graphClient;

    public UserService(GraphServiceClient graphClient)
    {
        _graphClient = graphClient;
    }

    public async Task<User> GetCurrentUserAsync()
    {
        return await _graphClient.Me
            .Request()
            .Select(u => new
            {
                u.Id,
                u.DisplayName,
                u.Mail,
                u.JobTitle,
                u.Department,
                u.OfficeLocation
            })
            .GetAsync();
    }

    public async Task<IEnumerable<User>> SearchUsersAsync(string searchTerm)
    {
        var users = await _graphClient.Users
            .Request()
            .Filter($"startswith(displayName, '{searchTerm}') or startswith(mail, '{searchTerm}')")
            .Select(u => new { u.Id, u.DisplayName, u.Mail, u.JobTitle })
            .Top(25)
            .GetAsync();

        return users.CurrentPage;
    }

    public async Task<Stream> GetUserPhotoAsync(string userId)
    {
        try
        {
            return await _graphClient.Users[userId]
                .Photo
                .Content
                .Request()
                .GetAsync();
        }
        catch (ServiceException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<IEnumerable<User>> GetDirectReportsAsync(string managerId)
    {
        var directReports = await _graphClient.Users[managerId]
            .DirectReports
            .Request()
            .GetAsync();

        return directReports.CurrentPage.OfType<User>();
    }

    public async Task<User> GetManagerAsync(string userId)
    {
        var manager = await _graphClient.Users[userId]
            .Manager
            .Request()
            .GetAsync();

        return manager as User;
    }
}
```

## Calendar Operations

Manage calendars and events:

```csharp
public class CalendarService
{
    private readonly GraphServiceClient _graphClient;

    public CalendarService(GraphServiceClient graphClient)
    {
        _graphClient = graphClient;
    }

    public async Task<IEnumerable<Event>> GetUpcomingEventsAsync(int days = 7)
    {
        var now = DateTime.UtcNow;
        var end = now.AddDays(days);

        var events = await _graphClient.Me
            .CalendarView
            .Request()
            .Header("Prefer", "outlook.timezone=\"UTC\"")
            .Filter($"start/dateTime ge '{now:yyyy-MM-ddTHH:mm:ss}' and end/dateTime le '{end:yyyy-MM-ddTHH:mm:ss}'")
            .OrderBy("start/dateTime")
            .Select(e => new
            {
                e.Subject,
                e.Start,
                e.End,
                e.Location,
                e.Organizer,
                e.Attendees,
                e.IsOnlineMeeting,
                e.OnlineMeetingUrl
            })
            .Top(50)
            .GetAsync();

        return events.CurrentPage;
    }

    public async Task<Event> CreateEventAsync(CreateEventRequest request)
    {
        var newEvent = new Event
        {
            Subject = request.Subject,
            Body = new ItemBody
            {
                ContentType = BodyType.Html,
                Content = request.Body
            },
            Start = new DateTimeTimeZone
            {
                DateTime = request.Start.ToString("yyyy-MM-ddTHH:mm:ss"),
                TimeZone = "UTC"
            },
            End = new DateTimeTimeZone
            {
                DateTime = request.End.ToString("yyyy-MM-ddTHH:mm:ss"),
                TimeZone = "UTC"
            },
            Location = new Location
            {
                DisplayName = request.Location
            },
            Attendees = request.Attendees.Select(email => new Attendee
            {
                EmailAddress = new EmailAddress { Address = email },
                Type = AttendeeType.Required
            }).ToList(),
            IsOnlineMeeting = request.IsOnlineMeeting,
            OnlineMeetingProvider = request.IsOnlineMeeting
                ? OnlineMeetingProviderType.TeamsForBusiness
                : OnlineMeetingProviderType.Unknown
        };

        return await _graphClient.Me.Events
            .Request()
            .AddAsync(newEvent);
    }

    public async Task<IEnumerable<ScheduleInformation>> GetScheduleAsync(
        IEnumerable<string> emails,
        DateTime start,
        DateTime end)
    {
        var scheduleRequest = new CalendarGetScheduleRequestObject
        {
            Schedules = emails.ToList(),
            StartTime = new DateTimeTimeZone
            {
                DateTime = start.ToString("yyyy-MM-ddTHH:mm:ss"),
                TimeZone = "UTC"
            },
            EndTime = new DateTimeTimeZone
            {
                DateTime = end.ToString("yyyy-MM-ddTHH:mm:ss"),
                TimeZone = "UTC"
            },
            AvailabilityViewInterval = 30
        };

        var result = await _graphClient.Me.Calendar
            .GetSchedule(scheduleRequest.Schedules, scheduleRequest.EndTime, scheduleRequest.StartTime)
            .Request()
            .PostAsync();

        return result.CurrentPage;
    }
}

public record CreateEventRequest(
    string Subject,
    string Body,
    DateTime Start,
    DateTime End,
    string Location,
    IEnumerable<string> Attendees,
    bool IsOnlineMeeting = false);
```

## Working with Files

Access OneDrive and SharePoint files:

```csharp
public class FileService
{
    private readonly GraphServiceClient _graphClient;

    public FileService(GraphServiceClient graphClient)
    {
        _graphClient = graphClient;
    }

    public async Task<IEnumerable<DriveItem>> GetRecentFilesAsync()
    {
        var items = await _graphClient.Me.Drive
            .Recent()
            .Request()
            .Top(25)
            .GetAsync();

        return items.CurrentPage;
    }

    public async Task<IEnumerable<DriveItem>> SearchFilesAsync(string searchQuery)
    {
        var items = await _graphClient.Me.Drive
            .Root
            .Search(searchQuery)
            .Request()
            .Top(25)
            .GetAsync();

        return items.CurrentPage;
    }

    public async Task<DriveItem> UploadFileAsync(string fileName, Stream content)
    {
        // For files up to 4MB
        return await _graphClient.Me.Drive
            .Root
            .ItemWithPath(fileName)
            .Content
            .Request()
            .PutAsync<DriveItem>(content);
    }

    public async Task<DriveItem> UploadLargeFileAsync(
        string fileName,
        Stream content,
        long fileSize)
    {
        // For files larger than 4MB
        var uploadProps = new DriveItemUploadableProperties
        {
            Name = fileName,
            AdditionalData = new Dictionary<string, object>
            {
                { "@microsoft.graph.conflictBehavior", "rename" }
            }
        };

        var uploadSession = await _graphClient.Me.Drive
            .Root
            .ItemWithPath(fileName)
            .CreateUploadSession(uploadProps)
            .Request()
            .PostAsync();

        var maxSliceSize = 320 * 1024; // 320 KB per slice
        var fileUploadTask = new LargeFileUploadTask<DriveItem>(
            uploadSession,
            content,
            maxSliceSize);

        var uploadResult = await fileUploadTask.UploadAsync();
        return uploadResult.ItemResponse;
    }

    public async Task<string> CreateSharingLinkAsync(string itemId)
    {
        var permission = await _graphClient.Me.Drive
            .Items[itemId]
            .CreateLink("view", "organization")
            .Request()
            .PostAsync();

        return permission.Link.WebUrl;
    }
}
```

## Batch Requests

Optimize multiple API calls:

```csharp
public class BatchService
{
    private readonly GraphServiceClient _graphClient;

    public BatchService(GraphServiceClient graphClient)
    {
        _graphClient = graphClient;
    }

    public async Task<BatchResponse> GetUserDataBatchAsync(string userId)
    {
        var batchContent = new BatchRequestContent();

        // Request 1: User profile
        var userRequest = _graphClient.Users[userId]
            .Request()
            .Select(u => new { u.DisplayName, u.Mail, u.JobTitle });
        var userRequestId = batchContent.AddBatchRequestStep(userRequest);

        // Request 2: User's manager
        var managerRequest = _graphClient.Users[userId].Manager.Request();
        var managerRequestId = batchContent.AddBatchRequestStep(managerRequest);

        // Request 3: User's recent files
        var filesRequest = _graphClient.Users[userId].Drive.Recent().Request().Top(5);
        var filesRequestId = batchContent.AddBatchRequestStep(filesRequest);

        // Request 4: User's upcoming events
        var eventsRequest = _graphClient.Users[userId].Events
            .Request()
            .Filter($"start/dateTime ge '{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ss}'")
            .Top(5);
        var eventsRequestId = batchContent.AddBatchRequestStep(eventsRequest);

        // Execute batch
        var batchResponse = await _graphClient.Batch.Request().PostAsync(batchContent);

        // Parse responses
        var user = await batchResponse.GetResponseByIdAsync<User>(userRequestId);
        var manager = await batchResponse.GetResponseByIdAsync<DirectoryObject>(managerRequestId);
        var files = await batchResponse.GetResponseByIdAsync<DriveItemCollectionResponse>(filesRequestId);
        var events = await batchResponse.GetResponseByIdAsync<EventCollectionResponse>(eventsRequestId);

        return new BatchResponse(user, manager as User, files.Value, events.Value);
    }
}

public record BatchResponse(
    User User,
    User Manager,
    IEnumerable<DriveItem> RecentFiles,
    IEnumerable<Event> UpcomingEvents);
```

## Change Notifications (Webhooks)

Subscribe to changes:

```csharp
public class SubscriptionService
{
    private readonly GraphServiceClient _graphClient;

    public SubscriptionService(GraphServiceClient graphClient)
    {
        _graphClient = graphClient;
    }

    public async Task<Subscription> CreateSubscriptionAsync(
        string resource,
        string notificationUrl,
        TimeSpan expirationOffset)
    {
        var subscription = new Subscription
        {
            Resource = resource,
            ChangeType = "created,updated,deleted",
            NotificationUrl = notificationUrl,
            ExpirationDateTime = DateTimeOffset.UtcNow.Add(expirationOffset),
            ClientState = Guid.NewGuid().ToString()
        };

        return await _graphClient.Subscriptions
            .Request()
            .AddAsync(subscription);
    }

    public async Task<Subscription> RenewSubscriptionAsync(string subscriptionId)
    {
        var subscription = new Subscription
        {
            ExpirationDateTime = DateTimeOffset.UtcNow.AddDays(2)
        };

        return await _graphClient.Subscriptions[subscriptionId]
            .Request()
            .UpdateAsync(subscription);
    }
}
```

## Summary

Microsoft Graph provides:

- Unified API for Microsoft 365 data
- Rich user, calendar, and file operations
- Batch requests for optimization
- Change notifications for real-time updates
- SDKs for multiple languages

Build connected experiences across the Microsoft ecosystem.
