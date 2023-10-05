---
title: "TDD (Test-Driven Development) Overview with Python Example"
author: Michael John Peña
draft: false
date: 2023-02-07
image: /2023/02/tdd-python.png
url: /blog/tdd-python/
tags:
  - TDD
  - Testing
  - Python
  - Software
---

Test-Driven Development (TDD) is a software development approach where developers write tests before writing the code itself. TDD emphasizes writing tests that fail initially, then writing the minimum amount of code necessary to pass the tests. This process is repeated until the desired functionality is complete. TDD provides a number of benefits, including increased confidence in the code, better documentation, and reduced time spent debugging.

# How TDD Works

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

----------------------------------------------------------------------
Ran 1 test in 0.000s

OK
```

## Refactor the code

Once the tests pass, take a moment to refactor the code to make it cleaner and more efficient.

```python
def add(a, b):
    return a + b
```

## Repeat

Repeat the process, writing a new test, running the tests, writing the code, and refactoring, for each new feature or bug fix.

# Summary

TDD is a powerful tool for ensuring that code is written to meet the desired specifications and that bugs are caught early in the development process. By following this methodology, developers can build high-quality code faster and with greater confidence.

In conclusion, TDD is a valuable software development practice that should be part of every developer's toolkit. By writing tests first and following the process of running tests, writing code, and refactoring, developers can ensure that their code is high-quality, reliable, and easy to maintain.
