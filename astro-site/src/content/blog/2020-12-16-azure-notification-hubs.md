---
title: "Azure Notification Hubs: Push Notifications at Scale"
author: Michael John Peña
draft: false
date: 2020-12-16
tags:
  - Azure
  - Notification Hubs
  - Push Notifications
  - Mobile
---

Push notifications look easy until you're maintaining four sets of credentials (APNs, FCM, WNS, ADM) and writing platform-specific payloads for each. Notification Hubs is the abstraction I gladly hand off to. One API, one tag/template model, fanout to millions of devices. The audit log when a marketing team sends "wrong button" to 3 million customers also makes great post-incident reading.

## Supported Platforms

| Platform | Service |
|----------|---------|
| iOS | APNs |
| Android | FCM |
| Windows | WNS |
| Amazon | ADM |
| Baidu | Baidu Cloud Push |
| Web | Web Push |

## Creating Notification Hub

```bash
# Create namespace
az notification-hub namespace create \
    --name my-hub-namespace \
    --resource-group myRG \
    --location eastus \
    --sku Standard

# Create hub
az notification-hub create \
    --name my-notification-hub \
    --namespace-name my-hub-namespace \
    --resource-group myRG
```

## Configure Platform Credentials

```bash
# iOS (APNs)
az notification-hub credential apns update \
    --namespace-name my-hub-namespace \
    --notification-hub-name my-notification-hub \
    --resource-group myRG \
    --apns-certificate /path/to/cert.p12 \
    --certificate-key "certificate-password"

# Android (FCM)
az notification-hub credential gcm update \
    --namespace-name my-hub-namespace \
    --notification-hub-name my-notification-hub \
    --resource-group myRG \
    --google-api-key "your-fcm-server-key"
```

## Register Device

```csharp
// .NET backend
using Microsoft.Azure.NotificationHubs;

var hub = NotificationHubClient.CreateClientFromConnectionString(
    connectionString,
    hubName
);

// Register iOS device
var registration = await hub.CreateAppleNativeRegistrationAsync(
    deviceToken,
    new[] { "user:123", "topic:sports" }  // Tags
);

// Register Android device
var registration = await hub.CreateFcmNativeRegistrationAsync(
    deviceToken,
    new[] { "user:123", "topic:news" }
);
```

## Send Notifications

```csharp
// Send to all iOS devices
await hub.SendAppleNativeNotificationAsync(
    @"{""aps"":{""alert"":""Hello from Azure!"",""badge"":1}}"
);

// Send to all Android devices
await hub.SendFcmNativeNotificationAsync(
    @"{""notification"":{""title"":""Hello"",""body"":""Message from Azure""}}"
);

// Send to specific tags
await hub.SendAppleNativeNotificationAsync(
    @"{""aps"":{""alert"":""Sports update!""}}",
    "topic:sports"
);

// Send with tag expression
await hub.SendAppleNativeNotificationAsync(
    @"{""aps"":{""alert"":""Personal notification""}}",
    "user:123 && (topic:sports || topic:news)"
);
```

## Template Notifications

```csharp
// Register with template (iOS)
var template = @"{""aps"":{""alert"":""$(message)""}}";
await hub.CreateAppleTemplateRegistrationAsync(
    deviceToken,
    template,
    new[] { "user:123" }
);

// Register with template (Android)
var template = @"{""notification"":{""title"":""$(title)"",""body"":""$(message)""}}";
await hub.CreateFcmTemplateRegistrationAsync(
    deviceToken,
    template,
    new[] { "user:123" }
);

// Send template notification (works for all platforms)
var notification = new Dictionary<string, string>
{
    { "message", "Hello from template!" },
    { "title", "Notification" }
};
await hub.SendTemplateNotificationAsync(notification, "user:123");
```

## Scheduled Notifications

```csharp
// Schedule for later
var scheduledTime = DateTimeOffset.UtcNow.AddHours(1);
await hub.ScheduleNotificationAsync(
    new AppleNotification(@"{""aps"":{""alert"":""Reminder!""}}"),
    scheduledTime,
    "user:123"
);
```

## Mobile App Integration

```swift
// iOS - Register for notifications
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let hub = SBNotificationHub(connectionString: connectionString, notificationHubPath: hubName)

    hub?.registerNative(withDeviceToken: deviceToken, tags: ["user:123"]) { error in
        if let error = error {
            print("Registration failed: \(error)")
        } else {
            print("Registration successful")
        }
    }
}
```

```kotlin
// Android - Register with FCM token
FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
    val hub = NotificationHub(hubName, connectionString, context)
    hub.register(token, "user:123", "topic:news")
}
```

## Telemetry

```bash
# View hub metrics
az monitor metrics list \
    --resource /subscriptions/.../notificationHubs/my-notification-hub \
    --metric "incoming" "outgoing.allpns.success" "outgoing.allpns.pnserror"
```

Notification Hubs: push to millions in seconds.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
