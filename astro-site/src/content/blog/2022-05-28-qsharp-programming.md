---
title: "Q# Programming: Building Quantum Applications"
author: Michael John Peña
draft: false
date: 2022-05-28
tags:
  - quantum
  - qsharp
  - azure
  - programming

---

I wrote "Q# Programming: Building Quantum Applications" to share practical, production-minded guidance on this topic.

## Q# Language Basics

Setting up a Q# project:

```bash
# Install Q# templates
dotnet new -i Microsoft.Quantum.ProjectTemplates

# Create new Q# application
dotnet new console -lang Q# -o QuantumApp
cd QuantumApp
```

## Operations and Functions

```qsharp
namespace QuantumBasics {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Measurement;
    open Microsoft.Quantum.Math;
    open Microsoft.Quantum.Convert;

    // Operation: Can have quantum effects
    operation PrepareQubit(qubit : Qubit, basis : Pauli) : Unit {
        if basis == PauliX {
            H(qubit);  // |+⟩ state
        } elif basis == PauliY {
            H(qubit);
            S(qubit);  // |i⟩ state
        }
        // PauliZ leaves qubit in |0⟩
    }

    // Function: Classical, no quantum effects
    function CalculateRotationAngle(probability : Double) : Double {
        return 2.0 * ArcSin(Sqrt(probability));
    }

    // Main entry point
    @EntryPoint()
    operation Main() : Unit {
        use qubit = Qubit();

        // Prepare in X basis
        PrepareQubit(qubit, PauliX);

        // Measure
        let result = M(qubit);
        Message($"Measurement result: {result}");

        Reset(qubit);
    }
}
```

## Working with Qubit Arrays

```qsharp
namespace QubitArrays {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Measurement;
    open Microsoft.Quantum.Arrays;

    operation CreateGHZState(n : Int) : Result[] {
        use qubits = Qubit[n];

        // Put first qubit in superposition
        H(qubits[0]);

        // Entangle all other qubits
        for i in 1..n-1 {
            CNOT(qubits[0], qubits[i]);
        }

        // Measure all qubits
        let results = ForEach(M, qubits);

        // Reset all qubits
        ResetAll(qubits);

        return results;
    }

    operation QuantumWalk(steps : Int) : Int {
        use position = Qubit[8];  // 8 qubits for position (256 positions)
        use coin = Qubit();

        // Initialize position to center
        X(position[7]);  // Start at position 128

        for _ in 1..steps {
            // Flip coin (Hadamard)
            H(coin);

            // Conditional shift based on coin
            // If coin is |1⟩, increment position
            Controlled IncrementByInteger([coin], (LittleEndian(position), 1));

            // Reset coin for next step
            if M(coin) == One {
                X(coin);
            }
        }

        // Measure final position
        let finalPosition = MeasureInteger(LittleEndian(position));

        Reset(coin);
        ResetAll(position);

        return finalPosition;
    }
}
```

## Quantum Teleportation

```qsharp
namespace QuantumTeleportation {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Measurement;

    operation Teleport(message : Qubit, target : Qubit) : Unit {
        use auxiliary = Qubit();

        // Create Bell pair between auxiliary and target
        H(auxiliary);
        CNOT(auxiliary, target);

        // Bell measurement on message and auxiliary
        CNOT(message, auxiliary);
        H(message);

        let m1 = M(message);
        let m2 = M(auxiliary);

        // Apply corrections based on measurement
        if m2 == One {
            X(target);
        }
        if m1 == One {
            Z(target);
        }

        // Cleanup
        Reset(message);
        Reset(auxiliary);
    }

    @EntryPoint()
    operation TestTeleportation() : Unit {
        use (message, target) = (Qubit(), Qubit());

        // Prepare message qubit in |+⟩ state
        H(message);

        Message("Before teleportation:");
        Message($"Message qubit prepared in |+⟩ state");

        // Teleport
        Teleport(message, target);

        // Verify by measuring in X basis
        H(target);
        let result = M(target);

        Message("After teleportation:");
        Message($"Target measurement (X basis): {result}");
        // Should be Zero (|+⟩ → |0⟩ in X basis)

        Reset(target);
    }
}
```

## Quantum Phase Estimation

```qsharp
namespace PhaseEstimation {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Measurement;
    open Microsoft.Quantum.Math;
    open Microsoft.Quantum.Convert;
    open Microsoft.Quantum.Arithmetic;

    operation EstimatePhase(
        oracle : (Qubit => Unit is Adj + Ctl),
        eigenstate : Qubit,
        precision : Int
    ) : Double {
        use register = Qubit[precision];

        // Initialize register in superposition
        ApplyToEach(H, register);

        // Apply controlled-U^(2^k) operations
        for k in 0..precision-1 {
            let power = 2^k;
            for _ in 1..power {
                Controlled oracle([register[k]], eigenstate);
            }
        }

        // Apply inverse QFT
        Adjoint QFTLE(LittleEndian(register));

        // Measure and convert to phase
        let measured = MeasureInteger(LittleEndian(register));
        let phase = IntAsDouble(measured) / IntAsDouble(2^precision);

        ResetAll(register);

        return phase;
    }

    operation TestPhaseEstimation() : Double {
        use eigenstate = Qubit();

        // Prepare eigenstate of T gate (eigenvalue e^(iπ/4))
        // T|1⟩ = e^(iπ/4)|1⟩
        X(eigenstate);  // Prepare |1⟩

        let phase = EstimatePhase(T, eigenstate, 4);

        Reset(eigenstate);

        Message($"Estimated phase: {phase}");
        Message($"Expected phase: 0.125 (π/4 / 2π)");

        return phase;
    }
}
```

## Variational Quantum Eigensolver (VQE)

```qsharp
namespace VQE {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Measurement;
    open Microsoft.Quantum.Math;

    // Ansatz circuit with parameterized rotations
    operation Ansatz(qubits : Qubit[], theta : Double[]) : Unit is Adj + Ctl {
        let n = Length(qubits);

        // Layer of single-qubit rotations
        for i in 0..n-1 {
            Ry(theta[i], qubits[i]);
        }

        // Entangling layer
        for i in 0..n-2 {
            CNOT(qubits[i], qubits[i+1]);
        }

        // Another layer of rotations
        for i in 0..n-1 {
            Ry(theta[n + i], qubits[i]);
        }
    }

    // Measure expectation value of Pauli operator
    operation MeasurePauliExpectation(
        qubits : Qubit[],
        paulis : Pauli[]
    ) : Double {
        mutable sum = 0.0;
        let shots = 1000;

        for _ in 1..shots {
            // Rotate to measurement basis
            for i in 0..Length(qubits)-1 {
                if paulis[i] == PauliX {
                    H(qubits[i]);
                } elif paulis[i] == PauliY {
                    Adjoint S(qubits[i]);
                    H(qubits[i]);
                }
            }

            // Measure
            mutable parity = 0;
            for i in 0..Length(qubits)-1 {
                if paulis[i] != PauliI {
                    if M(qubits[i]) == One {
                        set parity += 1;
                    }
                }
            }

            // Expectation value contribution
            set sum += (parity % 2 == 0) ? 1.0 | -1.0;

            // Reset for next shot
            ResetAll(qubits);
        }

        return sum / IntAsDouble(shots);
    }

    @EntryPoint()
    operation RunVQE() : Double {
        use qubits = Qubit[2];

        // Initial parameters
        let theta = [0.5, 0.5, 0.5, 0.5];

        // Prepare ansatz state
        Ansatz(qubits, theta);

        // Measure ZZ expectation
        let expectation = MeasurePauliExpectation(qubits, [PauliZ, PauliZ]);

        Message($"ZZ expectation: {expectation}");

        return expectation;
    }
}
```

## Unit Testing Q# Code

```qsharp
namespace QuantumTests {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Diagnostics;

    @Test("QuantumSimulator")
    operation TestHadamardCreatesEqualSuperposition() : Unit {
        use qubit = Qubit();

        H(qubit);

        // Assert equal superposition using AssertMeasurementProbability
        AssertMeasurementProbability(
            [PauliZ], [qubit], Zero, 0.5,
            "Hadamard should create 50/50 superposition",
            1e-5
        );

        Reset(qubit);
    }

    @Test("QuantumSimulator")
    operation TestCNOTEntanglement() : Unit {
        use (control, target) = (Qubit(), Qubit());

        // Create Bell state
        H(control);
        CNOT(control, target);

        // Assert entanglement - measuring one determines the other
        let result1 = M(control);
        let result2 = M(target);

        Fact(
            result1 == result2,
            "Entangled qubits should always give same measurement"
        );

        ResetAll([control, target]);
    }
}
```

## Summary

Q# programming provides:

- High-level quantum abstractions
- Built-in resource management
- Classical-quantum hybrid programs
- Comprehensive standard library
- Unit testing support

Master Q# to build practical quantum applications.


