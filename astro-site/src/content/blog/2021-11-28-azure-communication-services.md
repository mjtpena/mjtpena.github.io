---
title: "Azure Communication Services: Build Communication Apps with Azure"
description: "Azure Communication Services enables developers to build rich communication experiences that can interoperate with Microsoft Teams. Whether you need voice…"
author: Michael John Pena
draft: false
date: 2021-11-28
tags:
  - Azure
  - Communication
  - Teams
  - Voice
  - Video
  - Chat
---

## What is Azure Communication Services?

ACS provides:

- **Voice and Video**: Real-time calling capabilities
- **Chat**: Persistent messaging
- **SMS**: Send and receive text messages
- **Email**: Transactional email
- **Teams Interoperability**: Connect with Teams users

## Getting Started

### Create Resource

```bash
# Create ACS resource
az communication create \
    --name myacsresource \
    --resource-group rg-communication \
    --location global \
    --data-location unitedstates

# Get connection string
az communication list-key \
    --name myacsresource \
    --resource-group rg-communication
```

### Install SDKs

```bash
# Node.js
npm install @azure/communication-identity
npm install @azure/communication-calling
npm install @azure/communication-chat
npm install @azure/communication-sms

# .NET
dotnet add package Azure.Communication.Identity
dotnet add package Azure.Communication.Calling
dotnet add package Azure.Communication.Chat
dotnet add package Azure.Communication.Sms
```

## Identity and Access Tokens

### Creating Users and Tokens

```csharp
using Azure.Communication;
using Azure.Communication.Identity;

public class CommunicationService
{
    private readonly CommunicationIdentityClient _identityClient;

    public CommunicationService(string connectionString)
    {
        _identityClient = new CommunicationIdentityClient(connectionString);
    }

    public async Task<UserAccessInfo> CreateUserWithTokenAsync()
    {
        // Create a new user
        var user = await _identityClient.CreateUserAsync();

        // Issue access token with specific scopes
        var tokenResponse = await _identityClient.GetTokenAsync(
            user.Value,
            scopes: new[] { CommunicationTokenScope.Chat, CommunicationTokenScope.VoIP }
        );

        return new UserAccessInfo
        {
            UserId = user.Value.Id,
            AccessToken = tokenResponse.Value.Token,
            ExpiresOn = tokenResponse.Value.ExpiresOn
        };
    }

    public async Task<string> RefreshTokenAsync(string userId)
    {
        var user = new CommunicationUserIdentifier(userId);

        var tokenResponse = await _identityClient.GetTokenAsync(
            user,
            scopes: new[] { CommunicationTokenScope.Chat, CommunicationTokenScope.VoIP }
        );

        return tokenResponse.Value.Token;
    }

    public async Task RevokeTokensAsync(string userId)
    {
        var user = new CommunicationUserIdentifier(userId);
        await _identityClient.RevokeTokensAsync(user);
    }

    public async Task DeleteUserAsync(string userId)
    {
        var user = new CommunicationUserIdentifier(userId);
        await _identityClient.DeleteUserAsync(user);
    }
}

public record UserAccessInfo
{
    public string UserId { get; init; }
    public string AccessToken { get; init; }
    public DateTimeOffset ExpiresOn { get; init; }
}
```

## Voice and Video Calling

### Web Client Setup

```javascript
// Install: npm install @azure/communication-calling @azure/communication-common

import { CallClient, CallAgent } from '@azure/communication-calling';
import { AzureCommunicationTokenCredential } from '@azure/communication-common';

class CallingService {
    constructor() {
        this.callClient = new CallClient();
        this.callAgent = null;
        this.currentCall = null;
    }

    async initialize(accessToken) {
        const tokenCredential = new AzureCommunicationTokenCredential(accessToken);

        this.callAgent = await this.callClient.createCallAgent(tokenCredential, {
            displayName: 'User Display Name'
        });

        // Listen for incoming calls
        this.callAgent.on('incomingCall', this.handleIncomingCall.bind(this));
    }

    async startCall(userIds, options = {}) {
        const participants = userIds.map(id => ({ communicationUserId: id }));

        const callOptions = {
            videoOptions: {
                localVideoStreams: options.localVideoStream ? [options.localVideoStream] : undefined
            },
            audioOptions: {
                muted: options.startMuted || false
            }
        };

        this.currentCall = this.callAgent.startCall(participants, callOptions);
        this.setupCallListeners();

        return this.currentCall;
    }

    async joinMeeting(meetingLink) {
        const locator = { meetingLink: meetingLink };

        this.currentCall = this.callAgent.join(locator, {
            videoOptions: { localVideoStreams: [] }
        });

        this.setupCallListeners();
        return this.currentCall;
    }

    handleIncomingCall(event) {
        const incomingCall = event.incomingCall;

        // Accept the call
        this.currentCall = await incomingCall.accept({
            videoOptions: { localVideoStreams: [] }
        });

        this.setupCallListeners();
    }

    setupCallListeners() {
        this.currentCall.on('stateChanged', () => {
            console.log(`Call state: ${this.currentCall.state}`);
        });

        this.currentCall.on('remoteParticipantsUpdated', (event) => {
            event.added.forEach(participant => {
                console.log(`Participant joined: ${participant.displayName}`);
                this.subscribeToParticipant(participant);
            });

            event.removed.forEach(participant => {
                console.log(`Participant left: ${participant.displayName}`);
            });
        });
    }

    subscribeToParticipant(participant) {
        participant.on('videoStreamsUpdated', (event) => {
            event.added.forEach(stream => {
                this.renderRemoteVideo(stream);
            });
        });
    }

    async renderRemoteVideo(stream) {
        const renderer = new VideoStreamRenderer(stream);
        const view = await renderer.createView();
        document.getElementById('remote-video').appendChild(view.target);
    }

    async toggleMute() {
        if (this.currentCall.isMuted) {
            await this.currentCall.unmute();
        } else {
            await this.currentCall.mute();
        }
    }

    async toggleVideo() {
        const localVideoStream = this.currentCall.localVideoStreams[0];

        if (localVideoStream) {
            await this.currentCall.stopVideo(localVideoStream);
        } else {
            const cameras = await this.callClient.getDeviceManager().getCameras();
            const camera = cameras[0];
            const newLocalVideoStream = new LocalVideoStream(camera);
            await this.currentCall.startVideo(newLocalVideoStream);
        }
    }

    async endCall() {
        await this.currentCall.hangUp();
        this.currentCall = null;
    }
}
```

## Chat

### Chat Implementation

```csharp
using Azure.Communication.Chat;
using Azure.Communication;

public class ChatService
{
    private readonly ChatClient _chatClient;

    public ChatService(string endpoint, string accessToken)
    {
        _chatClient = new ChatClient(
            new Uri(endpoint),
            new CommunicationTokenCredential(accessToken)
        );
    }

    public async Task<string> CreateChatThreadAsync(string topic, IEnumerable<string> participantIds)
    {
        var participants = participantIds.Select(id =>
            new ChatParticipant(new CommunicationUserIdentifier(id))
        ).ToList();

        var result = await _chatClient.CreateChatThreadAsync(
            topic: topic,
            participants: participants
        );

        return result.Value.ChatThread.Id;
    }

    public async Task SendMessageAsync(string threadId, string content, string senderDisplayName)
    {
        var chatThreadClient = _chatClient.GetChatThreadClient(threadId);

        await chatThreadClient.SendMessageAsync(
            content: content,
            type: ChatMessageType.Text,
            senderDisplayName: senderDisplayName
        );
    }

    public async IAsyncEnumerable<ChatMessage> GetMessagesAsync(string threadId, DateTimeOffset? startTime = null)
    {
        var chatThreadClient = _chatClient.GetChatThreadClient(threadId);

        await foreach (var message in chatThreadClient.GetMessagesAsync(startTime))
        {
            yield return message;
        }
    }

    public async Task AddParticipantAsync(string threadId, string userId, string displayName)
    {
        var chatThreadClient = _chatClient.GetChatThreadClient(threadId);

        await chatThreadClient.AddParticipantAsync(
            new ChatParticipant(new CommunicationUserIdentifier(userId))
            {
                DisplayName = displayName
            }
        );
    }

    public async Task RemoveParticipantAsync(string threadId, string userId)
    {
        var chatThreadClient = _chatClient.GetChatThreadClient(threadId);

        await chatThreadClient.RemoveParticipantAsync(
            new CommunicationUserIdentifier(userId)
        );
    }

    public async Task SendTypingIndicatorAsync(string threadId)
    {
        var chatThreadClient = _chatClient.GetChatThreadClient(threadId);
        await chatThreadClient.SendTypingNotificationAsync();
    }

    public async Task SendReadReceiptAsync(string threadId, string messageId)
    {
        var chatThreadClient = _chatClient.GetChatThreadClient(threadId);
        await chatThreadClient.SendReadReceiptAsync(messageId);
    }
}
```

### Real-Time Chat with SignalR

```javascript
// chat-client.js
import { ChatClient } from '@azure/communication-chat';
import { AzureCommunicationTokenCredential } from '@azure/communication-common';

class ChatService {
    constructor() {
        this.chatClient = null;
        this.chatThreadClient = null;
    }

    async initialize(endpoint, accessToken) {
        const credential = new AzureCommunicationTokenCredential(accessToken);
        this.chatClient = new ChatClient(endpoint, credential);

        // Start receiving real-time notifications
        await this.chatClient.startRealtimeNotifications();

        // Subscribe to events
        this.chatClient.on('chatMessageReceived', this.onMessageReceived.bind(this));
        this.chatClient.on('typingIndicatorReceived', this.onTypingIndicator.bind(this));
        this.chatClient.on('readReceiptReceived', this.onReadReceipt.bind(this));
        this.chatClient.on('participantsAdded', this.onParticipantsAdded.bind(this));
        this.chatClient.on('participantsRemoved', this.onParticipantsRemoved.bind(this));
    }

    async joinThread(threadId) {
        this.chatThreadClient = this.chatClient.getChatThreadClient(threadId);

        // Load existing messages
        const messages = [];
        for await (const message of this.chatThreadClient.listMessages()) {
            messages.push(message);
        }

        return messages.reverse();
    }

    async sendMessage(content) {
        const sendMessageRequest = {
            content: content
        };

        const result = await this.chatThreadClient.sendMessage(sendMessageRequest);
        return result.id;
    }

    onMessageReceived(event) {
        console.log('New message:', event);
        // Update UI with new message
    }

    onTypingIndicator(event) {
        console.log(`${event.senderDisplayName} is typing...`);
        // Show typing indicator in UI
    }

    onReadReceipt(event) {
        console.log('Message read:', event.chatMessageId);
        // Update read status in UI
    }

    onParticipantsAdded(event) {
        console.log('Participants added:', event.participantsAdded);
    }

    onParticipantsRemoved(event) {
        console.log('Participants removed:', event.participantsRemoved);
    }

    async disconnect() {
        await this.chatClient.stopRealtimeNotifications();
    }
}
```

## SMS

### Sending SMS

```csharp
using Azure.Communication.Sms;

public class SmsService
{
    private readonly SmsClient _smsClient;
    private readonly string _fromNumber;

    public SmsService(string connectionString, string fromNumber)
    {
        _smsClient = new SmsClient(connectionString);
        _fromNumber = fromNumber;
    }

    public async Task<SmsSendResult> SendSmsAsync(string toNumber, string message)
    {
        var response = await _smsClient.SendAsync(
            from: _fromNumber,
            to: toNumber,
            message: message,
            new SmsSendOptions(enableDeliveryReport: true)
            {
                Tag = "marketing"
            }
        );

        return response.Value.First();
    }

    public async Task<IEnumerable<SmsSendResult>> SendBulkSmsAsync(
        IEnumerable<string> toNumbers,
        string message)
    {
        var response = await _smsClient.SendAsync(
            from: _fromNumber,
            to: toNumbers,
            message: message,
            new SmsSendOptions(enableDeliveryReport: true)
        );

        return response.Value;
    }
}
```

## Teams Interoperability

### Join Teams Meeting

```javascript
// Join a Teams meeting as an ACS user
async function joinTeamsMeeting(meetingLink, accessToken, displayName) {
    const callClient = new CallClient();
    const tokenCredential = new AzureCommunicationTokenCredential(accessToken);

    const callAgent = await callClient.createCallAgent(tokenCredential, {
        displayName: displayName
    });

    // Join using Teams meeting link
    const call = callAgent.join(
        { meetingLink: meetingLink },
        {
            videoOptions: { localVideoStreams: [] }
        }
    );

    return call;
}

// Join using Teams meeting ID and passcode
async function joinTeamsMeetingById(meetingId, passcode, accessToken) {
    const callClient = new CallClient();
    const tokenCredential = new AzureCommunicationTokenCredential(accessToken);

    const callAgent = await callClient.createCallAgent(tokenCredential);

    const call = callAgent.join(
        {
            meetingId: meetingId,
            passcode: passcode
        },
        {}
    );

    return call;
}
```

Azure Communication Services enables developers to build rich communication experiences that can interoperate with Microsoft Teams. Whether you need voice, video, chat, or SMS, ACS provides the building blocks.

## Resources

- [Azure Communication Services Documentation](https://docs.microsoft.com/en-us/azure/communication-services/)
- [Calling SDK](https://docs.microsoft.com/en-us/azure/communication-services/concepts/voice-video-calling/calling-sdk-features)
- [Chat SDK](https://docs.microsoft.com/en-us/azure/communication-services/concepts/chat/sdk-features)
- [Teams Interop](https://docs.microsoft.com/en-us/azure/communication-services/concepts/teams-interop)
