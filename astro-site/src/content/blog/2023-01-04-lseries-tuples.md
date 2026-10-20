---
title: "Tuples in C#, TypeScript and Rust: Same Syntax, Different Rules"
description: "How C# 11, TypeScript 4.9 and Rust 1.66 treat tuples: naming, mutability, equality and pattern matching, and when a named type is the better choice."
author: Michael John Peña
draft: false
date: 2023-01-04
url: /blog/lseries-tuples/
tags:
  - Programming
  - C#
  - TypeScript
  - rust
  - Development
---

In JavaScript, `[1, "a"] === [1, "a"]` is `false` (and TypeScript 4.8 and later won't even compile it), while in C# and Rust `(1, "a") == (1, "a")` is true. The three languages write tuples as a bracketed list of values, so the code looks nearly identical, but underneath they disagree on naming, mutability, equality and what exists at runtime. If you switch between them in the same week, as I do, that's exactly the kind of difference that slips past a code review. This is the first post in a Language Compare series I'm starting, looking at C#, TypeScript and Rust through one shared concept at a time.

C# has been home since I started with it in 2010, TypeScript is the default on every frontend project I'm involved with, and I've spent almost two years with Rust on small things: file I/O, C++ parsers, Solana smart contracts and simple HTTP APIs. (I've also written about test-driven development in [Rust](/blog/2022-12-19-tdd-rust/) and [TypeScript](/blog/2022-12-25-tdd-typescript/).) The versions in scope are the current stable releases as of early January 2023: C# 11 on .NET 7 (see my [C# 11 features post](/blog/2022-11-02-csharp-11-features/)), [TypeScript 4.9](https://devblogs.microsoft.com/typescript/announcing-typescript-4-9/) (released 15 November 2022) and [Rust 1.66](https://blog.rust-lang.org/2022/12/15/Rust-1.66.0.html) (released 15 December 2022).

## What a tuple is, and what it isn't

A tuple is a fixed-length, ordered group of values where each position can have a different type. It's an anonymous product type: you get structure without declaring a named type. The classic use is returning more than one value from a function, such as a parse result and an error flag, or a minimum and maximum.

One common claim I want to correct up front: tuples are *not* universally immutable. Of the three languages here, C# value tuples have mutable fields, TypeScript tuples are mutable arrays unless you mark them `readonly`, and Rust tuples are mutable when the binding is `mut`. Immutability is a property of each language's rules, not of tuples in general.

## C#: value types with compile-time names

C# has had two tuple types. `System.Tuple<...>` is the older reference type with read-only `Item1`, `Item2` properties. The tuple syntax introduced in C# 7.0 maps to [`System.ValueTuple<...>`](https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/value-tuples), a struct with public, *mutable* fields.

The move to a struct was about allocation. Every `System.Tuple` is a heap object the garbage collector has to track, which adds up when a hot loop returns pairs millions of times; a `ValueTuple` of two `int`s is stored inline (on the stack for a local, or inside its containing object) and needs no separate allocation. The trade-off is that structs are copied by value on every assignment, parameter pass and return, so a seven-element tuple of `decimal`s or large structs gets copied in full each time. Past a few small elements, a class or a `record` (passed by reference) is usually cheaper as well as clearer. Element names like `Min` and `Max` are a compiler feature only. They're stored as metadata on method signatures, but at runtime the fields are still `Item1` and `Item2`, so reflection and serialisers that walk fields won't see your names.

```csharp
// Program.cs - .NET 7 console app (top-level statements)
var stats = MinMax(new[] { 4, 9, 1, 7 });
Console.WriteLine($"{stats.Min} to {stats.Max}");   // 1 to 9
Console.WriteLine(stats.Item1 == stats.Min);         // True: names are aliases

// Fields are mutable because ValueTuple is a struct with public fields
stats.Max = 100;

// Deconstruction
var (low, high) = stats;
Console.WriteLine($"{low}, {high}");                 // 1, 100

// Tuple equality (C# 7.3+) compares element by element
Console.WriteLine((1, "a") == (1, "a"));             // True

// Tuple patterns in a switch expression (C# 8+)
string Describe((int Min, int Max) range) => range switch
{
    (0, 0) => "empty",
    var (min, max) when min == max => "single value",
    _ => "range"
};
Console.WriteLine(Describe(stats));                  // range

static (int Min, int Max) MinMax(int[] values)
{
    var min = int.MaxValue;
    var max = int.MinValue;
    foreach (var v in values)
    {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return (min, max);
}
```

A trap worth knowing: if you write `ValueTuple<int, string> t = (id: 10, name: "hello");`, the names are discarded because the target type has none, and the compiler raises warning CS8123. Declare the names on the type instead, as in `(int Id, string Name) t = (10, "hello");`. Because names are only matched by position, assigning `(int A, int B)` to `(int B, int A)` doesn't swap anything either. It copies position to position, and the names just mislead you.

## TypeScript: typed arrays and nothing more

A TypeScript tuple is a type-level description of a JavaScript array. At runtime there is no tuple, just an `Array`. That shapes everything else.

```typescript
// tuples.ts - compiles with TypeScript 4.9 (tsc --strict)
function minMax(values: number[]): [min: number, max: number] {
  return [Math.min(...values), Math.max(...values)];
}

const stats = minMax([4, 9, 1, 7]);
const [low, high] = stats;
console.log(low, high); // 1 9

// Without an annotation, an array literal is inferred as an array, not a tuple
const loose = [10, "hello"]; // (string | number)[]
console.log(loose); // [10, "hello"]
const exact = [10, "hello"] as const; // readonly [10, "hello"]
console.log(exact); // [10, "hello"]

// Ordinary tuple types still allow array mutation methods
const pair: [number, string] = [10, "hello"];
pair.push(42); // compiles, and pair now has three elements at runtime
console.log(pair.length); // 3, even though the type says 2

// readonly tuples close that gap
const safePair: readonly [number, string] = [10, "hello"];
// safePair.push(42); // error: Property 'push' does not exist
console.log(safePair[1]); // hello

// Optional and rest elements
type Point = [x: number, y: number, z?: number];
type Command = [name: string, ...args: string[]];
const p: Point = [1, 2];
console.log(p.length); // 2
const cmd: Command = ["deploy", "--env", "prod"];
console.log(cmd.slice(1)); // ["--env", "prod"]

// Equality is reference equality, as for any array
const a: [number, string] = [1, "a"];
const b: [number, string] = [1, "a"];
console.log(a === b); // false
```

The labels in `[min: number, max: number]` (added in TypeScript 4.0) are documentation for editors and error messages. You still access elements by index, and destructuring ignores them. `readonly` tuples and `as const` arrived in 3.4, and optional and rest elements in 3.0, so all of this is well established.

The `push` hole is the one I'd flag in code review. If a tuple is meant to be a fixed shape, type it `readonly`, especially in function return types.

## Rust: real values, structural comparison

Rust tuples are genuine values laid out in memory, with fields accessed as `.0`, `.1` and so on. They follow the normal ownership rules: a tuple is `Copy` if every element is `Copy`, and it's mutable only if the binding is declared `mut`. The [standard library](https://doc.rust-lang.org/1.66.0/std/primitive.tuple.html) implements `Debug`, `PartialEq`, `Eq`, `PartialOrd`, `Ord`, `Hash` and `Default` for tuples of up to 12 elements (`Clone` and `Copy` are generated by the compiler and work at any length), so equality and sorting work out of the box. The empty tuple `()`, the unit type, is what functions return when they return nothing.

```rust
// main.rs - Rust 1.66 (cargo run)
fn min_max(values: &[i32]) -> Option<(i32, i32)> {
    let first = *values.first()?;
    Some(values.iter().fold((first, first), |(lo, hi), &v| (lo.min(v), hi.max(v))))
}

fn describe(range: (i32, i32)) -> &'static str {
    match range {
        (0, 0) => "empty",
        (lo, hi) if lo == hi => "single value",
        _ => "range",
    }
}

// When positions need names, a tuple struct or a struct is the idiomatic step up
struct Meters(f64);

fn main() {
    let mut stats = min_max(&[4, 9, 1, 7]).expect("non-empty input");
    println!("{} to {}", stats.0, stats.1); // 1 to 9

    stats.1 = 100; // allowed only because the binding is `mut`
    let (low, high) = stats;
    println!("{low}, {high}"); // 1, 100

    // Structural equality and lexicographic ordering
    assert_eq!((1, "a"), (1, "a"));
    assert!((1, 9) < (2, 0));

    println!("{}", describe(stats)); // range

    let distance = Meters(42.0);
    println!("{} m", distance.0);
}
```

Rust has no named tuple elements. Its answer is that if positions need names, you want a struct. Tuple structs like `Meters(f64)` sit in between: they give a distinct type with positional fields, which is how the newtype pattern works.

## Side by side

| | C# 11 | TypeScript 4.9 | Rust 1.66 |
|---|---|---|---|
| Runtime representation | `ValueTuple` struct | Plain JavaScript array | Value type, laid out in memory |
| Element names | Compile-time aliases for `Item1`... | Labels for tooling only (4.0+) | None; use a struct |
| Mutable by default | Yes, public fields | Yes, unless `readonly` | No, needs `let mut` |
| `==` compares | Element values (C# 7.3+) | Array reference | Element values (`PartialEq`) |
| Pattern matching | Tuple patterns in `switch` | Destructuring only | Full `match` with guards |
| Length fixed by the type | Yes | No (compile-time only, `push` still works) | Yes |

The pattern I take from this: C# and Rust treat a tuple as a real value with structural equality, and TypeScript treats it as a type annotation over an array. If you move between the three, equality is the difference most likely to bite you. `(1, "a") == (1, "a")` is true in C# and Rust, and comparing two equal TypeScript tuples with `===` is false ([TypeScript 4.8](https://devblogs.microsoft.com/typescript/announcing-typescript-4-8/) and later even reject `===` against an array literal outright, because it can never be true).

## The middle ground before a full named type

Each language has a step between "anonymous tuple" and "full class", and it's worth knowing before you decide a tuple is too weak.

In C#, that step is the `record struct`, added in [C# 10](https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/record). `public record struct Range(int Min, int Max);` is one line, stays a value type like `ValueTuple` (no heap allocation), and gives you real property names that survive at runtime, so reflection and serialisers see `Min` and `Max` instead of `Item1` and `Item2`. You also get value equality, deconstruction and a readable `ToString()`. Positional properties on a `record struct` are settable, which matches `ValueTuple`; if you want immutability, declare it `readonly record struct` and the properties become `init`-only. The cost is that it's a declared type, so it lives somewhere in the codebase and has to be named well. I'd use a `ValueTuple` inside a method or private helper, a `readonly record struct` for small values that travel between classes, and a `record` class once the data gets bigger than a few fields or needs reference semantics.

In TypeScript, the choice for a function return is between a labelled tuple and an object type or interface. A tuple return such as `[min: number, max: number]` makes destructuring short and lets callers pick their own names, which is why React's `useState` returns one. An object type `{ min: number; max: number }` forces callers to use the real names, survives reordering, and lets you add a third field later without breaking anyone who destructures. My rule: tuples for returns with two elements of different types where callers will always rename them; object types for everything else, and interfaces when the shape is shared across modules.

Rust's equivalent is the tuple struct covered above, with a named struct as the next step.

## When to reach for a tuple, and when not to

My rule of thumb is the same in all three languages: tuples are for **short-lived, local, positional data**. Returning two values from a private helper, iterating over key/value pairs, or matching on a pair of states in a `switch` or `match` are all good fits.

I'd avoid them when:

- **The data crosses a public API boundary.** A `(int, int)` return type tells the caller nothing about which value is which. In C#, a `record` is one line and gives you named properties, value equality and a useful `ToString()`. In Rust, a struct with `#[derive(Debug, PartialEq)]` costs about the same. In TypeScript, an object type `{ min: number; max: number }` is clearer than any tuple.
- **There are more than three elements.** By the fourth position, nobody remembers what `.3` or `Item4` means.
- **The data is serialised.** C# tuple names vanish at runtime: Newtonsoft.Json writes `Item1` and `Item2`, and System.Text.Json writes `{}` unless you set `JsonSerializerOptions.IncludeFields = true`. TypeScript tuples serialise as arrays, which is compact but fragile when the shape changes.
- **Two positions share a type.** `(int, int)` or `[string, string]` lets callers swap arguments silently. Named fields or a newtype prevent that.

If you're unsure, start with a named type. Moving from a tuple to a named type later means touching every call site, while the reverse rarely comes up.
