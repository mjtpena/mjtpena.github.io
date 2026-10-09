---
title: "Building Teams Apps: Integration Patterns and Best Practices"
author: Michael John Peña
draft: false
date: 2022-05-11
tags:
  - microsoft-teams
  - Azure
  - Bots
  - Collaboration
---

## Teams App Components

Teams apps can include:
- Tabs (embedded web content)
- Bots (conversational interfaces)
- Message extensions
- Webhooks and connectors
- Meeting extensions

## Setting Up Teams Toolkit

```bash
# Install Teams Toolkit CLI
npm install -g @microsoft/teamsfx-cli

# Create new Teams app
teamsfx new --interactive false --capability tab --programming-language typescript

# Or create with bot capability
teamsfx new --interactive false --capability bot --programming-language csharp
```

## Tab Application

Create an embedded web application:

```typescript
// src/components/Tab.tsx
import React, { useEffect, useState } from "react";
import { app, authentication } from "@microsoft/teams-js";
import { Loader, Text, Flex, Card } from "@fluentui/react-northstar";

interface UserProfile {
  displayName: string;
  email: string;
  jobTitle: string;
}

export const Tab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeTeams = async () => {
      try {
        await app.initialize();

        // Get authentication token
        const token = await authentication.getAuthToken({
          resources: ["https://graph.microsoft.com"],
        });

        // Fetch user profile
        const response = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setProfile({
            displayName: data.displayName,
            email: data.mail || data.userPrincipalName,
            jobTitle: data.jobTitle || "Not specified",
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize");
      } finally {
        setLoading(false);
      }
    };

    initializeTeams();
  }, []);

  if (loading) {
    return <Loader label="Loading..." />;
  }

  if (error) {
    return <Text error content={error} />;
  }

  return (
    <Flex column gap="gap.medium" padding="padding.medium">
      <Text size="larger" weight="bold" content="Welcome to the App" />
      {profile && (
        <Card>
          <Card.Header>
            <Text content={profile.displayName} weight="bold" />
          </Card.Header>
          <Card.Body>
            <Flex column gap="gap.small">
              <Text content={`Email: ${profile.email}`} />
              <Text content={`Title: ${profile.jobTitle}`} />
            </Flex>
          </Card.Body>
        </Card>
      )}
    </Flex>
  );
};
```

## Bot Implementation

Create a conversational bot:

```csharp
// Bots/TeamsBot.cs
using Microsoft.Bot.Builder;
using Microsoft.Bot.Builder.Teams;
using Microsoft.Bot.Schema;
using Microsoft.Bot.Schema.Teams;

public class TeamsBot : TeamsActivityHandler
{
    private readonly IConfiguration _config;
    private readonly ILogger<TeamsBot> _logger;

    public TeamsBot(IConfiguration config, ILogger<TeamsBot> logger)
    {
        _config = config;
        _logger = logger;
    }

    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var text = turnContext.Activity.Text?.Trim().ToLower();

        if (string.IsNullOrEmpty(text))
        {
            await turnContext.SendActivityAsync("Please send a message.");
            return;
        }

        // Handle different commands
        var response = text switch
        {
            "help" => CreateHelpCard(),
            "status" => await GetStatusCard(turnContext),
            _ when text.StartsWith("search ") => await SearchAsync(text[7..], turnContext),
            _ => MessageFactory.Text($"You said: {text}")
        };

        await turnContext.SendActivityAsync(response, cancellationToken);
    }

    private IMessageActivity CreateHelpCard()
    {
        var card = new AdaptiveCard(new AdaptiveSchemaVersion(1, 4))
        {
            Body = new List<AdaptiveElement>
            {
                new AdaptiveTextBlock
                {
                    Text = "Available Commands",
                    Weight = AdaptiveTextWeight.Bolder,
                    Size = AdaptiveTextSize.Large
                },
                new AdaptiveFactSet
                {
                    Facts = new List<AdaptiveFact>
                    {
                        new("help", "Show this help message"),
                        new("status", "Check system status"),
                        new("search <query>", "Search for items")
                    }
                }
            }
        };

        var attachment = new Attachment
        {
            ContentType = AdaptiveCard.ContentType,
            Content = card
        };

        return MessageFactory.Attachment(attachment);
    }

    private async Task<IMessageActivity> GetStatusCard(ITurnContext context)
    {
        // Fetch status from your API
        var status = new
        {
            Api = "Healthy",
            Database = "Healthy",
            LastUpdated = DateTime.UtcNow
        };

        var card = new AdaptiveCard(new AdaptiveSchemaVersion(1, 4))
        {
            Body = new List<AdaptiveElement>
            {
                new AdaptiveTextBlock
                {
                    Text = "System Status",
                    Weight = AdaptiveTextWeight.Bolder
                },
                new AdaptiveColumnSet
                {
                    Columns = new List<AdaptiveColumn>
                    {
                        new AdaptiveColumn
                        {
                            Items = new List<AdaptiveElement>
                            {
                                new AdaptiveTextBlock { Text = "API" },
                                new AdaptiveTextBlock { Text = "Database" }
                            }
                        },
                        new AdaptiveColumn
                        {
                            Items = new List<AdaptiveElement>
                            {
                                new AdaptiveTextBlock
                                {
                                    Text = status.Api,
                                    Color = AdaptiveTextColor.Good
                                },
                                new AdaptiveTextBlock
                                {
                                    Text = status.Database,
                                    Color = AdaptiveTextColor.Good
                                }
                            }
                        }
                    }
                }
            }
        };

        return MessageFactory.Attachment(new Attachment
        {
            ContentType = AdaptiveCard.ContentType,
            Content = card
        });
    }

    private async Task<IMessageActivity> SearchAsync(string query, ITurnContext context)
    {
        // Implement search logic
        return MessageFactory.Text($"Searching for: {query}");
    }

    protected override async Task OnTeamsMembersAddedAsync(
        IList<TeamsChannelAccount> membersAdded,
        TeamInfo teamInfo,
        ITurnContext<IConversationUpdateActivity> turnContext,
        CancellationToken cancellationToken)
    {
        foreach (var member in membersAdded)
        {
            if (member.Id != turnContext.Activity.Recipient.Id)
            {
                await turnContext.SendActivityAsync(
                    $"Welcome {member.Name}! Type 'help' to see available commands.",
                    cancellationToken: cancellationToken);
            }
        }
    }
}
```

## Message Extension

Create a search-based message extension:

```csharp
// Bots/MessageExtension.cs
public class MessageExtension : TeamsActivityHandler
{
    protected override async Task<MessagingExtensionResponse> OnTeamsMessagingExtensionQueryAsync(
        ITurnContext<IInvokeActivity> turnContext,
        MessagingExtensionQuery query,
        CancellationToken cancellationToken)
    {
        var searchText = query.Parameters?.FirstOrDefault(p => p.Name == "search")?.Value as string ?? "";

        // Search your data source
        var results = await SearchItemsAsync(searchText);

        var attachments = results.Select(item => new MessagingExtensionAttachment
        {
            ContentType = HeroCard.ContentType,
            Content = new HeroCard
            {
                Title = item.Title,
                Subtitle = item.Description,
                Images = new List<CardImage>
                {
                    new CardImage(item.ImageUrl)
                }
            },
            Preview = new HeroCard
            {
                Title = item.Title,
                Tap = new CardAction
                {
                    Type = ActionTypes.InvokeAction,
                    Value = item
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

    protected override async Task<MessagingExtensionActionResponse> OnTeamsMessagingExtensionSubmitActionAsync(
        ITurnContext<IInvokeActivity> turnContext,
        MessagingExtensionAction action,
        CancellationToken cancellationToken)
    {
        var data = action.Data as JObject;
        var title = data?["title"]?.ToString();
        var description = data?["description"]?.ToString();

        var card = new AdaptiveCard(new AdaptiveSchemaVersion(1, 4))
        {
            Body = new List<AdaptiveElement>
            {
                new AdaptiveTextBlock
                {
                    Text = title,
                    Weight = AdaptiveTextWeight.Bolder,
                    Size = AdaptiveTextSize.Large
                },
                new AdaptiveTextBlock
                {
                    Text = description,
                    Wrap = true
                }
            }
        };

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
                        Content = card
                    }
                }
            }
        };
    }

    private async Task<List<SearchItem>> SearchItemsAsync(string query)
    {
        // Implement your search logic
        return new List<SearchItem>
        {
            new("Item 1", "Description for item 1", "https://example.com/image1.png"),
            new("Item 2", "Description for item 2", "https://example.com/image2.png")
        };
    }
}

public record SearchItem(string Title, string Description, string ImageUrl);
```

## App Manifest

Configure your Teams app:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.14/MicrosoftTeams.schema.json",
  "manifestVersion": "1.14",
  "version": "1.0.0",
  "id": "{{APP_ID}}",
  "packageName": "com.example.teamsapp",
  "developer": {
    "name": "Contoso",
    "websiteUrl": "https://example.com",
    "privacyUrl": "https://example.com/privacy",
    "termsOfUseUrl": "https://example.com/terms"
  },
  "name": {
    "short": "My Teams App",
    "full": "My Teams App - Full Name"
  },
  "description": {
    "short": "Short description",
    "full": "Full description of the app"
  },
  "icons": {
    "color": "color.png",
    "outline": "outline.png"
  },
  "accentColor": "#FFFFFF",
  "staticTabs": [
    {
      "entityId": "home",
      "name": "Home",
      "contentUrl": "https://{{HOSTNAME}}/tab",
      "scopes": ["personal"]
    }
  ],
  "bots": [
    {
      "botId": "{{BOT_ID}}",
      "scopes": ["personal", "team", "groupchat"],
      "commandLists": [
        {
          "scopes": ["personal"],
          "commands": [
            {
              "title": "help",
              "description": "Show help"
            },
            {
              "title": "status",
              "description": "Check status"
            }
          ]
        }
      ]
    }
  ],
  "composeExtensions": [
    {
      "botId": "{{BOT_ID}}",
      "commands": [
        {
          "id": "searchQuery",
          "type": "query",
          "title": "Search",
          "description": "Search for items",
          "parameters": [
            {
              "name": "search",
              "title": "Search",
              "description": "Enter search terms"
            }
          ]
        }
      ]
    }
  ],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": ["{{HOSTNAME}}"]
}
```

## Summary

Teams app development offers:

- Multiple extension points (tabs, bots, extensions)
- Rich adaptive card experiences
- Deep integration with Microsoft 365
- SSO with Azure AD
- Comprehensive SDK support

Build collaborative experiences that meet users where they work.
