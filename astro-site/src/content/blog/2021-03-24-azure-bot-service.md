---
title: Building Intelligent Bots with Azure Bot Service
description: "I've built bot projects with the Bot Framework that I'm proud of, and bot projects that I wish I could forget. The difference is almost always scope…"
author: Michael John Pena
draft: false
date: 2021-03-24
url: /blog/azure-bot-service/
tags:
  - Azure
  - Bot Service
  - Chatbots
  - Conversational AI
  - NLP
---

I've built bot projects with the Bot Framework that I'm proud of, and bot projects that I wish I could forget. The difference is almost always scope discipline in the first week. Azure Bot Service is the managed hosting layer; the Bot Framework SDK is where the logic lives. LUIS or QnA Maker or CLU handles the NLU. Adaptive Dialogs vs. waterfall dialogs affects how the conversation flow is modelled. Channel-specific formatting means the same card that renders beautifully in Teams looks broken in a web chat widget. Today's post is the architecture that works, and the design traps that look reasonable until you're two months into the project.

## Creating a Bot with Bot Framework SDK

```bash
# Install Bot Framework CLI
npm install -g @microsoft/botframework-cli

# Create a new bot project
mkdir mybot && cd mybot
npm init -y
npm install botbuilder botbuilder-dialogs
```

### Basic Echo Bot

```javascript
// index.js
const { ActivityHandler, MessageFactory } = require('botbuilder');
const restify = require('restify');
const { BotFrameworkAdapter } = require('botbuilder');

// Create adapter
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword
});

// Error handler
adapter.onTurnError = async (context, error) => {
    console.error(`Error: ${error}`);
    await context.sendActivity('Sorry, something went wrong.');
};

// Bot logic
class EchoBot extends ActivityHandler {
    constructor() {
        super();

        this.onMessage(async (context, next) => {
            const userMessage = context.activity.text;
            await context.sendActivity(`You said: ${userMessage}`);
            await next();
        });

        this.onMembersAdded(async (context, next) => {
            for (const member of context.activity.membersAdded) {
                if (member.id !== context.activity.recipient.id) {
                    await context.sendActivity('Welcome! How can I help you today?');
                }
            }
            await next();
        });
    }
}

// Create bot
const bot = new EchoBot();

// Create HTTP server
const server = restify.createServer();
server.listen(process.env.port || 3978, () => {
    console.log(`Bot listening on port ${server.address().port}`);
});

// Listen for messages
server.post('/api/messages', (req, res) => {
    adapter.processActivity(req, res, async (context) => {
        await bot.run(context);
    });
});
```

### Dialog-Based Bot

```javascript
// dialogs/orderDialog.js
const {
    ComponentDialog,
    WaterfallDialog,
    TextPrompt,
    ChoicePrompt,
    ConfirmPrompt,
    NumberPrompt
} = require('botbuilder-dialogs');

const ORDER_DIALOG = 'orderDialog';
const PRODUCT_PROMPT = 'productPrompt';
const QUANTITY_PROMPT = 'quantityPrompt';
const CONFIRM_PROMPT = 'confirmPrompt';

class OrderDialog extends ComponentDialog {
    constructor() {
        super(ORDER_DIALOG);

        // Add prompts
        this.addDialog(new ChoicePrompt(PRODUCT_PROMPT));
        this.addDialog(new NumberPrompt(QUANTITY_PROMPT, this.quantityValidator));
        this.addDialog(new ConfirmPrompt(CONFIRM_PROMPT));

        // Add waterfall dialog
        this.addDialog(new WaterfallDialog('orderWaterfall', [
            this.productStep.bind(this),
            this.quantityStep.bind(this),
            this.confirmStep.bind(this),
            this.finalStep.bind(this)
        ]));

        this.initialDialogId = 'orderWaterfall';
    }

    async productStep(stepContext) {
        return await stepContext.prompt(PRODUCT_PROMPT, {
            prompt: 'What would you like to order?',
            choices: ['Pizza', 'Burger', 'Salad', 'Pasta']
        });
    }

    async quantityStep(stepContext) {
        stepContext.values.product = stepContext.result.value;
        return await stepContext.prompt(QUANTITY_PROMPT, {
            prompt: `How many ${stepContext.values.product}s would you like?`,
            retryPrompt: 'Please enter a valid number (1-10).'
        });
    }

    async confirmStep(stepContext) {
        stepContext.values.quantity = stepContext.result;
        const product = stepContext.values.product;
        const quantity = stepContext.values.quantity;

        return await stepContext.prompt(CONFIRM_PROMPT, {
            prompt: `You want ${quantity} ${product}(s). Is that correct?`
        });
    }

    async finalStep(stepContext) {
        if (stepContext.result) {
            const order = {
                product: stepContext.values.product,
                quantity: stepContext.values.quantity
            };

            await stepContext.context.sendActivity(
                `Great! Your order for ${order.quantity} ${order.product}(s) has been placed.`
            );
            return await stepContext.endDialog(order);
        } else {
            await stepContext.context.sendActivity('Order cancelled.');
            return await stepContext.endDialog();
        }
    }

    async quantityValidator(promptContext) {
        const value = promptContext.recognized.value;
        return value >= 1 && value <= 10;
    }
}

module.exports.OrderDialog = OrderDialog;
```

### Main Bot with Dialogs

```javascript
// bot.js
const { ActivityHandler } = require('botbuilder');
const { DialogSet, DialogTurnStatus } = require('botbuilder-dialogs');
const { OrderDialog } = require('./dialogs/orderDialog');

class MainBot extends ActivityHandler {
    constructor(conversationState, userState) {
        super();

        this.conversationState = conversationState;
        this.userState = userState;

        // Dialog state accessor
        this.dialogState = this.conversationState.createProperty('DialogState');

        // Create dialog set
        this.dialogs = new DialogSet(this.dialogState);
        this.dialogs.add(new OrderDialog());

        this.onMessage(async (context, next) => {
            const dc = await this.dialogs.createContext(context);

            // Continue active dialog
            const result = await dc.continueDialog();

            if (result.status === DialogTurnStatus.empty) {
                const text = context.activity.text.toLowerCase();

                if (text.includes('order') || text.includes('buy')) {
                    await dc.beginDialog('orderDialog');
                } else if (text.includes('help')) {
                    await context.sendActivity(
                        'I can help you place orders. Try saying "I want to order".'
                    );
                } else {
                    await context.sendActivity(
                        `I heard: "${context.activity.text}". Say "help" for assistance.`
                    );
                }
            }

            await next();
        });

        this.onDialog(async (context, next) => {
            await this.conversationState.saveChanges(context);
            await this.userState.saveChanges(context);
            await next();
        });
    }
}

module.exports.MainBot = MainBot;
```

## Integrating LUIS for Natural Language Understanding

```javascript
// recognizers/luisRecognizer.js
const { LuisRecognizer } = require('botbuilder-ai');

class OrderRecognizer {
    constructor(config) {
        const luisIsConfigured = config && config.applicationId && config.endpointKey && config.endpoint;
        if (luisIsConfigured) {
            const recognizerOptions = {
                apiVersion: 'v3'
            };

            this.recognizer = new LuisRecognizer(config, recognizerOptions);
        }
    }

    get isConfigured() {
        return this.recognizer !== undefined;
    }

    async executeLuisQuery(context) {
        return await this.recognizer.recognize(context);
    }

    getProductEntity(result) {
        let product;
        if (result.entities.$instance.Product) {
            product = result.entities.$instance.Product[0].text;
        }
        return product;
    }

    getQuantityEntity(result) {
        let quantity;
        if (result.entities.number) {
            quantity = result.entities.number[0];
        }
        return quantity;
    }
}

// Usage in bot
class SmartBot extends ActivityHandler {
    constructor(conversationState, userState, luisRecognizer) {
        super();
        this.luisRecognizer = luisRecognizer;

        this.onMessage(async (context, next) => {
            if (this.luisRecognizer.isConfigured) {
                const luisResult = await this.luisRecognizer.executeLuisQuery(context);
                const intent = LuisRecognizer.topIntent(luisResult);

                switch (intent) {
                    case 'PlaceOrder':
                        const product = this.luisRecognizer.getProductEntity(luisResult);
                        const quantity = this.luisRecognizer.getQuantityEntity(luisResult);
                        await context.sendActivity(
                            `Got it! Ordering ${quantity || 1} ${product || 'item(s)'}.`
                        );
                        break;
                    case 'CheckStatus':
                        await context.sendActivity('Let me check your order status...');
                        break;
                    case 'Help':
                        await context.sendActivity('I can help you place and track orders.');
                        break;
                    default:
                        await context.sendActivity("I didn't understand. Try 'order a pizza'.");
                }
            }
            await next();
        });
    }
}
```

## Adaptive Cards for Rich UI

```javascript
// cards/orderCard.js
function createOrderCard(order) {
    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.3',
        body: [
            {
                type: 'TextBlock',
                size: 'Large',
                weight: 'Bolder',
                text: 'Order Confirmation'
            },
            {
                type: 'FactSet',
                facts: [
                    { title: 'Order ID', value: order.id },
                    { title: 'Product', value: order.product },
                    { title: 'Quantity', value: order.quantity.toString() },
                    { title: 'Total', value: `$${order.total.toFixed(2)}` },
                    { title: 'Status', value: order.status }
                ]
            },
            {
                type: 'TextBlock',
                text: `Estimated delivery: ${order.deliveryTime}`,
                wrap: true
            }
        ],
        actions: [
            {
                type: 'Action.Submit',
                title: 'Track Order',
                data: { action: 'track', orderId: order.id }
            },
            {
                type: 'Action.Submit',
                title: 'Cancel Order',
                data: { action: 'cancel', orderId: order.id }
            }
        ]
    };
}

// Send card
const { CardFactory } = require('botbuilder');

async function sendOrderConfirmation(context, order) {
    const card = CardFactory.adaptiveCard(createOrderCard(order));
    await context.sendActivity({ attachments: [card] });
}
```

## Multi-Channel Deployment

```javascript
// Deploy to multiple channels
// Azure portal configuration for channels:
// - Microsoft Teams
// - Slack
// - Facebook Messenger
// - Web Chat
// - Direct Line

// Web Chat embed
const webChatHtml = `
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdn.botframework.com/botframework-webchat/latest/webchat.js"></script>
</head>
<body>
    <div id="webchat" style="height: 500px; width: 400px;"></div>
    <script>
        window.WebChat.renderWebChat({
            directLine: window.WebChat.createDirectLine({
                token: 'YOUR_DIRECT_LINE_TOKEN'
            }),
            userID: 'user123',
            username: 'User',
            locale: 'en-US'
        }, document.getElementById('webchat'));
    </script>
</body>
</html>
`;

// Direct Line token exchange
const { DirectLine } = require('botframework-directlinejs');

async function getDirectLineToken() {
    const response = await fetch(
        'https://directline.botframework.com/v3/directline/tokens/generate',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.DIRECT_LINE_SECRET}`
            }
        }
    );
    const data = await response.json();
    return data.token;
}
```

## Proactive Messaging

```javascript
// Store conversation references
const conversationReferences = {};

class ProactiveBot extends ActivityHandler {
    constructor() {
        super();

        this.onConversationUpdate(async (context, next) => {
            // Store reference for proactive messaging
            const ref = TurnContext.getConversationReference(context.activity);
            conversationReferences[ref.user.id] = ref;
            await next();
        });
    }
}

// Send proactive message
async function sendProactiveMessage(userId, message) {
    const ref = conversationReferences[userId];
    if (ref) {
        await adapter.continueConversation(ref, async (context) => {
            await context.sendActivity(message);
        });
    }
}

// Example: Send order status update
async function notifyOrderUpdate(userId, order) {
    await sendProactiveMessage(
        userId,
        `Your order #${order.id} status has been updated to: ${order.status}`
    );
}
```

## Testing the Bot

```javascript
// test/bot.test.js
const { TestAdapter } = require('botbuilder');
const { MainBot } = require('../bot');

describe('MainBot', () => {
    let adapter;
    let bot;

    beforeEach(() => {
        adapter = new TestAdapter();
        bot = new MainBot();
    });

    test('should greet new user', async () => {
        await adapter
            .send('hi')
            .assertReply((activity) => {
                expect(activity.text).toContain('help');
            });
    });

    test('should start order dialog', async () => {
        await adapter
            .send('I want to order')
            .assertReply((activity) => {
                expect(activity.text).toContain('What would you like to order');
            });
    });
});
```

## Conclusion

Azure Bot Service enables building sophisticated conversational experiences:

- **Multi-turn dialogs** for complex conversations
- **LUIS integration** for natural language understanding
- **Adaptive Cards** for rich visual experiences
- **Multi-channel** deployment to Teams, Slack, Web, and more
- **Proactive messaging** for notifications and alerts

Combined with QnA Maker and other Cognitive Services, you can build intelligent assistants that truly understand and help users.
