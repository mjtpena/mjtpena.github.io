---
title: What are these blockchain and crypto tokens?
author: MJ Peña
draft: false
date: 2021-08-10T02:19:19Z
url: /blog/blockchain-tokens/
featured_image: /2021/08/coins.jpg
categories:
  - Blockchain
  - Crypto
  - Ethereum
  - Technology
  - NFT
  - Stablecoins
---

So you keep hearing or reading about "tokens", these "cryptos", the "blockchain bitcoins", and so on. It's been quite some time now that it has involved me with blockchains and cryptos that over and over, I have to explain to people (often new clients) on what are these tokens. Even until now, at almost late 2021, I still get asked about these: Is it Bitcoin? Is it Ethereum? Is it Coin X, Coin Y? What are these NFTs? This is my attempt on how I can simplify these concepts to answer most of the important questions like what are these different tokens and shed some light on some real world use cases of them/

The term token is so generic that we have used it across different industries, practices, and domains. Like if you talk about tokens in web development & security, it's most likely about the "Access Tokens". But in the blockchain world, it's somehow different. To avoid the confusion further, let's narrow it down to 3 major types of tokens that are popular right now in circulation. They are the fungible tokens, non-fungible tokens (NFTs), and hybrid tokens.

![](/2021/08/coins.jpg)

## Some Basic Concepts of a Token

**A token is a representation of X. And X could be anything.** It is digital and may or may not represent an actual entity or atomic particle in the physical world. It can be a currency, an in-game item, a land title, an idea, a physical artwork, a virtual artwork, literally anything. The whole point of having a token is to represent something that is of value across different parties or the public community. **Anything that has a value can be a token.** Should they? That's a question you should answer.

**A token is transferrable.** We can transfer it from an Entity 1 to Entity 2. An entity could be anyone: a person, a business, a platform, anything that "owns". We usually represent this ownership of tokens as an address (0X11....) in a wallet.

**A circulated token is owned.** As mentioned above, at a specific point in time (or block in the chain) a token is owned or registered to a specific address.

**We can create a token or, as we call them, "minted".** Depending on how the token was designed, it can be set to:

- Mint once: (0 => 10,000,000) and they will create no more tokens.

- Mint anytime by Entity 1. Entity 1 can issue (0 => 1) tokens or (0 => 10,000 => 100,000 => infinity).

**A token may be destroyed or others prefer the term "burn".**

Not all tokens support burning. But if you really hate that token and want it to be gone, just transfer that to "Address 0". Once it's there, you can't take it back.

We use token burning for a lot of reasons: 

- too much supply / less demand and wants to drive the value up.

- natural life-cycle of token: { token created => token transfer(s) => token destroyed }

**We can program Token behaviours and properties using "Smart Contracts".** These smart contracts are what the "Blockchain Developers" actually code. It about defining methods and events of a token depending on which "state" it currently sits.

There are different **standards** in place for tokens. The underlying blockchain network that you're running your "Token Contracts" usually drives them. 

**EIPs / ERCs**: If you're working on smart contracts and tokens, 90% of the time you will use Ethereum as a blockchain network. This could be the public ledger, for example, "MainNet" or privately hosted chains like "Quorum", and any other implementations (aka Hard Fork). __EIPs are proposals__. __ERCs are standards.__ These are specific to Ethereum (and hard forks) that standardises basic behaviours and properties of smart contracts.

__BEP, TRC, NEP, and the rest of non-Ethereum stack.__ Depending on which blockchain network you host your contract, they have a unique twist or improvements on how contracts can be standardised. 

[Token Taxonomy Framework](https://github.com/InterWorkAlliance/TokenTaxonomyFramework/blob/main/token-taxonomy.md) - This is an attempt to create a framework for tokens to establish a universal interoperability. This standard is not specific to any blockchain network or a law that companies need to follow.

Now let's go back to the different tokens.

## Fungible Tokens

Fungible tokens are of the same attributes (not unique) and are divisible. The most common use case is a currency. A person holding 100 Token X shares the same attribute of person B holding 100 Token X. There is a shared collective of what a quantity means, for example, what can you do about it: convert to FIAT (USD, AUD, PHP) or use it to get something else, for example, flight points, rewards, discounts, etc. Note that it's not exclusive to coins or currencies other unit of measurements can be applied too, such as owning how many wine barrels, owning square meters of a land, a collateral token, and so much more.

### Bitcoin, Ether, and all the Alt Coins

**Bitcoin** is fungible. It is a currency - a cryptocurrency. You can split and transfer it. It "represents" an intrinsic value that people all over the world share. Right now, there are just countless of applications that you can use Bitcoin: remittance, investments, international transfers, etc.

**Ether** is the oil & gas that power the Ethereum Main Network. It is a currency - a cryptocurrency in that regard because it's a value that is exchanged across the network. It is divisible and can be owned. Ether is required to deploy and run smart contracts on the network. You can use ether to deploy your own tokens. You can use ether to buy NFTs. 

**Alt Coins.** Obviously because of the hype of cryptocurrencies in the past few years, there has been an emergence of other cryptocurrencies, aka "Alt Coins". They either have their own blockchain network like Binance (BPB) and Cardano (ADA); or they simply piggy back on Ethereum through ERC-20 & ERC-777.

### ERC-20 and ERC-777

Ethereum, being around 90% market share of the alternative coins, now has these standards. [ERC-20](https://ethereum.org/en/developers/docs/standards/tokens/erc-20/) comes with the base behaviours and properties like Minting, Transfer, Owning, etc. When you feel like creating your own coin, then you can consider ERC-20 or [ERC-777](https://eips.ethereum.org/EIPS/eip-777) (an improved version) for your tokens in circulation.

### “Stable coins”

Although a topic of its own, stable coins are cryptocurrencies that are pegged toward the value of "stable" assets, such as FIAT currencies (USD, AUD, PHP). The popularity of stable coins came to be because of the high volatility of cryptocurrencies. They are fungible just like bitcoin and ether, but they are unique in a way that each unit is equal to what it corresponds to the stock market & traditional exchanges. Think of 1 stable coin equals 1 USD. We do not limit the use cases of these to FIAT currencies, but can also apply to assets like gold, oil, copper, etc. The popular stable coins out there are: [Tether](https://tether.to), [DAI](https://makerdao.com/en/), [Binance USD](https://www.binance.com/en/busd).

### Others worth mentioning

Although Ethereum is the king of smart contracts and host for coins right now, there are other contenders around. Specially right now that Ethereum is experiencing some scaling issues, it's worth having to look at what other blockchain networks and standards offer. But they are like ERC-20, where it's about a cryptocurrency that is divisible, can be owned & transfer, and has value.

[BEP-2](https://academy.binance.com/en/glossary/bep-2) and [BEP-20](https://academy.binance.com/en/glossary/bep-20) for [Binance Smart Chain](https://www.binance.org/en/smartChain)

[TRC-10](https://developers.tron.network/docs/trc10) and [TRC-20](https://developers.tron.network/docs/trc20) for [TRON](https://tron.network)

[Cardano Native Tokens](https://cardano-ledger.readthedocs.io/en/latest/explanations/features.html) (note can also be an NFT / might better fall into hybrid)

### Your next "Alt Coin"

Inevitably, more and more coins or fungible tokens will emerge - and for good reasons. Let's say you have any value within an organisation or business consortium that needs to be quantified and liquidated - then you need a fungible token. You need to put collateral when loaning something, then you need an FT again. You want to transfer your solar energy to your neighbour (without having the middlemen), then you need to have currency and exchange - FT again. So the list goes on, you'll be surprised that not everything has been "tokenised" yet!

## Non-Fungible Tokens (NFTs)

To put it simply, every NFTs are unique. Any asset that you want to have a representation in digital can be an NFT. A player on a basketball team can be an NFT. An artwork or jewellery and the proof of ownership can be an NFT. Your land title can be an NFT. An engineer’s patent can be an NFT. Your parents’ certificate of completion, your grades, your diploma, your degree; your pen sitting on the desk inside the classroom on the school campus can be an NFT. 

An NFT is exclusive to the owner until she/he transfers it to someone else. An exclusive in game item can be unique that only one exists throughout the ecosystem. Maybe owning a specific NFT allows you to unlock that same item across 5 different games. Think of your avatars or profile pictures as NFTs to show that you're unique. 

### ERC-721

[ERC-721](https://eips.ethereum.org/EIPS/eip-721) is the bread and butter of most NFTs out there in the wild. It's a standard that defines what an NFT is within the Ethereum ecosystem. It basically outlines how an asset can be __distinguishable__ like no two houses are alike, the same goes with cats. Majority that you see in the marketplaces like [OpenSea](https://opensea.io/ ) are of ERC-721. ERC-721 can represent digital (virtual) or physical assets.

### Your next asset tokens

Whether you choose to use ERC 721 or extend it, your next asset would probably be in a form of NFT. When people or clients ask me if there are more NFT ideas that can be done? I say, yes! There is still a lot of provenance problem happening around. Just think of a future where access to subscriptions is NFTs. All the things that you wear and own are NFTs; and the concept is not obscure - people don't have to ask if you really own it. There are mechanisms to know it. We can think of the future where even the very bottled drink that you ordered through a vending machine will be traced once there's a massive poisoning. The ideas are endless! We need more NFTs.

## Hybrid Tokens

Although ERC-721 allows you to create individual unique tokens, sometimes it's too limited to specific use cases. Most of the problems that I experienced with NFTs are scaling them when we are talking about provenance and large volume of quantities (thousands or millions per batch). The network, even if it is self hosted, __at least for now__, will not cut having to mint millions of unique NFTs to represent every item in a batch. 

### ERC 1155

This is a multi-standard token that allows you to mix both fungible and non-fungible properties. Think of it like having unique tokens but can be divided. Some of the good use cases I had the experience of doing this are through the protein and meat industry. Instead of having individual NFTs per cow, you can batch them through an ERC-1155 with specific Token Ids per animal. The same can apply to anything within the supply chain that can be batched. I also worked on book copies being ERC-1155 where a book can have a few supplies in the circulation.

### Your Next Complex token

Depending on what business domains that you work on, sometimes Fungible and Non-Fungible tokens are quite limiting. For now, they are called hybrid tokens. But eventually this will emerge as specific standards or nickname across various industries. Maybe a blood count in the medicine may not fall under FT and NFTs. Electricity, water, and gas supplies are not simply fungible. There could be a different standard should be made for interlocking tokens, for example, building blocks of NFTs and FTs to create a new token. 

This goes back again to what I keep telling my clients that, there are a lot more business opportunities in this place. I, for one, am investing some time, effort, and money to explore other hybrid tokens. Think of any system where trust can be given and automated (ethics not in violation) so that transactions and flow are more seamless. There are a lot of "data swamps" or batches of Excel files floating all over the world waiting to be reconciled. They can be programmed to be automated, they can be written in smart contracts, they can be represented as tokens.

## Where is this whole token mania heading?

One thing I can say is that there is no stopping on the growth of tokens whether new tokens will arrive or more people will take part in existing tokens across various networks and platforms. Enterprises already adopt these technologies. Some are simple, some are more complex. Most of them are just extensions of their existing products and some are totally re-imagined greenfield ideas.

The real value of tokens, in my opinion, is when you don't actually have to think the underlying technology around it whether what data is in blockchain. It's more around enabling **inclusive**, **secured**, and **private** transactions. It when participation across multiple parties is more efficient and optimizes for joint growth: no more haggling who owns and responsible to what at a specific point. 

If you need help on finding or "minting" your next token idea, just email me at: michael@datachain.consulting 

