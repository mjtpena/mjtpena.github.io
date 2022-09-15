---
title: "Creating native MacOS background apps with .NET"
author: MJ Peña
draft: false
date: 2022-09-15T21:52:19+00:00
image: /2022/09/macos-dotnet-background-featured.png
url: /blog/macos-dotnet-background/
tags:
  - csharp
  - dotnet
  - macos
---

## Introduction

In the previous [blog post](https://michaeljohnpena.com/blog/dotnet-macos-universal/), I covered how you can create Universal Apps for MacOS. But what if you actually want to create and run a head-less (no UI) application in your Mac using your favourite .NET framework and libraries? Then I have some good news for you, it’s possible, but then again - with some caveats.

For those who are already familiar with Windows Services, with .NET, you traditionally create a Windows Service project using the .NET Framework. But with introducing .NET Core you can now run .NET apps (Console and Web) on Linux and Mac without the need to use [Mono](https://www.mono-project.com/). Then with it, comes the [Worker Service](https://docs.microsoft.com/en-us/dotnet/core/extensions/workers) project that allows you to create hosted services that run in the background using the IHostedService interface that allows you to run the app to any generic host - meaning no need for runtime dependencies like .NET framework.

What’s even great about this approach, is that Microsoft recently created a hosting extension for Linux for [SystemD](https://github.com/dotnet/runtime/tree/main/src/libraries/Microsoft.Extensions.Hosting.Systemd). SystemD is a service control and distribution manager in Linux for background applications. This means that you can directly publish and run your .NET application as a daemon without some witchcraft.

In the MacOS world, it also uses the concept of daemons to run background applications. What’s different is that it uses a proprietary service control and distribution manager, [LaunchD](https://launchd.info/). As of writing this, there is no .NET hosting extensions for LaunchD yet. Maybe in the future, I might just end up [doing it](https://github.com/mjtpena/runtime/tree/main/src/libraries/Microsoft.Extensions.Hosting.Launchd). But until then, I have to find an alternative approach.

## Setting up the Project

For this demo, we'll just be using a vanilla Worker Service project. In Visual Studio, VSCode, or Rider, just do a File New Worker Service project.

```csharp
namespace MacBackgroundApp;

public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;

    public Worker(ILogger<Worker> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Hey Mac, I'm running at: {time}", DateTimeOffset.Now);
            await Task.Delay(1000, stoppingToken);
        }
    }
}
```

Now let's publish this application targeting OSX with Terminal. If you feel like creating the universal app, follow my [previous blog post](<[blog post](https://michaeljohnpena.com/blog/dotnet-macos-universal/)>).

```shell
dotnet publish MacBackgroundApp.csproj --runtime osx.11.0-arm64 -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true  --self-contained true -c release
```

Now, go to the publish folder and run the application to verify.

```shell
cd bin/release/net6.0/osx.11.0-arm64/publish/

./MacBackgroundApp
```

You should see it running continously.

![img](/2022/09/macos-dotnet-background-01.png)

Now, let's convert this in to a background service in Mac!

## Platypus

[Platypus](https://github.com/sveinbjornt/Platypus) is a magical tool wraps a script and binaries into an [application bundle](https://en.wikipedia.org/wiki/Bundle_(OS_X). So basically any console application in any language that is run via a script, can be bundled in a .app (MacOS application bundle extension).

You can install it via the [releases](https://sveinbjorn.org/files/software/platypus.zip) or homebrew.

```shell
brew install --cask platypus
```

Once installed, run the application and let's start bundling.

1. Put in an App Name.

2. Click on +New to create a new script.

In the script, type your .NET application's name `./MacBackgroundApp` just like how you did it in Terminal.
![img](/2022/09/macos-dotnet-background-02.png)

_Note: If your .NET application requires command line arguments, that's also supported like `./MacBackground --input Hello`._

3. Copy the executable and other dependencies like appsettings.json on to Platypus. (Drag-Drop also works)
   ![img](/2022/09/macos-dotnet-background-03.png)

4. Click on **Create App**.

5. Go to the folder where the .app was created and run the application by double clicking.

![img](/2022/09/macos-dotnet-background-04.png)

🚀 At this point you now have a running .NET app wrapped as an application bundle. This is also a good point to check if your application is working or behaving as expected.

6. Now, go back to Platypus. This time, change the Interface type in to **None**. Also tick the **Run in background**. Create an App again.

![img](/2022/09/macos-dotnet-background-05.png) 7. Run the application again. This time around, you’ll see that there is no application that opened. This is because it’s in the background! Open Activity Monitor to check your application.

![img](/2022/09/macos-dotnet-background-06.png)

🎉 Congratulations! You can see two processes running. Here, the `MacBackground` is the app that we created via Platypus, and `MacBackgorundApp` is the .NET self-hosted application.

### Bonus: See Logs from Console

Open the **Console** app in your Mac.

Click the “Start” streaming toggle. Also, type in the search bar, your application.
![img](/2022/09/macos-dotnet-background-08.png)

👀 You can now see all the logs that's happening in your application.
![img](/2022/09/macos-dotnet-background-07.png)

## Summary

- .NET Apps (Core onwards) allow you to use Worker Service to create continuously running processes.
- Platypus is a tool to use in order to create MacOS application bundles. This applies to your self-hosted .NET application too.
- You can check your application logs in Console.

---

References:

- [Worker Service](https://docs.microsoft.com/en-us/dotnet/core/extensions/workers)
- [Platypus](https://github.com/sveinbjornt/Platypus)
- [LaunchD](https://launchd.info/)
- [SystemD](https://github.com/dotnet/runtime/tree/main/src/libraries/Microsoft.Extensions.Hosting.Systemd)
