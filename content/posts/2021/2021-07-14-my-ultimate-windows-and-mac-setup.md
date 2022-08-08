---
title: My Ultimate Windows and Mac Setup (2021 Edition)
author: MJ Peña
draft: false
date: 2021-07-13
url: /blog/my-ultimate-windows-and-mac-setup/
images: 
     - /2021/07/Battle-station-2021.jpeg
tags:
  - Technology
  - Life-style
  - Mobile
  - Web
  - Windows
  - MacOS
---

# Introduction
![img](/2021/07/Battle-station-2021.jpeg)
__My Battle Station @ 2021__

In a parallel world, I'll be just using 1 device and 1 Operating system for all the things. However, given the nature of my work with mobile, web, blockchain, machine learning, and cloud development, I need to have multiple devices to cater things.

I tried doing "Shared mouse and keyboard" in the past such as Synergy, but I decided to use a KVM switch instead. The main reason for this is context switching, so that I don't get distracted and I have a "physical switch" to tell myself "It's time to do..." I also intentionally placed the KVM switch near my foot, so I have to force myself to dock to press that button.

This blog post is about how I use MacOS and Windows to various workflow that I do as a business owner and software engineer.

# Hardware
- Desktop (i9, 128GB RAM, RTX 3080 ti, 2TB SSD) that runs Windows 10
- Macbook Pro 16″ (i9, 32GB RAM, 1TB SSD) for main use
- M1 Macbook Air for portable use
- KVM Switch: Display and Accessories
- 3 Monitors with different lengths with VESA support
    - 2 of which are attached to KVM Switch, and the other one I have to unplug/plug to Windows Desktop/Mac
- Logitech MX Master 3 plugged to KVM switch
- Logitech Steelseeries mechanical keyboard plugged to KVM switch.
- Blue Yeti Snowball microphone attached to KVM switch
- Bose QC35 for headset paired to both MacOS and Windows Desktop
- 1080p Logitech web cam attached to Windows Desktop only
- Generic sound bar speaker attached to Windows Desktop only
- Generic lighting equipment
- Dongles (USB-C to HDMI/USB-A) mainly for Mac
- Mobile Phones (iPhones and Android phones) for testing purposes
- A pen and a hard bound notebook if I need to draw something

# Windows workflow

## General Business and Office

When writing proposals and other business related documents, I still prefer to use Microsoft Word for Windows as it is complete with all the features that I need. 

Excel for Windows in my experience has been more stable than the MacOS equivalent. Running complex formula and loading a lot of data, is a much smoother experience for me. I don't even bother with non-Excel app at all.

Although I can open all websites to any device with a browser (and sync bookmarks), I prefer to use this machine for all business related sites:
- Banking websites
- Accounting websites (Quickbooks/Xero)
- Document signing and business registrations
- Outsourcing (Fiverr, Upwork, etc)

## Primary Presenter
NVIDIA Broadcast is a game changer for me. I live in a place where constant noise is passing by, so Broadcast's capability to do noise cancellation (for free) is really good.

Powerpoint for Windows has been my default tool of choice for slides, as it is complete with all the features that I need. The MacOS equivalent, Keynote, and Google Slides lack some of the advanced features that I need.

All my collaboration and messaging apps also lives in Windows (with backup on MacOS): 
- Microsoft Teams
- Zoom
- Cisco WebEx
- Slack
- Discord
- Facebook Messenger (App)
- Signal & WhatsApp

## General Research
Although I obviously have browsers across all devices, I use the Windows machine as my `go to` research device. This means I use this for `googling` things and scroll to various materials such as books, articles, research papers.

I use [[RoamResearch]] as my single dump of all my notes and general writing. It's my "second brain." This is `my choice of tool` that works across all platforms. I make sure all notes are dumped here.

I also use Instapaper to convert web links that I want to read later on.

## .NET and Windows Desktop Development
The full Visual Studio (2019) for Windows is very helpful when working on big .NET projects. It comes with a lot of GUI tools that I am already familiar since the beginning of my .NET journey in 2009. 

I also have a project right now that deals with Win32 and a lot of native Windows modules such as NativeWifi and Active Directory. This is a hard dependency of using a Windows machine for this specific projects.

A couple of years back when I was playing out Hololens, Mixed Reality, and Unity; I was only able to do it in Windows.

## Azure Development and Infrastructure
I installed Azure CLI on Windows mainly because of Powershell. I have a lot of ARM templates and automation scripts that are in Powershell and it's just a good context to mix this with Azure CLI on Windows. 

It also happened to be that a lot of my Azure related projects are within the Microsoft ecosystem: SQL Server (SSMS), ASP.NET, and Windows IoT - again something I prefer to do in the Windows ecosystem because of familiarity.

## Blockchain Development
I use WSL2 (Windows Subsystem for Linux) for these purposes. I install all the dependencies around it. The commons are: NodeJS (NVM), Go, Rust, Python, and a bunch of CLI tools.

I use Visual Studio Code as my primary IDE in writing smart contracts. The fun part of using VSCode is that, I can always target WSL2 for debugging and deploying purposes.

I'm very new to Go and Rust as a trendy programming languages. Learning them through WSL2 is a very cool sandboxed environment for me to play around.

## Machine Learning Development
I worked on a ML.NET project, and using a Windows machine works perfectly. Although it's not really dependent on the OS, I just really find the fun of working with .NET on Windows in general - again familiarity.

I used to bother installing Anaconda, Keras, TensorFlow, and all other Python dependencies on Windows (and tried on WSL), but I didn't find the experience pleasant. These days, I just use a managed server / cluster on cloud ie Jupyter kernel, Databricks, Azure ML, and Azure Synapse.

# MacOS workflow
## Mobile Development
When you're developing an iPhone app, it's always a need to have a MacOS machine. Specially when you're dealing with application signing, bundling, certificates - they all live in the close walled gardens of Apple. 

Although I can use Windows for Android development, I just prefer to use a Mac so that I have a single device to work on "just mobile". This goes with the rest of the Android suite: ADB, JDKs, SDKs, Gradle, Scala, Groovy, and Maven.

I also work on Cross-Platform technologies like Xamarin, React Native, Flutter, Swift UI, and based from experience, it's a much smoother experience to have this workflow on a MacOS. Otherwise, you will be working on Android only, then think about iOS as an after thought.

## MacOS Desktop Development
I am also working on a MacOS Desktop project, and with no surprise you will be needing a Mac hardware for this. 

On a separate note, I don't find AppleScript as a fun experience. But Swift is a really good programming language to work on. :)

## Web Front-end (JavaScript/TypeScript) Development
These days I usually work on a React frontend. I did touch on some Angular and Vue, but my involvement is very minimal. It's all the familiar toolset of NodeJS, TypeScript, and npm tools and packages. 

I prefer to work on MacOS for Web Front-end development because of Safari! Although the whole world is really about Chrome, most web projects require for it to work on Safari. 

Also given that when I work on React Native, I do it on a Mac. The context switching of sharing those React components across mobile and web, it's just easier to test on a single machine. 

## Java everywhere
Java is a programming language and platform that I didn't particularly prefer, but an inevitable thing that you see time and time again in your career. Given that my Android development workflow is in MacOS, all things Java related, I just do them on MacOS too.

# Conclusion
I prefer to use Windows for the "Office work", .NET & Azure Development, and my primary presenting device. WSL also brings a lot of flexibility to have Linux without the need of VMs or Dual Boot.

I prefer to use MacOS for all things mobile and web front-end. Although a lot of these workflows can be done on Windows, the energy of iOS/MacOS/Swift just drags me back to sticking with MacOS.

In an alternative universe, if XCode Tools and general iOS development becomes available as a Docker Container or WSM (Windows Subsystem for MacOS), then Windows will be my one and only device.