---
title: "Azure Quantum: Introduction to Quantum Computing"
author: Michael John Peña
draft: false
date: 2022-05-26
tags:
  - Azure
  - quantum
  - computing
  - qsharp
---

## Understanding Quantum Computing

Key concepts:
- **Qubits**: Quantum bits that can be in superposition
- **Superposition**: Existing in multiple states simultaneously
- **Entanglement**: Correlated quantum states
- **Quantum Gates**: Operations on qubits

## Setting Up Azure Quantum

Create a quantum workspace:

```bicep
resource quantumWorkspace 'Microsoft.Quantum/workspaces@2022-01-10-preview' = {
  name: 'quantum-workspace'
  location: 'eastus'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    providers: [
      {
        providerId: 'ionq'
        providerSku: 'Basic'
      }
      {
        providerId: 'microsoft-qc'
        providerSku: 'Basic'
      }
    ]
    storageAccount: storageAccount.id
  }
}
```

## Your First Q# Program

Write a simple quantum program:

```qsharp
namespace QuantumHelloWorld {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Measurement;

    @EntryPoint()
    operation MeasureSuperposition() : Result {
        // Allocate a qubit
        use qubit = Qubit();

        // Put the qubit in superposition
        H(qubit);

        // Measure the qubit
        let result = M(qubit);

        // Reset the qubit before releasing
        Reset(qubit);

        return result;
    }

    operation RunMultipleMeasurements(count : Int) : Int[] {
        mutable results = [0, 0];

        for _ in 1..count {
            let measurement = MeasureSuperposition();
            if measurement == Zero {
                set results w/= 0 <- results[0] + 1;
            } else {
                set results w/= 1 <- results[1] + 1;
            }
        }

        return results;
    }
}
```

## Quantum Entanglement

Create entangled qubits:

```qsharp
namespace QuantumEntanglement {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Measurement;

    @EntryPoint()
    operation CreateBellPair() : (Result, Result) {
        use (qubit1, qubit2) = (Qubit(), Qubit());

        // Put qubit1 in superposition
        H(qubit1);

        // Entangle qubit2 with qubit1 using CNOT
        CNOT(qubit1, qubit2);

        // Measure both qubits
        let result1 = M(qubit1);
        let result2 = M(qubit2);

        // Reset qubits
        ResetAll([qubit1, qubit2]);

        // Results will always be correlated!
        return (result1, result2);
    }

    operation TestEntanglement(iterations : Int) : (Int, Int, Int, Int) {
        mutable (zeroZero, zeroOne, oneZero, oneOne) = (0, 0, 0, 0);

        for _ in 1..iterations {
            let (r1, r2) = CreateBellPair();

            if r1 == Zero and r2 == Zero {
                set zeroZero += 1;
            } elif r1 == Zero and r2 == One {
                set zeroOne += 1;
            } elif r1 == One and r2 == Zero {
                set oneZero += 1;
            } else {
                set oneOne += 1;
            }
        }

        return (zeroZero, zeroOne, oneZero, oneOne);
    }
}
```

## Quantum Random Number Generator

Create truly random numbers:

```qsharp
namespace QuantumRandom {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Measurement;
    open Microsoft.Quantum.Math;
    open Microsoft.Quantum.Convert;

    operation GenerateRandomBit() : Result {
        use qubit = Qubit();
        H(qubit);
        let result = M(qubit);
        Reset(qubit);
        return result;
    }

    operation GenerateRandomInt(max : Int) : Int {
        mutable result = 0;
        let nBits = BitSizeI(max);

        repeat {
            mutable bits = [];
            for _ in 1..nBits {
                set bits += [GenerateRandomBit()];
            }

            set result = ResultArrayAsInt(bits);
        }
        until result <= max;

        return result;
    }

    operation GenerateRandomBytes(count : Int) : Int[] {
        mutable bytes = [];

        for _ in 1..count {
            mutable byte = 0;
            for bit in 0..7 {
                if GenerateRandomBit() == One {
                    set byte += PowI(2, bit);
                }
            }
            set bytes += [byte];
        }

        return bytes;
    }
}
```

## Grover's Search Algorithm

Quantum search for database lookup:

```qsharp
namespace GroverSearch {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Measurement;
    open Microsoft.Quantum.Math;
    open Microsoft.Quantum.Arrays;

    operation GroverSearch(nQubits : Int, markedElement : Int) : Int {
        // Calculate optimal number of iterations
        let nIterations = Round(PI() / 4.0 * Sqrt(IntAsDouble(2^nQubits)));

        use qubits = Qubit[nQubits];

        // Initialize superposition
        ApplyToEach(H, qubits);

        // Grover iterations
        for _ in 1..nIterations {
            // Oracle - marks the target state
            Oracle(qubits, markedElement);

            // Diffusion operator
            DiffusionOperator(qubits);
        }

        // Measure and return result
        let result = MeasureInteger(LittleEndian(qubits));
        ResetAll(qubits);

        return result;
    }

    operation Oracle(qubits : Qubit[], markedElement : Int) : Unit is Adj + Ctl {
        // Convert marked element to bit pattern
        let bits = IntAsBoolArray(markedElement, Length(qubits));

        // Apply X gates to match the marked element pattern
        ApplyPauliFromBitString(PauliX, false, bits, qubits);

        // Multi-controlled Z gate
        Controlled Z(Most(qubits), Tail(qubits));

        // Undo X gates
        ApplyPauliFromBitString(PauliX, false, bits, qubits);
    }

    operation DiffusionOperator(qubits : Qubit[]) : Unit is Adj + Ctl {
        // Apply H to all qubits
        ApplyToEach(H, qubits);

        // Apply X to all qubits
        ApplyToEach(X, qubits);

        // Multi-controlled Z
        Controlled Z(Most(qubits), Tail(qubits));

        // Undo X and H
        ApplyToEach(X, qubits);
        ApplyToEach(H, qubits);
    }
}
```

## Running on Azure Quantum

Submit jobs to quantum hardware:

```python
# Python code to run Q# on Azure Quantum
from azure.quantum import Workspace
from azure.quantum.qiskit import AzureQuantumProvider

# Connect to Azure Quantum workspace
workspace = Workspace(
    subscription_id="your-subscription-id",
    resource_group="quantum-rg",
    name="quantum-workspace",
    location="eastus"
)

# List available targets
print("Available targets:")
for target in workspace.get_targets():
    print(f"  - {target.name}")

# Submit Q# job
from azure.quantum import Job

job = Job.from_input_data(
    workspace=workspace,
    name="grover-search",
    target="ionq.simulator",
    input_data={
        "program": open("GroverSearch.qs").read(),
        "entryPoint": "GroverSearch.GroverSearch",
        "arguments": [4, 7]  # 4 qubits, searching for 7
    }
)

# Wait for results
job.wait_for_completion()
results = job.get_results()
print(f"Search result: {results}")
```

## Cost Estimation

Estimate costs before running:

```python
from azure.quantum import Workspace

workspace = Workspace(...)

# Estimate job cost
estimation = workspace.estimate_cost(
    target="ionq.qpu",
    input_data={
        "program": program,
        "shots": 1000
    }
)

print(f"Estimated cost: ${estimation.estimated_total}")
print(f"Estimated time: {estimation.estimated_time}")
```

## Summary

Azure Quantum provides:

- Access to multiple quantum hardware providers
- Q# programming language
- Quantum simulators for development
- Integration with classical computing
- Cost estimation tools

Start exploring quantum algorithms for optimization, cryptography, and simulation.
