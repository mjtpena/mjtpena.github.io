---
title: "Language Compare Series: TUPLES in CSharp, TypeScript, and Rust"
author: MJ Peña
draft: false
date: 2023-01-04
image: /2023/01/Tuples.png
url: /blog/lseries-tuples/
tags:
  - tuples
  - csharp
  - rust
  - typescript
---

# Introduction about the series

I've been in the technology for more than a decade now, and one thing that really facinates me is when I get back to the roots of programming languages. When you just look at "coding" and not really have to deal with business requirements, what methodologies to use, and how to communicate effectively with your teams and stakeholders. This is what I particularly love about technology and programming languages, there's always something new to learn.

## Why CSharp, TypeScript, and Rust?

CSharp and .NET is just a natural "home" for me as I've started my journey with it since 2010 and I've been involved to a lot of applications since then. Majority of the projects I've been involved with are within the Microsoft stack, and even up until today I still find the sophistication of this language. CSharp can be written in simple ways, more complex (with a lot of patterns / anti-patterns); and the language keeps improving year-by-year.

TypeScript is just a norm in all frontend development projects I'm involved with. To be honest, this is the only thing that keeps me `a bit sane` when dealing with JavaScript projects. I like how strucuted and "typed" a project can be, and doesn't look "very dirty". It's also easier to create patterns and practices with larger frontend projects when using TypeScript. Although I would admit that my skills and understanding of TypeScript is still not that advanced - that's why I want to learn more about this language.

Rust is new for me. I've been playing with it for almost 2 years now, but I haven't really had any large projects that involved this language than some simple File I/Os, C++ parsers, Solana smart contracts, and simple HTTP APIs. I'm seeing a lot of really interesting open source projects with this language and a very welcoming community. I also seeing the experience with this language as how it is like the TypeScript of JavaScript - and Rust is on to C++. All the really low level things you want to accomplish in C++ can be written in Rust but in a more `opinionated` elegant way. So I really want to spend more time learning about Rust in the next couple of years.

So let's start with one simple concept that exists with all these 3 languages: TUPLES.

# What are Tuples?

Tuples are a data structure that allows you to store a fixed number of elements of different types. They are often used to store small collections of data where you don't want to create a custom data type. Tuples are typically immutable, meaning that you can't add or remove elements from them once they have been created.

In many programming languages, tuples are similar to arrays, but with the added benefit of being able to store elements of different types. This can be useful when you want to store a small collection of related data, but don't need the full functionality of a more complex data structure such as an object or class.

Tuples are often used for returning multiple values from a function or method. For example, you might have a function that calculates the area and perimeter of a rectangle. Instead of returning two separate values, you could use a tuple to return both values in a single data structure.

## Tuples in CSharp

In C#, tuples are data structures that allow you to store a fixed number of elements of different types. They were introduced in C# 7.0 and can be used as an alternative to creating a custom data type.

Here is an example of creating and using a tuple in C#:

```csharp
// Creating a tuple
var tuple = (10, "hello", true);

// Accessing elements of a tuple
int x = tuple.Item1;
string y = tuple.Item2;
bool z = tuple.Item3;

// You can also access the elements using deconstruction
(int x, string y, bool z) = tuple;

```

You can also create tuple types by using the `ValueTuple` struct. Here is an example:

```csharp
ValueTuple<int, string, bool> tuple = (10, "hello", true);

// You can also give names to the elements of the tuple
ValueTuple<int, string, bool> tuple = (x: 10, y: "hello", z: true);
```

## Tuples in TypeScript

Tuples in TypeScript are similar to those in C#. They are fixed-size arrays of elements where each element can have a different type.

Here is an example of creating and using a tuple in TypeScript:

```TypeScript
// Creating a tuple
let tuple: [number, string, boolean] = [10, "hello", true];

// Accessing elements of a tuple
let x: number = tuple[0];
let y: string = tuple[1];
let z: boolean = tuple[2];

// You can also use destructuring to access the elements
let [x, y, z] = tuple;

```

## Tuples in Rust

Tuples in Rust are similar to those in C# and TypeScript. They are fixed-size arrays of elements where each element can have a different type.

Here is an example of creating and using a tuple in Rust:

```rust
// Creating a tuple
let tuple = (10, "hello", true);

// Accessing elements of a tuple
let x = tuple.0;
let y = tuple.1;
let z = tuple.2;

// You can also use destructuring to access the elements
let (x, y, z) = tuple;

```

## Comparison

As you can see, tuples in C#, TypeScript, and Rust are very similar in terms of syntax and usage. They all allow you to create a fixed-size collection of elements where each element can have a different type, and they all provide ways to access the elements of the tuple.

One difference between the three languages is that C# and TypeScript provide named elements in tuples, whereas Rust does not. This can make it easier to work with tuples in C# and TypeScript because you can give names to the elements and use those names to access the elements, rather than having to remember their positions.

Overall, tuples can be a useful tool for storing and working with small collections of data where you don't want to create a custom data type. They are easy to use and can help make your code more readable and maintainable.
