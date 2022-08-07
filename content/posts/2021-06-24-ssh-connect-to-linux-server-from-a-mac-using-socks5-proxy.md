---
title: SSH Connect to Linux Server from a Mac using SOCKS5 Proxy
author: MJ Peña
draft: false
date: 2021-06-24T16:20:29+00:00
url: /blog/ssh-connect-to-linux-server-from-a-mac-using-socks5-proxy/
tags:
  - Technology
---

## Introduction

I've been spending a lot of time lately in setting up on-premises Linux Servers. There are a lot of reasons why you would like to SSH to a Linux server such as checking configuration files, copying files, or even port forwarding.

Just open your MacOS terminal and the command to ssh to a Linux Server is as simple as:

`ssh user@host` or `ssh michael@192.0.0.1`

However, where it gets tricky is when you need to use a proxy such as SOCKS5 in order to access that Linux server from your MacOS machine.

## Installation

I ended up using [ssh-connect][1] which can easily be installed using Homebrew.

`brew install connect`

## Useful Commands

### Set SOCKS5 Password

Now in order to use a proxy such as SOCKS5, it's best to export the password prior to the SSH command, otherwise you will end up typing this password repeatedly.

`export SOCKS5_PASSWORD='XXXXXXXXXXXXX`

### SSH session

Now to start an SSH session to that Linux server, use the following command:

`ssh -o 'ProxyCommand=/usr/local/bin/connect -S michael-px@sshproxydomain​:1080 %h %p' michael-vm@192.0.0.1`

**michael-px** is my user under the SOCKS5 proxy. The password was set from above "SOCKS5_PASSWORD". 1080 is the port used by the SOCKS5 proxy.

**michael-vm** is my user inside the Linux VM. 192.0.0.1 is the IP address of the VM.

### Port Forwarding

To port forward from the Linux server to your localhost (MacOS), use the following command:

`ssh -o 'ProxyCommand=/usr/local/bin/connect -S michael-px@sshproxydomain​:1080 %h %p' michael-vm@192.0.0.1 -L 8888:localhost:80`

It's very similar to the SSH session command but added with **-L 8888** to point that it's the "localhost:8888" of the server and it forwards the traffic to the MacOS' **localhost:80** or 127.0.0.1:80.

This is very useful whenever you are debugging or testing a deployed service or website inside that Linux VM.

### Copy files via SSH

To copy files from your MacOS machine to the Linux server, use the following command:

`scp -o 'ProxyCommand=/usr/local/bin/connect -S michael-px@sshproxydomain:1080 %h %p' FROM_FILE_DIRECTORY michael-vm@192.0.0.1:~/TO_FILE_DIRECTORY`

Instead of using ssh, this time you are using the scp command. the FROM_FILE_DIRECTORY can be something like ./myfile.zip and the TO_FILE_DIRECTORY can be /mnt/hdd1/file-drops

Note that it could also work the other way around (from Linux Server to MacOS local machine).

## Conclusion

The world of Linux and command lines are wonderful and very flexible. There are more things you can do once you're inside the server. Happy SSH-ing!

[1]: https://github.com/gotoh/ssh-connect
