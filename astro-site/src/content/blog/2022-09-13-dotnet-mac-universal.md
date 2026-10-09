---
title: "Creating MacOS universal apps in .NET"
description: "Not to confuse yourself with Xamarin.Mac and MAUI for Mac Catalyst, they are different from this. Xamarin.Mac is an abstraction on a lot of Cocoa based…"
author: Michael John Peña
draft: false
date: 2022-09-13
url: /blog/dotnet-macos-universal/
tags:
  - csharp
  - dotnet
  - Azure
  - macos
---

Not to confuse yourself with Xamarin.Mac and MAUI for Mac Catalyst, they are different from this. Xamarin.Mac is an abstraction on a lot of Cocoa based framework and transpiles your app into native Swift/Objective-C code and creates an app. MAUI for Mac Catalyst is an abstraction on Apple's Mac Catalyst (and also a bunch of Swift/Objective-C libraries) which targets both iPadOS and MacOS. I'll probably cover these topics on a different blog post.

So my guiding pattern is:

- Creating Apps and all the OS features => Xamarin.Mac / MAUI for Mac Catalyst
- Using MacOS as host => .NET Core (.NET 5/6/7)

I know... Mixing the .NET and Macs is just a big nomenclature nightmare. I still struggle as well, so if I didn't get things 100%, please let me know.

## Universal Apps

So if there's Mac Catalyst, there's Mac app, then what is a Universal App for Mac? For a Windows developer of the past like me, this even gets confusing for me. In the past, Universal App is the term we use to create an app that targets both Windows Phone and Windows 8 (2011~) which then became UWP (Universal Windows Platform).

Fast forward to 2021/2022 Apple is using the term to mean that it's a MacOS application that works for both Intel Based CPUs as well as their Apple Chipsets (M1, M2, etc). Because basically Intel and Apple architectures and technically different, creating an app would mean targeting those different things. One app targeted to a specific architecture, won't work natively on the other.

In a MacOS perspective, this change only applies from OSX version 11 (Big Sur) onwards. Meaning apps that are targeted towards version 10 or below are meant to run on Intel version of apps only. Apple chipset Macs need to use [Rosetta](https://support.apple.com/en-gb/HT211861) in order to make it work.

### Dotnet Publish

As of .NET 6, you can only target a specific runtime in your .NET applications:

- `osx.11.0-x64` - Intel based Macs
- `osx.11.0-arm64` - Apple M series Macs

Note: **osx.12.0-x64** and **osx.12.0-arm64** are also available but would mean that the app will only work on Mac OS Monterey onwards (Ventura).

In your .NET 6 application, you can publish it using the following command:

#### Intel Based

```shell
dotnet publish HelloMacOS.csproj --runtime osx.11.0-x64 -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true  --self-contained true -c release
```

#### Apple Based

```shell
dotnet publish HelloMacOS.csproj --runtime osx.11.0-arm64 -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true  --self-contained true -c release
```

The following arguments are added:

- **PublishSingleFile** is set to true in order to just have 1 self hosted file without the individual dlls.
- **IncludeNativeLibrariesForSelfExtract** is set to true so that unmanaged DLLs are also included.
- **self-contained** is set to true in order to make it run without needing the .NET runtime dependencies.
- **Release** mode is configured instead of debug

In your `bin/release/net6.0` folder you will then have those two release artifacts:


It actually gets confusing, as what you're really after is the content of the **publish** folder of each of them:

`bin/release/net6.0/osx.11.0-arm64/publish`
`bin/release/net6.0/osx.11.0-x64/publish`

### Checking the Architecture

To check whether your app is really an x64 or arm64 app, you can use the following command:

```shell
file bin/release/net6.0/osx.11.0-x64/publish/MacDotNet
```


You can see that it says: **x86_64**

```shell
file bin/release/net6.0/osx.11.0-arm64/publish/MacDotNet
```


and this one as **arm64**.

### Creating the Universal App

Now I have an x64 and an arm64 app, how can I create a universal app? It's simple `but a hack`.

```bash
lipo -create -output MacDotNetUniversal bin/release/net6.0/osx.11.0-x64/publish/MacDotNet bin/release/net6.0/osx.11.0-arm64/publish/MacDotNet
```

and to check if the output is indeed universal:

```shell
file MacDotNetUniversal
```


🎉 Hooray! We now have a universal app executable that can run on both Apple and Intel based CPUs.

🙋‍♂️ But why is this a hack? Because basically this is what we call a **Fat Framework**. It's an aggregate of multiple executables that are just bundled together. It's not really "1 executable" that targets both platforms.

If you compare their file sizes (use `ls -lh filename`)

You will see that the universal app is basically the two executables added together.

In the future, I hope .NET 7 (or 8) can target universal apps as single executable. But in the long run, if Apple will only support their own chipset, maybe just arm64 is the way to go. Time will tell.

### Some useful apps worth doing with this

What are some of the real world things you can (and should) use this for?

- Network Processing apps / Packet captures.
- Background processing jobs: ie telemetry / agent type app.
- Sidecar applications where you have an main UI application and this .NET app is your sidecar:


## Summary

- You can create universal MacOS apps by targeting both arm64 and x64; and create a Fat framework.
- You use the `--runtime osx.11.0-x64` or `--runtime osx.11.0-arm64` on your dotnet publish command to target the desired runtime.
- There are a lot of things you can do by leveraging existing .NET libraries in to your Mac!
