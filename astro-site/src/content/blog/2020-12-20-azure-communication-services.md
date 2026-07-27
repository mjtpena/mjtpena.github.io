---
title: "Azure Communication Services: Voice, Video, Chat, SMS"
author: Michael John Peña
draft: false
date: 2020-12-20
tags:
  - Azure
  - Communication Services
  - Voice
  - Video

---

I wrote "Azure Communication Services: Voice, Video, Chat, SMS" to share practical, production-minded guidance on this topic.

## Creating ACS Resource

```bash
az communication create \
    --name my-acs \
    --resource-group myRG \
    --location global \
    --data-location UnitedStates
```

## User Identity

```javascript
const { CommunicationIdentityClient } = require('@azure/communication-identity');

const client = new CommunicationIdentityClient(connectionString);

// Create user
const user = await client.createUser();
console.log(`User ID: ${user.communicationUserId}`);

// Get access token
const tokenResponse = await client.getToken(user, ["voip", "chat"]);
console.log(`Token: ${tokenResponse.token}`);
console.log(`Expires: ${tokenResponse.expiresOn}`);
```

## Voice Calling

```javascript
const { CallClient, LocalVideoStream } = require('@azure/communication-calling');
const { AzureCommunicationTokenCredential } = require('@azure/communication-common');

const tokenCredential = new AzureCommunicationTokenCredential(accessToken);
const callClient = new CallClient();
const callAgent = await callClient.createCallAgent(tokenCredential);

// Make a call
const call = callAgent.startCall(
    [{ communicationUserId: 'recipient-user-id' }],
    { videoOptions: { localVideoStreams: [localVideoStream] } }
);

// Handle call events
call.on('stateChanged', () => {
    console.log(`Call state: ${call.state}`);
});

// End call
call.hangUp({ forEveryone: true });
```

## Video Call UI

```html
<div id="local-video-container"></div>
<div id="remote-video-container"></div>

<script>
async function startVideoCall() {
    const deviceManager = await callClient.getDeviceManager();
    const cameras = await deviceManager.getCameras();

    const localVideoStream = new LocalVideoStream(cameras[0]);
    const localVideoView = new VideoStreamRenderer(localVideoStream);
    const view = await localVideoView.createView();

    document.getElementById('local-video-container').appendChild(view.target);

    // Handle remote video
    call.on('remoteParticipantsUpdated', e => {
        e.added.forEach(participant => {
            participant.on('videoStreamsUpdated', e => {
                e.added.forEach(stream => {
                    const renderer = new VideoStreamRenderer(stream);
                    const view = await renderer.createView();
                    document.getElementById('remote-video-container').appendChild(view.target);
                });
            });
        });
    });
}
</script>
```

## Chat

```javascript
const { ChatClient } = require('@azure/communication-chat');

const chatClient = new ChatClient(endpoint, tokenCredential);

// Create chat thread
const createChatThreadResult = await chatClient.createChatThread({
    topic: "Project Discussion"
}, {
    participants: [
        { id: { communicationUserId: 'user1' }, displayName: 'Alice' },
        { id: { communicationUserId: 'user2' }, displayName: 'Bob' }
    ]
});

const threadId = createChatThreadResult.chatThread.id;
const chatThreadClient = chatClient.getChatThreadClient(threadId);

// Send message
await chatThreadClient.sendMessage({
    content: 'Hello everyone!'
});

// Receive messages
for await (const message of chatThreadClient.listMessages()) {
    console.log(`${message.senderDisplayName}: ${message.content.message}`);
}

// Real-time events
chatClient.on('chatMessageReceived', (message) => {
    console.log(`New message: ${message.message}`);
});
```

## SMS

```javascript
const { SmsClient } = require('@azure/communication-sms');

const smsClient = new SmsClient(connectionString);

// Send SMS
const sendResults = await smsClient.send({
    from: '+18001234567',
    to: ['+14255551234'],
    message: 'Hello from Azure Communication Services!'
});

console.log(`Message ID: ${sendResults[0].messageId}`);
console.log(`Success: ${sendResults[0].successful}`);
```

## Email (Preview)

```javascript
const { EmailClient } = require('@azure/communication-email');

const client = new EmailClient(connectionString);

const message = {
    senderAddress: 'no-reply@mycompany.com',
    content: {
        subject: 'Welcome!',
        plainText: 'Welcome to our service.',
        html: '<h1>Welcome!</h1><p>Thanks for signing up.</p>'
    },
    recipients: {
        to: [{ address: 'user@example.com', displayName: 'User' }]
    }
};

const poller = await client.beginSend(message);
const result = await poller.pollUntilDone();
```

## Teams Interop

```javascript
// Join Teams meeting
const locator = { meetingLink: 'https://teams.microsoft.com/l/meetup-join/...' };
const call = callAgent.join(locator);
```

Azure Communication Services: Teams-grade communication in your apps.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
