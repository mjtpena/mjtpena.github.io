---
title: "Azure Communication Services: Building Connected Experiences"
author: Michael John Peña
draft: false
date: 2022-05-10
tags:
  - Azure
  - Communication
  - Real-Time
  - WebRTC
---

## Core Capabilities

- Voice and video calling
- Chat messaging
- SMS messaging
- Email communication
- Phone number management

## Setting Up ACS

Create and configure your Communication Services resource:

```bash
# Create resource
az communication create \
    --name my-acs-resource \
    --resource-group communication-rg \
    --location global \
    --data-location unitedstates

# Get connection string
az communication list-key \
    --name my-acs-resource \
    --resource-group communication-rg
```

## User Identity and Tokens

Manage user identities and access tokens:

```csharp
using Azure.Communication;
using Azure.Communication.Identity;

public class IdentityService
{
    private readonly CommunicationIdentityClient _identityClient;

    public IdentityService(string connectionString)
    {
        _identityClient = new CommunicationIdentityClient(connectionString);
    }

    public async Task<(string UserId, string Token)> CreateUserWithTokenAsync()
    {
        // Create user and token in one call
        var response = await _identityClient.CreateUserAndTokenAsync(
            scopes: new[]
            {
                CommunicationTokenScope.Chat,
                CommunicationTokenScope.VoIP
            });

        return (
            response.Value.User.Id,
            response.Value.AccessToken.Token
        );
    }

    public async Task<string> RefreshTokenAsync(string userId)
    {
        var user = new CommunicationUserIdentifier(userId);

        var tokenResponse = await _identityClient.GetTokenAsync(
            user,
            scopes: new[]
            {
                CommunicationTokenScope.Chat,
                CommunicationTokenScope.VoIP
            });

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
```

## Video Calling with JavaScript

Implement video calling in a web application:

```typescript
// calling.ts
import {
  CallClient,
  CallAgent,
  Call,
  LocalVideoStream,
  VideoStreamRenderer,
  RemoteParticipant,
} from "@azure/communication-calling";
import { AzureCommunicationTokenCredential } from "@azure/communication-common";

class VideoCallService {
  private callClient: CallClient;
  private callAgent: CallAgent | null = null;
  private currentCall: Call | null = null;
  private localVideoStream: LocalVideoStream | null = null;

  constructor() {
    this.callClient = new CallClient();
  }

  async initialize(token: string, displayName: string): Promise<void> {
    const tokenCredential = new AzureCommunicationTokenCredential(token);

    this.callAgent = await this.callClient.createCallAgent(tokenCredential, {
      displayName,
    });

    // Listen for incoming calls
    this.callAgent.on("incomingCall", async (event) => {
      const incomingCall = event.incomingCall;
      console.log("Incoming call from:", incomingCall.callerInfo.displayName);

      // Auto-answer or show UI
      this.currentCall = await incomingCall.accept({
        videoOptions: { localVideoStreams: [] },
      });

      this.setupCallListeners();
    });
  }

  async startCall(participantIds: string[]): Promise<void> {
    if (!this.callAgent) {
      throw new Error("Call agent not initialized");
    }

    const participants = participantIds.map(
      (id) => ({ communicationUserId: id })
    );

    // Get camera
    const deviceManager = await this.callClient.getDeviceManager();
    const cameras = await deviceManager.getCameras();

    if (cameras.length > 0) {
      this.localVideoStream = new LocalVideoStream(cameras[0]);
    }

    this.currentCall = this.callAgent.startCall(participants, {
      videoOptions: this.localVideoStream
        ? { localVideoStreams: [this.localVideoStream] }
        : undefined,
      audioOptions: { muted: false },
    });

    this.setupCallListeners();
  }

  private setupCallListeners(): void {
    if (!this.currentCall) return;

    this.currentCall.on("stateChanged", () => {
      console.log("Call state:", this.currentCall?.state);
    });

    this.currentCall.on("remoteParticipantsUpdated", (event) => {
      event.added.forEach((participant) => {
        this.subscribeToParticipant(participant);
      });
    });
  }

  private subscribeToParticipant(participant: RemoteParticipant): void {
    participant.on("videoStreamsUpdated", (event) => {
      event.added.forEach(async (stream) => {
        const renderer = new VideoStreamRenderer(stream);
        const view = await renderer.createView();
        document.getElementById("remote-video")?.appendChild(view.target);
      });
    });
  }

  async toggleVideo(): Promise<void> {
    if (!this.currentCall) return;

    if (this.localVideoStream) {
      await this.currentCall.stopVideo(this.localVideoStream);
      this.localVideoStream = null;
    } else {
      const deviceManager = await this.callClient.getDeviceManager();
      const cameras = await deviceManager.getCameras();
      if (cameras.length > 0) {
        this.localVideoStream = new LocalVideoStream(cameras[0]);
        await this.currentCall.startVideo(this.localVideoStream);
      }
    }
  }

  async toggleMute(): Promise<void> {
    if (!this.currentCall) return;

    if (this.currentCall.isMuted) {
      await this.currentCall.unmute();
    } else {
      await this.currentCall.mute();
    }
  }

  async endCall(): Promise<void> {
    await this.currentCall?.hangUp();
    this.currentCall = null;
  }
}

export const videoCallService = new VideoCallService();
```

## Chat Implementation

Build real-time chat functionality:

```csharp
using Azure.Communication.Chat;

public class ChatService
{
    private readonly ChatClient _chatClient;

    public ChatService(string endpoint, string token)
    {
        var credential = new CommunicationTokenCredential(token);
        _chatClient = new ChatClient(new Uri(endpoint), credential);
    }

    public async Task<string> CreateChatThreadAsync(
        string topic,
        IEnumerable<string> participantIds)
    {
        var participants = participantIds.Select(id =>
            new ChatParticipant(new CommunicationUserIdentifier(id)));

        var response = await _chatClient.CreateChatThreadAsync(
            topic,
            participants);

        return response.Value.ChatThread.Id;
    }

    public async Task SendMessageAsync(string threadId, string content)
    {
        var chatThreadClient = _chatClient.GetChatThreadClient(threadId);

        await chatThreadClient.SendMessageAsync(
            content,
            ChatMessageType.Text);
    }

    public async Task<IEnumerable<ChatMessage>> GetMessagesAsync(
        string threadId,
        int pageSize = 50)
    {
        var chatThreadClient = _chatClient.GetChatThreadClient(threadId);
        var messages = new List<ChatMessage>();

        await foreach (var message in chatThreadClient.GetMessagesAsync())
        {
            messages.Add(message);
            if (messages.Count >= pageSize) break;
        }

        return messages;
    }

    public async Task AddParticipantAsync(string threadId, string userId, string displayName)
    {
        var chatThreadClient = _chatClient.GetChatThreadClient(threadId);

        var participant = new ChatParticipant(
            new CommunicationUserIdentifier(userId))
        {
            DisplayName = displayName
        };

        await chatThreadClient.AddParticipantAsync(participant);
    }
}
```

## Real-time Chat with SignalR

Subscribe to chat events:

```typescript
// chat-realtime.ts
import { ChatClient, ChatThreadClient } from "@azure/communication-chat";
import { AzureCommunicationTokenCredential } from "@azure/communication-common";

class RealtimeChatService {
  private chatClient: ChatClient;
  private threadClient: ChatThreadClient | null = null;

  constructor(endpoint: string, token: string) {
    const credential = new AzureCommunicationTokenCredential(token);
    this.chatClient = new ChatClient(endpoint, credential);
  }

  async connectToThread(threadId: string): Promise<void> {
    this.threadClient = this.chatClient.getChatThreadClient(threadId);

    // Start real-time notifications
    await this.chatClient.startRealtimeNotifications();

    // Listen for new messages
    this.chatClient.on("chatMessageReceived", (event) => {
      console.log("New message:", event.message);
      this.onMessageReceived(event);
    });

    // Listen for typing indicators
    this.chatClient.on("typingIndicatorReceived", (event) => {
      console.log("User typing:", event.senderDisplayName);
      this.onTypingIndicator(event);
    });

    // Listen for read receipts
    this.chatClient.on("readReceiptReceived", (event) => {
      console.log("Message read:", event.chatMessageId);
      this.onReadReceipt(event);
    });

    // Listen for participant changes
    this.chatClient.on("participantsAdded", (event) => {
      console.log("Participants added:", event.participantsAdded);
    });
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.threadClient) throw new Error("Not connected to thread");

    await this.threadClient.sendMessage({ content });
  }

  async sendTypingNotification(): Promise<void> {
    if (!this.threadClient) return;
    await this.threadClient.sendTypingNotification();
  }

  private onMessageReceived(event: any): void {
    // Update UI with new message
    const messageElement = document.createElement("div");
    messageElement.className = "chat-message";
    messageElement.innerHTML = `
      <span class="sender">${event.senderDisplayName}</span>
      <p class="content">${event.message}</p>
      <span class="timestamp">${new Date(event.createdOn).toLocaleTimeString()}</span>
    `;
    document.getElementById("chat-messages")?.appendChild(messageElement);
  }

  private onTypingIndicator(event: any): void {
    // Show typing indicator
    const indicator = document.getElementById("typing-indicator");
    if (indicator) {
      indicator.textContent = `${event.senderDisplayName} is typing...`;
      indicator.style.display = "block";
      setTimeout(() => {
        indicator.style.display = "none";
      }, 3000);
    }
  }

  private onReadReceipt(event: any): void {
    // Update message read status
    const messageEl = document.querySelector(
      `[data-message-id="${event.chatMessageId}"]`
    );
    if (messageEl) {
      messageEl.classList.add("read");
    }
  }
}
```

## SMS Messaging

Send SMS messages:

```csharp
using Azure.Communication.Sms;

public class SmsService
{
    private readonly SmsClient _smsClient;
    private readonly string _fromPhoneNumber;

    public SmsService(string connectionString, string fromPhoneNumber)
    {
        _smsClient = new SmsClient(connectionString);
        _fromPhoneNumber = fromPhoneNumber;
    }

    public async Task<string> SendSmsAsync(string toPhoneNumber, string message)
    {
        var response = await _smsClient.SendAsync(
            from: _fromPhoneNumber,
            to: toPhoneNumber,
            message: message,
            options: new SmsSendOptions(enableDeliveryReport: true)
            {
                Tag = "order-notification"
            });

        return response.Value.MessageId;
    }

    public async Task<IEnumerable<SmsSendResult>> SendBulkSmsAsync(
        IEnumerable<string> phoneNumbers,
        string message)
    {
        var response = await _smsClient.SendAsync(
            from: _fromPhoneNumber,
            to: phoneNumbers,
            message: message,
            options: new SmsSendOptions(enableDeliveryReport: true));

        return response.Value;
    }
}
```

## Summary

Azure Communication Services enables:

- Seamless voice and video calling
- Real-time chat with presence indicators
- SMS and email messaging
- Integration with Microsoft Teams
- Enterprise-grade security and compliance

Build rich communication experiences directly into your applications.
