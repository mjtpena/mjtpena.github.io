---
title: Developing MacOS Apps using .NET
author: MJ Peña
draft: false
date: 2021-07-23T02:19:19Z
url: /blog/developing-macos-apps-using-net/
images: 
     - /2021/07/maui.png
tags:
  - Mac
  - .NET
  - Mobile
  - Technology
---

The .NET framework (and the wider ecosystem) has embraced a lot of openness these past few years. Gone are the days when .NET only works on Windows. However, as the journey to "One .NET" is still unfolding, there is a lot of confusion on how we can use .NET on MacOS. There is Mono, .NET Core, .NET 5, Xamarin.Mac, Xamarin.Forms, Mac Catalyst, .NET 6, and MAUI. This blog post explains some of the core concepts across these nomenclature.

## Mono and .NET

- Mono is the original vision and execution of having .NET and C# available to non-Windows platform. The project has been around since 2004 and was as an alternative way of using .NET on MacOS. It's not officially supported by Microsoft (specially back then) and it's a project started by the legendary Miguel de Icaza who also started GNOME and eventually Xamarin.

- Mono can run not just on MacOS and Linux, but also on gaming and mobile operating systems like iOS, Android, and PlayStation. It's the roots of what's now called Xamarin.

## Xamarin

- Xamarin was the commercial spin-off of Mono for Mac, iOS, and Android. It was later acquired by Microsoft and became part of the wider Developer tools ecosystem such as Visual Studio and .NET. To understand how it relates specifically to Mac OS, we have to talk about Xamarin.Mac and Xamarin.Forms.
- ### Xamarin.Mac

  - It started as MonoMac and eventually carried out as Xamarin.Mac. These libraries create bindings between the native Mac OS APIs and exposed as C#. This allows you to create a Mac OS application written in C# instead of Objective-C/Swift.

  - Under the hood, it still uses XCode and follows the same principles like: AppDelegatre, Main, Entitlements, Plists, provisioning profiles, etc. Xamarin.Mac allows you to transpile the C# code into something that XCode will eventually compile to create the ".app" package.

  - In Xamarin.Mac (using Visual Studio for Mac) you can define your user interfaces using Storyboards and will invoke XCode for you to do the UI components and data bindings.

- ### Xamarin.Forms

  - Xamarin.Forms is a cross-platform UI framework that allows you to create native applications on MacOS, iOS, Android, Windows, and even Tizen OS. Unlike Xamarin.Mac, using Xamarin.Forms, you can use XAML and C# to create your components.

  - The advantage of this approach is the flexibility of targeting multiple platforms using the same code base. The result, however, is still native. Even if you coded your button in C# / XAML, the result is still a native MacOS button.

  - Under the hood, you would still have a Xamarin.Mac project that just calls the Xamarin.Forms project. It just abstracts the creation of the app in Xamarin.Forms layer.

  - You have the flexibility on your Xamarin.Forms project to only render components depending on the target platform: ie show this button on MacOS but not on Windows. You also have the flexibility of having a single function on Xamarin.Forms that implements differently on each platform: ie press this button and it will do X for MacOS and it will do Y for Windows.

## .NET 5 (Core)

- .NET 5 is now a general purpose framework to build apps targeting Windows, Linux, and MacOS. Unlike the traditional ".NET framework" which is exclusive to Windows, .NET 5 (previous iteration called .NET Core) is a step to create apps that can use MacOS as the host. Think of it you can now treat MacOS as the "server" host of your .NET app.

- What this means is that .NET 5 now supports the whole ASPNET family (Blazor, API, gRPC, React, Angular, Vue) on Mac. It also now supports console apps and worker services you would traditionally can do on a Windows machine. The power of this lies with having portable libraries such as ML.NET work on Mac as well.

- However, .NET 5 doesn't interface yet with Cocoa or the rich native libraries of MacOS like Xamarin.Mac does. More of that on .NET 6 onwards.

## Mac Catalyst

- Mac Catalyst is totally independent of .NET 6 or even Xamarin. It is basically Apple's approach of having shared libraries between Mac OS and the new iPad OS. This allows you to have unified and consistent components like pop-up buttons, tooltips, window's sidebar. This also allows you to share code for implementing GameKit, PassKit, Core Audio, Core Bluetooth amongst others.

- Unlike when the previous versions of iPad uses iOS, it's more of a mobile device using mobile libraries and frameworks and less of what you can do on Mac OS. This time around, it's now becoming a more unified experience between a tablet and laptop in the Apple ecosystem.

- In order to run Mac Catalyst, you need XCode 13 on either Big Sur or Monterey.

## .NET 6 and MAUI

- There are a lot of updates for .NET 6, and it's very exciting because this is really a borderless unified framework.

- .NET 6 introduced the concept of "workload" that allows you to install SDKs on top of the .NET 6 SDK to target specific platforms. What this means on Mac OS apps is that you can use .NET 6 as your base project and you're confident that it can execute those line of codes across all platforms. The "workload" is the platform specific SDKs and bindings to target that specific platform and leverage the native capabilities. Think of all the libraries that existed in the past and can now expand its reach to more platforms!

- .NET MAUI (Multi-platform App UI) is the evolution of Xamarin.Forms in combination of UWP. Imagine having a single unified UI approach in building apps that works across platform. Think of it in the future, you can port your legacy WinForms / WPF app to run on iPad OS with MAUI and MacCatalyst!

- These are the workloads that apply to MacOS
  - `dotnet workload install microsoft-macos-sdk-full`
  - `dotnet workload install microsoft-maccatalyst-sdk-full`
  - `dotnet workload install maui-maccatalyst`

![h:311 w:441 bg right](/2021/07/maui.png)

- If you're already familiar with Xamarin ecosystem, pretty much this is the simplified version:
  - Xamarin.Mac => Microsoft-MacOS
  - Xamarin.MaciOS + Mac Catalyst => Microsoft-MacCatalyst
  - Xamarin.Forms + UWP => **MAUI**

## Summary

- Mono is arguably the roots and inspiration on having .NET to run across all platforms (besides Windows).
- Xamarin made its way to having .NET runs commercially on MacOS and mobile platforms.
- .NET 5 is relevant right now to MacOS to host server-side applications, not client apps you install on your "Applications" folder.
- .NET 6 onwards creates an interesting take of having .NET to run everywhere! There are a lot of opportunities to share code between Web, Mobile, and IoT projects.
- MAUI is a road forward in creating rich and native user experience that can work to all platforms.

## Resources

- [mjtpena/Mac.NET.Samples](https://github.com/mjtpena/Mac.NET.Samples)
- [Mac Catalyst Overview - Apple Developer](https://developer.apple.com/mac-catalyst/)
- [.NET Blog (microsoft.com)](https://devblogs.microsoft.com/dotnet/)
- [dotnet/maui-samples](https://github.com/dotnet/maui-samples)
- [Mono Project](https://www.mono-project.com/)
