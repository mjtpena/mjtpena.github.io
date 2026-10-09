---
title: "Microsoft Teams Integration with Azure: Building Collaborative Apps"
description: "Microsoft Teams integration with Azure enables powerful collaborative applications. Whether building bots, tabs, or webhooks, the combination provides a…"
author: Michael John Pena
draft: false
date: 2021-11-29
tags:
  - Microsoft Teams
  - Azure
  - Bots
  - Integration
  - Collaboration
---

## Teams Integration Options

Teams supports multiple integration patterns:

- **Tabs**: Embed web apps in Teams
- **Bots**: Conversational AI interfaces
- **Messaging Extensions**: Rich interactions in chat
- **Webhooks**: Push notifications to channels
- **Connectors**: Pull data from external services

## Building a Teams Bot with Azure Bot Service

### Create Bot Registration

```bash
# Create Azure Bot
az bot create \
    --resource-group rg-teams-bot \
    --name my-teams-bot \
    --kind registration \
    --endpoint "https://mybot.azurewebsites.net/api/messages" \
    --sku F0 \
    --msi-resource-id "/subscriptions/.../identities/bot-identity"

# Enable Teams channel
az bot msteams create \
    --resource-group rg-teams-bot \
    --name my-teams-bot
```

### Bot Implementation

```csharp
// Bot/TeamsBot.cs
using Microsoft.Bot.Builder;
using Microsoft.Bot.Builder.Teams;
using Microsoft.Bot.Schema;
using Microsoft.Bot.Schema.Teams;

public class TeamsBot : TeamsActivityHandler
{
    private readonly ILogger<TeamsBot> _logger;
    private readonly ITicketService _ticketService;

    public TeamsBot(ILogger<TeamsBot> logger, ITicketService ticketService)
    {
        _logger = logger;
        _ticketService = ticketService;
    }

    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var text = turnContext.Activity.Text?.ToLower().Trim();

        if (text?.StartsWith("create ticket") == true)
        {
            await HandleCreateTicketAsync(turnContext, text, cancellationToken);
        }
        else if (text?.StartsWith("status") == true)
        {
            await HandleStatusQueryAsync(turnContext, cancellationToken);
        }
        else
        {
            // Show help card
            var card = CreateHelpCard();
            await turnContext.SendActivityAsync(
                MessageFactory.Attachment(card),
                cancellationToken
            );
        }
    }

    private async Task HandleCreateTicketAsync(
        ITurnContext<IMessageActivity> turnContext,
        string text,
        CancellationToken cancellationToken)
    {
        var description = text.Replace("create ticket", "").Trim();

        var ticket = await _ticketService.CreateTicketAsync(new CreateTicketRequest
        {
            Description = description,
            ReportedBy = turnContext.Activity.From.Name,
            Channel = turnContext.Activity.ChannelId
        });

        var card = CreateTicketCard(ticket);
        await turnContext.SendActivityAsync(
            MessageFactory.Attachment(card),
            cancellationToken
        );
    }

    protected override async Task OnTeamsChannelCreatedAsync(
        ChannelInfo channelInfo,
        TeamInfo teamInfo,
        ITurnContext<IConversationUpdateActivity> turnContext,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation("Channel created: {ChannelName} in team {TeamName}",
            channelInfo.Name, teamInfo.Name);

        await turnContext.SendActivityAsync(
            $"Welcome to {channelInfo.Name}! I'm here to help manage support tickets.",
            cancellationToken: cancellationToken
        );
    }

    protected override async Task OnMembersAddedAsync(
        IList<ChannelAccount> membersAdded,
        ITurnContext<IConversationUpdateActivity> turnContext,
        CancellationToken cancellationToken)
    {
        foreach (var member in membersAdded)
        {
            if (member.Id != turnContext.Activity.Recipient.Id)
            {
                var welcomeCard = CreateWelcomeCard(member.Name);
                await turnContext.SendActivityAsync(
                    MessageFactory.Attachment(welcomeCard),
                    cancellationToken
                );
            }
        }
    }

    private Attachment CreateTicketCard(Ticket ticket)
    {
        var card = new AdaptiveCard(new AdaptiveSchemaVersion(1, 3))
        {
            Body = new List<AdaptiveElement>
            {
                new AdaptiveTextBlock
                {
                    Text = $"Ticket #{ticket.Id}",
                    Weight = AdaptiveTextWeight.Bolder,
                    Size = AdaptiveTextSize.Large
                },
                new AdaptiveFactSet
                {
                    Facts = new List<AdaptiveFact>
                    {
                        new AdaptiveFact("Status", ticket.Status),
                        new AdaptiveFact("Priority", ticket.Priority),
                        new AdaptiveFact("Reported By", ticket.ReportedBy),
                        new AdaptiveFact("Created", ticket.CreatedAt.ToString("g"))
                    }
                },
                new AdaptiveTextBlock
                {
                    Text = ticket.Description,
                    Wrap = true
                }
            },
            Actions = new List<AdaptiveAction>
            {
                new AdaptiveSubmitAction
                {
                    Title = "Update Status",
                    Data = new { action = "updateStatus", ticketId = ticket.Id }
                },
                new AdaptiveOpenUrlAction
                {
                    Title = "View Details",
                    Url = new Uri($"https://ticketsystem.com/tickets/{ticket.Id}")
                }
            }
        };

        return new Attachment
        {
            ContentType = AdaptiveCard.ContentType,
            Content = card
        };
    }
}
```

### Handle Adaptive Card Actions

```csharp
protected override async Task<InvokeResponse> OnAdaptiveCardInvokeAsync(
    ITurnContext<IInvokeActivity> turnContext,
    AdaptiveCardInvokeValue invokeValue,
    CancellationToken cancellationToken)
{
    var action = invokeValue.Action.Data.ToString();
    var data = JsonSerializer.Deserialize<CardActionData>(action);

    switch (data.Action)
    {
        case "updateStatus":
            return await HandleUpdateStatusAsync(turnContext, data, cancellationToken);

        case "assignTicket":
            return await HandleAssignTicketAsync(turnContext, data, cancellationToken);

        default:
            return CreateInvokeResponse(HttpStatusCode.BadRequest);
    }
}

private async Task<InvokeResponse> HandleUpdateStatusAsync(
    ITurnContext<IInvokeActivity> turnContext,
    CardActionData data,
    CancellationToken cancellationToken)
{
    var ticket = await _ticketService.UpdateStatusAsync(data.TicketId, data.NewStatus);

    // Update the card in place
    var updatedCard = CreateTicketCard(ticket);

    return CreateInvokeResponse(HttpStatusCode.OK, new AdaptiveCardInvokeResponse
    {
        StatusCode = 200,
        Type = AdaptiveCard.ContentType,
        Value = updatedCard.Content
    });
}
```

## Messaging Extensions

### Search Extension

```csharp
protected override async Task<MessagingExtensionResponse> OnTeamsMessagingExtensionQueryAsync(
    ITurnContext<IInvokeActivity> turnContext,
    MessagingExtensionQuery query,
    CancellationToken cancellationToken)
{
    var searchText = query.Parameters?.FirstOrDefault(p => p.Name == "searchText")?.Value?.ToString();

    var tickets = await _ticketService.SearchTicketsAsync(searchText);

    var attachments = tickets.Select(ticket => new MessagingExtensionAttachment
    {
        ContentType = HeroCard.ContentType,
        Content = new HeroCard
        {
            Title = $"Ticket #{ticket.Id}",
            Subtitle = ticket.Status,
            Text = ticket.Description
        },
        Preview = new HeroCard
        {
            Title = $"Ticket #{ticket.Id}",
            Subtitle = ticket.Status,
            Tap = new CardAction
            {
                Type = ActionTypes.InvokeAction,
                Value = new { ticketId = ticket.Id }
            }
        }.ToAttachment()
    }).ToList();

    return new MessagingExtensionResponse
    {
        ComposeExtension = new MessagingExtensionResult
        {
            Type = "result",
            AttachmentLayout = "list",
            Attachments = attachments
        }
    };
}
```

### Action Extension

```csharp
protected override async Task<MessagingExtensionActionResponse> OnTeamsMessagingExtensionSubmitActionAsync(
    ITurnContext<IInvokeActivity> turnContext,
    MessagingExtensionAction action,
    CancellationToken cancellationToken)
{
    var data = JsonSerializer.Deserialize<CreateTicketFormData>(action.Data.ToString());

    var ticket = await _ticketService.CreateTicketAsync(new CreateTicketRequest
    {
        Title = data.Title,
        Description = data.Description,
        Priority = data.Priority,
        ReportedBy = turnContext.Activity.From.Name
    });

    var card = CreateTicketCard(ticket);

    return new MessagingExtensionActionResponse
    {
        ComposeExtension = new MessagingExtensionResult
        {
            Type = "result",
            AttachmentLayout = "list",
            Attachments = new List<MessagingExtensionAttachment>
            {
                new MessagingExtensionAttachment
                {
                    ContentType = AdaptiveCard.ContentType,
                    Content = card.Content
                }
            }
        }
    };
}
```

## Incoming Webhooks

### Send to Teams Channel

```csharp
public class TeamsNotificationService
{
    private readonly HttpClient _httpClient;

    public TeamsNotificationService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task SendAlertAsync(string webhookUrl, Alert alert)
    {
        var card = new
        {
            type = "message",
            attachments = new[]
            {
                new
                {
                    contentType = "application/vnd.microsoft.card.adaptive",
                    content = new
                    {
                        type = "AdaptiveCard",
                        version = "1.3",
                        body = new object[]
                        {
                            new
                            {
                                type = "TextBlock",
                                text = alert.Severity == "Critical" ? "!!! Critical Alert" : "Alert",
                                weight = "Bolder",
                                size = "Large",
                                color = alert.Severity == "Critical" ? "Attention" : "Default"
                            },
                            new
                            {
                                type = "TextBlock",
                                text = alert.Title,
                                weight = "Bolder"
                            },
                            new
                            {
                                type = "FactSet",
                                facts = new[]
                                {
                                    new { title = "Service", value = alert.Service },
                                    new { title = "Environment", value = alert.Environment },
                                    new { title = "Time", value = alert.Timestamp.ToString("g") }
                                }
                            },
                            new
                            {
                                type = "TextBlock",
                                text = alert.Description,
                                wrap = true
                            }
                        },
                        actions = new[]
                        {
                            new
                            {
                                type = "Action.OpenUrl",
                                title = "View in Portal",
                                url = alert.PortalUrl
                            }
                        }
                    }
                }
            }
        };

        var content = new StringContent(
            JsonSerializer.Serialize(card),
            Encoding.UTF8,
            "application/json"
        );

        await _httpClient.PostAsync(webhookUrl, content);
    }
}
```

## Tab Application

### Teams Tab Configuration

```typescript
// tabs/config.tsx
import * as microsoftTeams from "@microsoft/teams-js";

export function ConfigPage() {
    const [selectedDashboard, setSelectedDashboard] = useState("");

    useEffect(() => {
        microsoftTeams.initialize();

        microsoftTeams.settings.registerOnSaveHandler((saveEvent) => {
            microsoftTeams.settings.setSettings({
                websiteUrl: `https://myapp.com/dashboard/${selectedDashboard}`,
                contentUrl: `https://myapp.com/dashboard/${selectedDashboard}?inTeams=true`,
                entityId: selectedDashboard,
                suggestedDisplayName: `Dashboard - ${selectedDashboard}`
            });
            saveEvent.notifySuccess();
        });
    }, [selectedDashboard]);

    useEffect(() => {
        microsoftTeams.settings.setValidityState(selectedDashboard !== "");
    }, [selectedDashboard]);

    return (
        <div>
            <h2>Select Dashboard</h2>
            <select
                value={selectedDashboard}
                onChange={(e) => setSelectedDashboard(e.target.value)}
            >
                <option value="">Select...</option>
                <option value="sales">Sales Dashboard</option>
                <option value="support">Support Dashboard</option>
                <option value="devops">DevOps Dashboard</option>
            </select>
        </div>
    );
}
```

### Teams Context in Tab

```typescript
// tabs/dashboard.tsx
import * as microsoftTeams from "@microsoft/teams-js";

export function Dashboard() {
    const [context, setContext] = useState<microsoftTeams.Context | null>(null);
    const [data, setData] = useState(null);

    useEffect(() => {
        microsoftTeams.initialize();

        microsoftTeams.getContext((ctx) => {
            setContext(ctx);
            loadDashboardData(ctx.entityId);
        });

        // Handle theme changes
        microsoftTeams.registerOnThemeChangeHandler((theme) => {
            document.body.className = theme;
        });
    }, []);

    async function loadDashboardData(dashboardId: string) {
        // Use Teams SSO for authentication
        const token = await getTeamsToken();

        const response = await fetch(`/api/dashboard/${dashboardId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        setData(await response.json());
    }

    async function getTeamsToken(): Promise<string> {
        return new Promise((resolve, reject) => {
            microsoftTeams.authentication.getAuthToken({
                successCallback: resolve,
                failureCallback: reject
            });
        });
    }

    if (!data) return <div>Loading...</div>;

    return (
        <div className={`dashboard ${context?.theme}`}>
            <h1>Dashboard for {context?.teamName}</h1>
            {/* Dashboard content */}
        </div>
    );
}
```

Microsoft Teams integration with Azure enables powerful collaborative applications. Whether building bots, tabs, or webhooks, the combination provides a seamless experience for users.

## Resources

- [Teams Developer Documentation](https://docs.microsoft.com/en-us/microsoftteams/platform/)
- [Bot Framework Documentation](https://docs.microsoft.com/en-us/azure/bot-service/)
- [Adaptive Cards Designer](https://adaptivecards.io/designer/)
- [Teams Toolkit for VS Code](https://marketplace.visualstudio.com/items?itemName=TeamsDevApp.ms-teams-vscode-extension)
