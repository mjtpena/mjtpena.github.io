---
title: "Quantum Simulators: Testing Without Quantum Hardware"
author: Michael John Peña
draft: false
date: 2022-05-29
tags:
  - quantum
  - simulators
  - azure
  - development

---

I wrote "Quantum Simulators: Testing Without Quantum Hardware" to share practical, production-minded guidance on this topic.

## Types of Quantum Simulators

Azure Quantum provides several simulator options:

```python
from azure.quantum import Workspace
from azure.quantum.cirq import AzureQuantumService

# Connect to workspace
workspace = Workspace(
    subscription_id="...",
    resource_group="quantum-rg",
    name="quantum-workspace"
)

# Available simulators
simulators = [
    "microsoft.simulator.fullstate",      # Full state simulator
    "microsoft.simulator.sparsesimulator", # Sparse simulator
    "microsoft.simulator.resources",       # Resource estimator
    "ionq.simulator",                      # IonQ simulator
    "quantinuum.sim.h1-1sc",              # Quantinuum simulator
]
```

## Full State Simulator

Simulates all 2^n amplitudes:

```qsharp
namespace FullStateSimulation {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Diagnostics;

    @EntryPoint()
    operation SimulateQuantumState() : Unit {
        use qubits = Qubit[3];

        // Create complex superposition
        H(qubits[0]);
        CNOT(qubits[0], qubits[1]);
        T(qubits[2]);
        CNOT(qubits[1], qubits[2]);

        // Dump the full state vector
        DumpMachine();

        // Show state in different bases
        Message("\nState in computational basis:");
        DumpRegister((), qubits);

        ResetAll(qubits);
    }
}
```

Run with the full state simulator:

```bash
dotnet run --simulator FullStateSimulator
```

## Sparse Simulator

Efficient for states with few non-zero amplitudes:

```qsharp
namespace SparseSimulation {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;

    // Good for Grover's algorithm - only one marked state
    operation SparseGroverIteration(qubits : Qubit[], markedState : Int) : Unit {
        // Oracle marks only one state - sparse!
        let n = Length(qubits);

        // Convert marked state to bit pattern
        for i in 0..n-1 {
            if ((markedState >>> i) &&& 1) == 0 {
                X(qubits[i]);
            }
        }

        Controlled Z(qubits[0..n-2], qubits[n-1]);

        for i in 0..n-1 {
            if ((markedState >>> i) &&& 1) == 0 {
                X(qubits[i]);
            }
        }
    }

    @EntryPoint()
    operation RunSparseSimulation() : Unit {
        use qubits = Qubit[10];  // 1024 states but only one marked

        ApplyToEach(H, qubits);
        SparseGroverIteration(qubits, 42);

        ResetAll(qubits);
        Message("Sparse simulation completed efficiently!");
    }
}
```

## Resource Estimator

Estimate resources without full simulation:

```qsharp
namespace ResourceEstimation {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;

    operation EstimateShorsResources(N : Int) : Unit {
        // Simplified Shor's algorithm structure
        let nQubits = 2 * BitSizeI(N) + 3;

        use register = Qubit[nQubits];

        // QFT-like operations
        for i in 0..nQubits-1 {
            H(register[i]);
            for j in i+1..nQubits-1 {
                Controlled R1([register[j]], (PI() / PowD(2.0, IntAsDouble(j - i)), register[i]));
            }
        }

        // Modular exponentiation (simplified)
        for i in 0..nQubits/2-1 {
            CNOT(register[i], register[i + nQubits/2]);
        }

        // Inverse QFT
        for i in 0..nQubits-1 {
            for j in 0..i-1 {
                Controlled R1([register[j]], (-PI() / PowD(2.0, IntAsDouble(i - j)), register[i]));
            }
            H(register[i]);
        }

        ResetAll(register);
    }

    @EntryPoint()
    operation Main() : Unit {
        EstimateShorsResources(15);
    }
}
```

Run resource estimation:

```bash
dotnet run --simulator ResourcesEstimator
```

Output example:
```
Metric          Sum
CNOT            512
QubitClifford   1024
R               2048
T               4096
Measure         32
QubitCount      35
Depth           8192
```

## Python Simulation with Qiskit

```python
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator
from qiskit.visualization import plot_histogram
import matplotlib.pyplot as plt

# Create quantum circuit
qc = QuantumCircuit(3, 3)

# Add gates
qc.h(0)
qc.cx(0, 1)
qc.cx(1, 2)
qc.measure([0, 1, 2], [0, 1, 2])

# Different simulator backends
simulators = {
    'statevector': AerSimulator(method='statevector'),
    'matrix_product_state': AerSimulator(method='matrix_product_state'),
    'stabilizer': AerSimulator(method='stabilizer'),  # For Clifford circuits
    'extended_stabilizer': AerSimulator(method='extended_stabilizer'),
}

# Run on statevector simulator
backend = simulators['statevector']
job = backend.run(transpile(qc, backend), shots=1000)
result = job.result()
counts = result.get_counts(qc)

print("Measurement results:", counts)
plot_histogram(counts)
plt.savefig('simulation_results.png')


# Noise simulation
from qiskit_aer.noise import NoiseModel, depolarizing_error

# Create noise model
noise_model = NoiseModel()
error_1q = depolarizing_error(0.01, 1)  # 1% error on single-qubit gates
error_2q = depolarizing_error(0.05, 2)  # 5% error on two-qubit gates

noise_model.add_all_qubit_quantum_error(error_1q, ['h', 'x', 'y', 'z'])
noise_model.add_all_qubit_quantum_error(error_2q, ['cx'])

# Run noisy simulation
noisy_backend = AerSimulator(noise_model=noise_model)
noisy_job = noisy_backend.run(transpile(qc, noisy_backend), shots=1000)
noisy_result = noisy_job.result()
noisy_counts = noisy_result.get_counts(qc)

print("Noisy measurement results:", noisy_counts)
```

## Cirq Simulation

```python
import cirq
import numpy as np

# Create qubits
qubits = cirq.LineQubit.range(3)

# Build circuit
circuit = cirq.Circuit([
    cirq.H(qubits[0]),
    cirq.CNOT(qubits[0], qubits[1]),
    cirq.CNOT(qubits[1], qubits[2]),
    cirq.measure(*qubits, key='result')
])

print("Circuit:")
print(circuit)

# Simulate with different simulators
# 1. State vector simulator
sv_simulator = cirq.Simulator()
sv_result = sv_simulator.simulate(circuit[:-1])  # Without measurement
print("\nState vector:")
print(sv_result.final_state_vector)

# 2. Sampling simulator
sample_result = sv_simulator.run(circuit, repetitions=1000)
print("\nMeasurement histogram:")
print(sample_result.histogram(key='result'))

# 3. Density matrix simulator (for mixed states)
dm_simulator = cirq.DensityMatrixSimulator()
dm_result = dm_simulator.simulate(circuit[:-1])
print("\nDensity matrix:")
print(dm_result.final_density_matrix)

# 4. Noisy simulation
noise_model = cirq.ConstantQubitNoiseModel(
    cirq.depolarize(p=0.01)
)
noisy_simulator = cirq.DensityMatrixSimulator(noise=noise_model)
noisy_result = noisy_simulator.run(circuit, repetitions=1000)
print("\nNoisy measurement histogram:")
print(noisy_result.histogram(key='result'))
```

## Performance Comparison

```python
import time
import numpy as np

def benchmark_simulation(num_qubits, shots=1000):
    """Benchmark different simulation methods."""
    from qiskit import QuantumCircuit
    from qiskit_aer import AerSimulator

    # Create random circuit
    qc = QuantumCircuit(num_qubits)
    for i in range(num_qubits):
        qc.h(i)
    for i in range(num_qubits - 1):
        qc.cx(i, i + 1)
    qc.measure_all()

    methods = ['statevector', 'matrix_product_state']
    results = {}

    for method in methods:
        try:
            backend = AerSimulator(method=method)
            start = time.time()
            job = backend.run(qc, shots=shots)
            job.result()
            elapsed = time.time() - start
            results[method] = elapsed
            print(f"{method}: {elapsed:.3f}s for {num_qubits} qubits")
        except Exception as e:
            print(f"{method}: Failed - {e}")

    return results

# Run benchmarks
for n in [10, 15, 20, 25]:
    print(f"\n=== {n} qubits ===")
    benchmark_simulation(n)
```

## Summary

Quantum simulators enable:

- Algorithm development without hardware access
- Full state inspection for debugging
- Resource estimation for planning
- Noise modeling for realistic testing
- Performance benchmarking

Essential tools for quantum software development.


