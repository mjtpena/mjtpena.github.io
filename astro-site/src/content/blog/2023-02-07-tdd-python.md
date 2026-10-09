---
title: "TDD (Test-Driven Development) Overview with Python Example"
description: "This cycle is repeated for each new piece of functionality. The result is a suite of tests that provide confidence in the code and make it easier to…"
author: Michael John Peña
draft: false
date: 2023-02-07
url: /blog/tdd-python/
tags:
  - TDD
  - Testing
  - Python
  - Software
---

## How TDD Works

TDD is based on the Red-Green-Refactor cycle:

1. Write a test: write a test that fails because the functionality it tests doesn’t exist yet.
2. Make the test pass: write the minimum amount of code necessary to make the test pass.
3. Refactor: look for opportunities to improve the code and make it easier to maintain.

This cycle is repeated for each new piece of functionality. The result is a suite of tests that provide confidence in the code and make it easier to maintain and extend.

Here's an example of how TDD works in Python:

## Write a test

Start by writing a test that fails because the code it is testing hasn't been written yet. This test should describe the desired behavior of the code that will be written.

```python
def test_addition():
    assert add(2, 3) == 5
```

## Run the test

Running the test should result in an error, because the add function hasn't been defined yet.

```bash
NameError: name 'add' is not defined
```

## Write Code

Now that the test is written, write just enough code to make the test pass.

```python
def add(a, b):
    return a + b
```

## Run the test (again)

```bash
.

-------------------------------------------------------------------
```
