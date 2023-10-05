---
title: How to disable auto-locking of MacOS Keychains
author: Michael John Peña
draft: false
date: 2021-03-14
url: /blog/how-to-disable-auto-locking-of-macos-keychains/
images: 
     - /2021/03/Screen-Shot-2021-03-15-at-10.08.51-am-940x232.png
tags:
  - iOS Development
  - Mobile
  - Technology
tags:
  - Build Server
  - iOS Distribution
  - Keychain
  - MacOS
  - Mobile Development
---

Signing an iOS app for release is one of the trivial things most mobile developers face. A lot of CLIs and SAAS emerged as part of this struggle. However, not all companies have adopted to those tools and they still prefer to build their apps in their on-prem data servers. They use something like TeamCity or Azure DevOps Server.

We streamlined the configuration of our Mac Build agents to a repository where we can update our Provisioning Profiles, Keychains, etc.

Lately, I'm seeing a lot of this:

`error: No signing certificate "iOS Distribution" found: No "iOS Distribution" signing certificate matching team ID "XXXXXXXX" with a private key was found. (in target 'XXXXX' from project 'XXXXX')`

![img](https://firebasestorage.googleapis.com/v0/b/firescript-577a2.appspot.com/o/imgs%2Fapp%2Fmjtpena%2FhUK6MA22wq.png?alt=media&token=8f178aa7-3a07-4657-8288-480cdabcec45)

It turns out that the Keychain where the distribution certificate and private key was stored keeps locking up every 2 hours.

Here's a simple step by step process to remove that lock 🔐 .

1. Open the local copy of your Keychain through Keychain Access.

![img](https://firebasestorage.googleapis.com/v0/b/firescript-577a2.appspot.com/o/imgs%2Fapp%2Fmjtpena%2FZSxS7fv_Au.png?alt=media&token=d9e97e60-28e3-4f51-9e32-44d4a8198d88)

2. Right click on the keychain and select "Change Settings..."

![img](https://firebasestorage.googleapis.com/v0/b/firescript-577a2.appspot.com/o/imgs%2Fapp%2Fmjtpena%2Fe4gMKg1Kuk.png?alt=media&token=d11d2398-ffdf-4b23-b7c7-e2f91b29b96e)

3. Untick the "Lock after..." and "Lock when sleeping". Click on Save.

![img](https://firebasestorage.googleapis.com/v0/b/firescript-577a2.appspot.com/o/imgs%2Fapp%2Fmjtpena%2FkWUREz7y1a.png?alt=media&token=5abe6d8c-5101-4268-9627-7d7f0dcc5e57)

4. Back on the keychain items, right click on the private key. Select "Allow all applications..." since the build servers doesn't really need a GUI, otherwise you would need to manually RDP to the servers and unlock the keychain.

![img](https://firebasestorage.googleapis.com/v0/b/firescript-577a2.appspot.com/o/imgs%2Fapp%2Fmjtpena%2FkSxnP7LbjR.png?alt=media&token=0bea0854-a54f-47e0-b69c-ef41654fc14a)

5. Save all changes. Create a pull request. Merge the branch. Run the pipeline again.
