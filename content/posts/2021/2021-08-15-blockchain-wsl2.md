---
title: Using WSL2 (Windows Subsystem for Linux) for Blockchain Development
author: MJ Peña
draft: false
date: 2021-08-15
url: /blog/blockchain-wsl2/
images: 
     - /2021/08/wsl.jpg
tags:
  - Blockchain
  - Crypto
  - Ethereum
  - Technology
  - WSL
  - Windows
  - Python
---
In the past, I've been using my Macbook Pro to do all things blockchain and smart contracts development. One of the hurdles I encountered in the past is that some tooling and frameworks were not first class citizens on Windows. Majority of these tools, especially those that come with scripts and complex networking architecture (circa 2015) just works in MacOS and Linux:Ubuntu. 

## Introduction

Of course there have been a lot of improvements now in the ecosystem since then. A lot of the workflow now will just work natively on Windows or there are a lot of binding libraries or wrappers that can interop with. If you're using Windows, there are a lot of options for virtualisation of Linux such as Virtualbox, Hyper-V, VMware Fusion, and much more. Running Linux virtual machines on cloud such as Microsoft Azure is also an option. 

But what's interesting now is that Windows 10 comes with WSL2 (Windows Subsystem for Linux version 2) that actually allows you to work with Linux without having to start / stop a VM. This flexibility allows you to still use Windows 10 as your primary OS and connect to a Linux instance, just like doing a remote `ssh` session. There are many reasons on why you would still want to use Windows as your primary OS, but for me it's more around Microsoft Office productivity and my preferred OS in developing .NET apps - then WSL2 all the way.

So going back to Blockchain development on WSL2, there are a lot of things that actually work for my workflow without having too much friction and context switching. Below is the high-level "at a glance" image of how I set up my machine.

![](/2021/08/wsl.jpg)

## Visual Studio Code

VSCode is arguably the most preferred IDE in the past years for a lot of reasons. The main one for me is the abundance of extensions and community support with this beauty. It's now more than just a text editor that comes with a shell, it's an entire ecosystem of developer tools. I install this on Windows mainly because I want to standardise my settings, extensions, themes, and other configurations "whatever" I work on. Whether it's .NET on Windows , ASP.NET + React on Windows or Solidity on WSL2, I have a single key mapping for all of them. 

These are the extensions I install that are related to Blockchain:

- Remote Development Extensions

- Solidity & Solidity Visual Developer

- Other programming languages support for Java, Go, Haskell, Rust, etc.

- Docker

- Prettier, Linting, Themes, Fonts, and other UI personalization.


## Smart Contracts Development

### Solidity

I'm guessing 90% of the smart contracts right now are written in Solidity. I'm also guessing that 90% of blockchain projects are using a flavour of Ethereum. With that in mind, if you choose to develop smart contracts using Solidity, it would work in WSL2. 

Solidity as a language is very similar to JavaScript in terms of ease of use. It gets some time to be familiar with the syntax and semantics. But one thing for sure is that it's a fast-grown programming language. You will notice as you develop contracts, the `solc` compiler version gets updated frequently.

If you're new to the language, you can probably just go straight to any web browser and open https://remix.ethereum.org to get started. This doesn't require WSL2 or any installed dependency.

There are many ways to compile Solidity, such as using Docker (ethereum/solc) or install solc into wsl2 using `apt-get`, `snap`, or `homebrew`. There are also options to install it using the static C/C++ libraries. Depending on your appetite of depth and requirements, then you have a lot of options.

The common pattern right now is to use JavaScript libraries for end to end compilation, testing, and migrations. There are also a lot of popular libraries out there that you can piggyback on, such as OpenZepplin and Uniswap. More about compiler options below.

### Vyper

The only alternative to solidity right now is Vyper. As the name provokes, it comes with the Python family. Vyper allows you to write smart contracts using Python. Some would argue that Python is the easiest programming language to learn and the most popular one right now. Installing Vyper (and Python) is as simple as just installing Python on Linux. This would work straight away with WSL2 as well as `pip`.

Another thing worth mentioning with Python on Ethereum is `Brownie`. Brownie is a testing framework that allows you to test and mock your smart contracts using Python. Brownie would also work even if your smart contracts are written in Solidity.

I'm not yet sold on moving to Vyper as the majority of the ecosystem and community at large are still in Solidity, specially those contracts that are already peer-reviewed and battle tested. But it's always good to have an alternative option!

## JavaScript & Typescript

One thing I really like about working on Node.js project is NVM (Node Version Manager). Although there is a port of this in Windows, the projects in Linux and Mac are actively maintained. NVM allows you to install multiple versions of Node.js and can easily update and switch versions whenever specific libraries target specific versions.

I also prefer Yarn for package management. Although the preference is always subjective, in my experience, yarn just cuts it when dealing with complex dependency trees and relative install time. Also, the shortcuts are superb like `yb` for `yarn build` and `yt` for `yarn test` which are all just simple aliases and key-mapping that I setup in by shell.

Once Node.js is installed, you can run most of the blockchain projects on the project scope. You have the options to install tools globally, but I prefer to keep node packages to its project level - again, preference.

Once you go to the JavaScript world of blockchain, there are now so many variations and libraries you can use. You also have a plethora of choice on which SPA (Single Page Apps) would you like to use: React, Vue, Angular, and the list goes on. However, when interfacing with smart contracts, these are the usual stack that you can use when building, testing, and deploying to different networks:

### Truffle, web3.js, and Ganache

Back when I started smart contracts development in 2017, this was probably the only known option back then. 

`web3.js` is a JavaScript library that allows you to interface with deployed contracts.

`Ganache` is your instant local blockchain environment.

`Truffle` allows you to compile, test, and deploy contracts.

Given its dominance in the market, it comes with other tools that might help you with developing smart contracts such as Boxes and Drizzle. 

### Hardhat, ethers.js and Waffle

This stack is now becoming popular in recent months.

`ethers.js` is very similar to web3.js. It allows you to interface with deployed contracts.

`Hardhat` is very similar to Truffle, that allows you to compile, test, and deploy contracts. It also allows you to have an instance blockchain like Ganache.

`Waffle` is a good extension to Hardhat in order to make testing smart contracts more fun.

Both of them could also be extended to use advanced testing techniques like Mocha & Chai. I could probably write a separate blog post that outlines the difference of these two stacks, but on WSL2 perspective, using them would just work, just like any node.js project.

One advantage of using JavaScript/TypeScript in your smart contract development is the wide ecosystem around it. Obviously, the whole NPM package registry has exploded!

## Non-JS flavours

Obviously, there are also a lot of novel approach in doing blockchain DApp (Decentralised App) development other than Ethereum. Although this is seldom in my experience, they exist:

- `Cardano`

- `R3 Corda`

- `Hyperledger Fabric`

Most of them are something you can set up with Docker or install natively on Linux, in this case WSL2. Depending on which programming languages they support in writing smart contracts, it's most likely that there is a VS Code extension support for it. The same workflow of Solidity and JavaScript would still work for these other blockchain platforms and approach. 

## Docker

Docker is such a revolutionary technology in the past decade. It basically allows you to run an instance of an application with all of its runtime installing nothing else on your operating system. To be perfectly honest, the experience of Docker using a Windows host has given me a lot of headaches in the past. This is probably the reason whenever I work with Docker, especially the non-Microsoft stack (.NET / SQL Server) - I just do it on my Mac or Linux VM. 

`Docker for Windows now supports WSL2` as the backend host! This is such a big deal, because the experience and general compatibility of a hosted container in Linux would just work now on your Windows machine. Another combo to the mix is how it works well with VS Code. As part of remote extensions, __remote-containers__ allow you to interface with a container in a more intuitive way. 

Specific to Blockchain, there are ways to set up your local blockchain development network using Docker. Things like Cardano, R3 Corda, and Hyperledger are the ones that come up to the list of hosting a blockchain that you can interface straight away. The same applies if you have to containerise your application or a hard fork of Ethereum. Doing it the Docker way is probably the best option 

## Web3 Wallet and Metamask

Under the hood, I believe WSL2 does port forwarding to Windows and would allow you to use any browser installed on Windows despite your contracts and apps are in WSL2. That means even if your frontend code is in WSL2 like React.js, you can see view it on Windows. Then from Windows, any wallet can work for you.

`Metamask` - It's been my go to wallet since 2017. I have seen no other competition that can really make me look at others. Only on an occasion that we have to support specific blockchain networks or smart contracts, that's when I explore others. But for all things Ethereum, Metamask is king. Installing Metamask to Chrome, Edge, and Firefox is just as easy as installing any browser extensions.

Other browser wallets include you might look at: __Binance Chain__, __WalletConnect__, __Trust Wallet__, __MathWallet__, __TokenPocket__, and the list goes on.

## Other Utilities

`Zsh / oh my zsh` - I've been a big fan of zsh and the whole plugin ecosystem around it. It's the easiest way to have fancy terminals and comes with useful extensions like __zsh-autosuggestions__. This works in WSL2 despite your terminal (Windows Terminal or VS Code) are in Windows.

`Homebrew` - Since I've spent a lot of time on MacOS because of involvement in mobile projects, brew is a familiar territory for me. This works just fine in WSL2 with no fuzz.

`Github CLI` - A recent addition to the CLIs that I loved especially on newly minted environment. Setting up auth with ssh, is just straightforward. Works with WSL2 as well!

## Conclusion

Using Windows side by side with WSL2 would allow you to leverage the best of both worlds.

Docker and Web browsers on Windows would interface just fine with WSL2.

Most of the things you can do in Linux that are related to Blockchain development would work on WSL2.

## Resources

[Remote Development - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack)

[Using Docker in Windows for Linux Subsystem (WSL) 2 (visualstudio.com)](https://code.visualstudio.com/blogs/2020/03/02/docker-in-wsl2)

[Installing the Solidity Compiler — Solidity 0.8.8 documentation (soliditylang.org)](https://docs.soliditylang.org/en/latest/installing-solidity.html)

[Sweet Tools for Smart Contracts | Truffle Suite](https://www.trufflesuite.com/)

[Hardhat | Ethereum development environment for professionals by Nomic Labs](https://hardhat.org/)

[MetaMask](https://metamask.io/)

[Testing with Brownie — Vyper documentation](https://vyper.readthedocs.io/en/stable/testing-contracts-brownie.html)

[nvm-sh/nvm: Node Version Manager - POSIX-compliant bash script to manage multiple active node.js versions (github.com)](https://github.com/nvm-sh/nvm)

[Cardano | Home](https://cardano.org/)

[Enterprise Technology & Services Provider | R3](https://www.r3.com/)

[Hyperledger Fabric – Hyperledger](https://www.hyperledger.org/use/fabric)

[Oh My Zsh - a delightful & open source framework for Zsh](https://ohmyz.sh/)

[GitHub CLI | Take GitHub to the command line](https://cli.github.com/)