---
title: "Building FAQ Bots with Azure Bot Service and QnA Maker"
description: "\"Customers ask us the same five questions over and over.\" Every support team I've worked with has said this. Before LLMs ate the world, QnA Maker was the…"
author: Michael John Peña
draft: false
date: 2020-08-24
tags:
  - Azure
  - Bot Service
  - QnA Maker
  - AI
---

"Customers ask us the same five questions over and over." Every support team I've worked with has said this. Before LLMs ate the world, QnA Maker was the practical answer — point it at your existing FAQ documents and policy PDFs, get an API that answers questions about them, drop the API into Bot Service, expose to Teams or web chat. It's worth noting upfront: QnA Maker is being superseded by Azure Cognitive Services *Question Answering* (part of Language). If you're starting fresh in 2020 you can still use QnA Maker, but plan for the migration.

## Creating a QnA Maker Knowledge Base

### Using the QnA Maker Portal

1. Go to qnamaker.ai
2. Create a new knowledge base
3. Link to Azure resources

Or use the REST API:

```bash
# Create QnA Maker resource
az cognitiveservices account create \
    --name qna-maker-2020 \
    --resource-group rg-bots \
    --kind QnAMaker \
    --sku S0 \
    --location westus \
    --yes
```

## Adding Content to Knowledge Base

### From URLs

```json
POST https://westus.api.cognitive.microsoft.com/qnamaker/v4.0/knowledgebases/{kbId}
Content-Type: application/json
Ocp-Apim-Subscription-Key: {subscription-key}

{
    "add": {
        "urls": [
            "https://mycompany.com/faq",
            "https://mycompany.com/support/common-questions"
        ]
    }
}
```

### Adding Q&A Pairs Directly

```json
{
    "add": {
        "qnaList": [
            {
                "id": 1,
                "answer": "You can reset your password by clicking 'Forgot Password' on the login page, entering your email, and following the instructions sent to your inbox.",
                "source": "Manual",
                "questions": [
                    "How do I reset my password?",
                    "I forgot my password",
                    "Can't login to my account",
                    "Password reset",
                    "Change password"
                ],
                "metadata": [
                    {
                        "name": "category",
                        "value": "account"
                    }
                ]
            },
            {
                "id": 2,
                "answer": "Our business hours are Monday to Friday, 9 AM to 5 PM AEST. You can reach us at support@company.com or call 1800-XXX-XXX.",
                "source": "Manual",
                "questions": [
                    "What are your business hours?",
                    "When are you open?",
                    "Contact hours",
                    "How can I contact support?"
                ],
                "metadata": [
                    {
                        "name": "category",
                        "value": "general"
                    }
                ]
            }
        ]
    }
}
```

## Training and Publishing

```bash
# Train the knowledge base
POST https://westus.api.cognitive.microsoft.com/qnamaker/v4.0/knowledgebases/{kbId}/train
Ocp-Apim-Subscription-Key: {subscription-key}

# Publish
POST https://westus.api.cognitive.microsoft.com/qnamaker/v4.0/knowledgebases/{kbId}
Ocp-Apim-Subscription-Key: {subscription-key}
```

## Creating the Bot

### Bot Framework Integration

```csharp
using Microsoft.Bot.Builder;
using Microsoft.Bot.Builder.AI.QnA;

public class QnABot : ActivityHandler
{
    private readonly QnAMaker _qnaMaker;
    private readonly ILogger<QnABot> _logger;

    public QnABot(QnAMaker qnaMaker, ILogger<QnABot> logger)
    {
        _qnaMaker = qnaMaker;
        _logger = logger;
    }

    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var options = new QnAMakerOptions
        {
            Top = 3,
            ScoreThreshold = 0.5f
        };

        var response = await _qnaMaker.GetAnswersAsync(turnContext, options);

        if (response != null && response.Length > 0)
        {
            var topAnswer = response[0];

            // Check confidence
            if (topAnswer.Score > 0.7)
            {
                await turnContext.SendActivityAsync(
                    MessageFactory.Text(topAnswer.Answer),
                    cancellationToken);
            }
            else
            {
                // Offer multiple options
                await SendMultipleAnswersAsync(turnContext, response, cancellationToken);
            }
        }
        else
        {
            await turnContext.SendActivityAsync(
                MessageFactory.Text("I'm sorry, I don't have an answer for that. Would you like to speak to a human agent?"),
                cancellationToken);
        }
    }

    private async Task SendMultipleAnswersAsync(
        ITurnContext turnContext,
        QueryResult[] results,
        CancellationToken cancellationToken)
    {
        var card = new HeroCard
        {
            Title = "Did you mean one of these?",
            Buttons = results.Select(r => new CardAction
            {
                Type = ActionTypes.ImBack,
                Title = TruncateQuestion(r.Questions.FirstOrDefault()),
                Value = r.Questions.FirstOrDefault()
            }).ToList()
        };

        var attachment = card.ToAttachment();
        await turnContext.SendActivityAsync(
            MessageFactory.Attachment(attachment),
            cancellationToken);
    }

    private string TruncateQuestion(string question)
    {
        return question?.Length > 50 ? question.Substring(0, 47) + "..." : question;
    }
}
```

### Configuration

```csharp
// Startup.cs
public void ConfigureServices(IServiceCollection services)
{
    services.AddSingleton<QnAMaker>(sp =>
    {
        var qnaEndpoint = new QnAMakerEndpoint
        {
            KnowledgeBaseId = Configuration["QnAMaker:KnowledgeBaseId"],
            EndpointKey = Configuration["QnAMaker:EndpointKey"],
            Host = Configuration["QnAMaker:Host"]
        };

        var options = new QnAMakerOptions
        {
            Top = 3,
            ScoreThreshold = 0.5f
        };

        return new QnAMaker(qnaEndpoint, options);
    });

    services.AddTransient<IBot, QnABot>();
}
```

## Multi-Turn Conversations

Enable follow-up prompts for complex Q&A:

```json
{
    "add": {
        "qnaList": [
            {
                "id": 10,
                "answer": "We offer several subscription plans. Which type are you interested in?",
                "questions": ["What subscription plans do you have?"],
                "context": {
                    "isContextOnly": false,
                    "prompts": [
                        {
                            "displayOrder": 1,
                            "displayText": "Personal Plans",
                            "qnaId": 11
                        },
                        {
                            "displayOrder": 2,
                            "displayText": "Business Plans",
                            "qnaId": 12
                        },
                        {
                            "displayOrder": 3,
                            "displayText": "Enterprise Plans",
                            "qnaId": 13
                        }
                    ]
                }
            }
        ]
    }
}
```

Handle prompts in the bot:

```csharp
protected override async Task OnMessageActivityAsync(
    ITurnContext<IMessageActivity> turnContext,
    CancellationToken cancellationToken)
{
    var options = new QnAMakerOptions
    {
        Top = 1,
        Context = GetQnAContext(turnContext)
    };

    var response = await _qnaMaker.GetAnswersAsync(turnContext, options);

    if (response?.Length > 0)
    {
        var answer = response[0];

        // Check for follow-up prompts
        if (answer.Context?.Prompts?.Length > 0)
        {
            await SendPromptCardAsync(turnContext, answer, cancellationToken);
        }
        else
        {
            await turnContext.SendActivityAsync(
                MessageFactory.Text(answer.Answer),
                cancellationToken);
        }

        // Store context for next turn
        SaveQnAContext(turnContext, answer);
    }
}
```

## Active Learning

Improve answers based on user interactions:

```csharp
public async Task TrainFromFeedbackAsync(string question, string selectedAnswer)
{
    var feedbackRecords = new FeedbackRecords
    {
        Records = new[]
        {
            new FeedbackRecord
            {
                UserId = "user1",
                UserQuestion = question,
                QnaId = GetQnaIdForAnswer(selectedAnswer)
            }
        }
    };

    await _qnaMaker.CallTrainAsync(feedbackRecords);
}
```

## Deploying to Azure Bot Service

```bash
# Create bot service
az bot create \
    --resource-group rg-bots \
    --name faq-bot-2020 \
    --kind webapp \
    --sku S1 \
    --location australiaeast \
    --appid $APP_ID \
    --password $APP_PASSWORD

# Connect to channels
az bot msteams create --name faq-bot-2020 --resource-group rg-bots
az bot webchat create --name faq-bot-2020 --resource-group rg-bots
```

FAQ bots built with QnA Maker can handle a significant portion of support queries, freeing up human agents for complex issues.

The honest measurement: at one client, deflection from a well-tuned QnA bot landed around 30-40% of inbound chats — useful, but a long way from "replace the support team." Treat it as a top-of-funnel filter, not a replacement, and always make the "talk to a human" path obvious. The quickest way to lose customer trust is to trap them in a confused bot loop.
