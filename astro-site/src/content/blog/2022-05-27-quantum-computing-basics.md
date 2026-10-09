---
title: "Quantum Computing Basics: Understanding Qubits and Gates"
description: "Classical computers use bits that are either 0 or 1. Quantum computers use qubits that can exist in superposition - a combination of both states simultaneously."
author: Michael John Peña
draft: false
date: 2022-05-27
tags:
  - quantum
  - computing
  - qubits
  - Education
---

## Classical vs Quantum Bits

Classical computers use bits that are either 0 or 1. Quantum computers use qubits that can exist in superposition - a combination of both states simultaneously.

```python
# Classical bit representation
classical_bit = 0  # or 1

# Quantum state representation (using numpy)
import numpy as np

# |0⟩ state vector
state_zero = np.array([1, 0])

# |1⟩ state vector
state_one = np.array([0, 1])

# Superposition state: |+⟩ = (|0⟩ + |1⟩) / √2
state_plus = np.array([1/np.sqrt(2), 1/np.sqrt(2)])

# Probability of measuring |0⟩
prob_zero = np.abs(state_plus[0])**2  # 0.5

# Probability of measuring |1⟩
prob_one = np.abs(state_plus[1])**2   # 0.5
```

## Quantum Gates as Matrices

Quantum gates are represented as unitary matrices:

```python
import numpy as np

# Pauli-X gate (quantum NOT)
X = np.array([[0, 1],
              [1, 0]])

# Pauli-Y gate
Y = np.array([[0, -1j],
              [1j, 0]])

# Pauli-Z gate
Z = np.array([[1, 0],
              [0, -1]])

# Hadamard gate (creates superposition)
H = np.array([[1, 1],
              [1, -1]]) / np.sqrt(2)

# Phase gate
S = np.array([[1, 0],
              [0, 1j]])

# T gate (π/8 gate)
T = np.array([[1, 0],
              [0, np.exp(1j * np.pi / 4)]])

# Apply gate to qubit state
def apply_gate(gate, state):
    return np.dot(gate, state)

# Example: Apply Hadamard to |0⟩
state_zero = np.array([1, 0])
after_hadamard = apply_gate(H, state_zero)
print(f"After Hadamard: {after_hadamard}")
# Output: [0.707, 0.707] - superposition!
```

## Multi-Qubit Systems

```python
import numpy as np
from functools import reduce

# Tensor product for multi-qubit states
def tensor_product(a, b):
    return np.kron(a, b)

# Two-qubit state |00⟩
state_00 = tensor_product(np.array([1, 0]), np.array([1, 0]))
# Result: [1, 0, 0, 0]

# Two-qubit state |01⟩
state_01 = tensor_product(np.array([1, 0]), np.array([0, 1]))
# Result: [0, 1, 0, 0]

# CNOT gate (Controlled-NOT)
CNOT = np.array([
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 1],
    [0, 0, 1, 0]
])

# Create Bell state |Φ+⟩ = (|00⟩ + |11⟩) / √2
def create_bell_state():
    # Start with |00⟩
    state = np.array([1, 0, 0, 0])

    # Apply Hadamard to first qubit
    H_I = tensor_product(H, np.eye(2))  # H ⊗ I
    state = np.dot(H_I, state)

    # Apply CNOT
    state = np.dot(CNOT, state)

    return state

bell_state = create_bell_state()
print(f"Bell state: {bell_state}")
# Output: [0.707, 0, 0, 0.707] representing (|00⟩ + |11⟩)/√2
```

## Quantum Circuit Simulation

Build a simple quantum simulator:

```python
class QuantumSimulator:
    def __init__(self, num_qubits):
        self.num_qubits = num_qubits
        self.state = np.zeros(2**num_qubits, dtype=complex)
        self.state[0] = 1  # Initialize to |0...0⟩

    def apply_single_qubit_gate(self, gate, target_qubit):
        """Apply a single-qubit gate to the specified qubit."""
        n = self.num_qubits

        # Build the full operator using tensor products
        if target_qubit == 0:
            full_gate = gate
        else:
            full_gate = np.eye(2)

        for i in range(1, n):
            if i == target_qubit:
                full_gate = np.kron(full_gate, gate)
            else:
                full_gate = np.kron(full_gate, np.eye(2))

        self.state = np.dot(full_gate, self.state)

    def apply_cnot(self, control, target):
        """Apply CNOT gate."""
        n = self.num_qubits
        dim = 2**n
        cnot_matrix = np.zeros((dim, dim), dtype=complex)

        for i in range(dim):
            bits = [(i >> j) & 1 for j in range(n)]
            if bits[control] == 1:
                bits[target] ^= 1
            j = sum(b << k for k, b in enumerate(bits))
            cnot_matrix[j, i] = 1

        self.state = np.dot(cnot_matrix, self.state)

    def measure(self):
        """Perform measurement, return result and collapse state."""
        probabilities = np.abs(self.state)**2
        result = np.random.choice(len(self.state), p=probabilities)

        # Collapse to measured state
        self.state = np.zeros_like(self.state)
        self.state[result] = 1

        return format(result, f'0{self.num_qubits}b')

    def measure_many(self, shots=1000):
        """Run circuit multiple times and return measurement statistics."""
        original_state = self.state.copy()
        results = {}

        for _ in range(shots):
            self.state = original_state.copy()
            outcome = self.measure()
            results[outcome] = results.get(outcome, 0) + 1

        return results


# Example: Create and measure Bell state
sim = QuantumSimulator(2)
sim.apply_single_qubit_gate(H, 0)  # Hadamard on qubit 0
sim.apply_cnot(0, 1)               # CNOT with control=0, target=1

# Measure multiple times
results = sim.measure_many(1000)
print("Bell state measurements:")
for outcome, count in sorted(results.items()):
    print(f"  |{outcome}⟩: {count/10:.1f}%")
# Expected: ~50% |00⟩, ~50% |11⟩
```

## Bloch Sphere Visualization

Visualize qubit states:

```python
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import numpy as np

def state_to_bloch(state):
    """Convert quantum state to Bloch sphere coordinates."""
    # state = [α, β] where |ψ⟩ = α|0⟩ + β|1⟩
    alpha, beta = state

    # Calculate Bloch sphere angles
    theta = 2 * np.arccos(np.abs(alpha))
    phi = np.angle(beta) - np.angle(alpha)

    # Convert to Cartesian coordinates
    x = np.sin(theta) * np.cos(phi)
    y = np.sin(theta) * np.sin(phi)
    z = np.cos(theta)

    return x, y, z

def plot_bloch_sphere(states, labels=None):
    """Plot states on Bloch sphere."""
    fig = plt.figure(figsize=(10, 10))
    ax = fig.add_subplot(111, projection='3d')

    # Draw sphere
    u = np.linspace(0, 2 * np.pi, 100)
    v = np.linspace(0, np.pi, 50)
    x = np.outer(np.cos(u), np.sin(v))
    y = np.outer(np.sin(u), np.sin(v))
    z = np.outer(np.ones(np.size(u)), np.cos(v))
    ax.plot_surface(x, y, z, alpha=0.1, color='blue')

    # Draw axes
    ax.quiver(0, 0, 0, 1.5, 0, 0, color='r', arrow_length_ratio=0.1)
    ax.quiver(0, 0, 0, 0, 1.5, 0, color='g', arrow_length_ratio=0.1)
    ax.quiver(0, 0, 0, 0, 0, 1.5, color='b', arrow_length_ratio=0.1)

    # Plot states
    colors = plt.cm.rainbow(np.linspace(0, 1, len(states)))
    for i, state in enumerate(states):
        x, y, z = state_to_bloch(state)
        label = labels[i] if labels else f'State {i}'
        ax.scatter([x], [y], [z], color=colors[i], s=100, label=label)
        ax.quiver(0, 0, 0, x, y, z, color=colors[i], arrow_length_ratio=0.1)

    ax.set_xlabel('X')
    ax.set_ylabel('Y')
    ax.set_zlabel('Z')
    ax.legend()
    plt.title('Bloch Sphere Representation')
    plt.show()

# Example states
states = [
    np.array([1, 0]),                      # |0⟩
    np.array([0, 1]),                      # |1⟩
    np.array([1, 1]) / np.sqrt(2),         # |+⟩
    np.array([1, -1]) / np.sqrt(2),        # |-⟩
    np.array([1, 1j]) / np.sqrt(2),        # |i⟩
]
labels = ['|0⟩', '|1⟩', '|+⟩', '|-⟩', '|i⟩']

plot_bloch_sphere(states, labels)
```

## Summary

Quantum computing fundamentals:

- Qubits exist in superposition states
- Quantum gates are unitary matrices
- Multi-qubit systems use tensor products
- Measurement collapses superposition
- Entanglement creates correlated states

These concepts form the foundation for quantum algorithms.
