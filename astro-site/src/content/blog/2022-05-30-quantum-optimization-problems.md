---
title: "Quantum Optimization: Solving Real-World Problems"
author: Michael John Peña
draft: false
date: 2022-05-30
tags:
  - quantum
  - Optimization
  - Azure
  - algorithms
---

## Optimization Problem Types

Common optimization problems suitable for quantum:
- Traveling Salesman Problem (TSP)
- Vehicle Routing
- Portfolio Optimization
- Job Shop Scheduling
- Max-Cut Problems

## Azure Quantum Optimization

Using the Azure Quantum optimization service:

```python
from azure.quantum import Workspace
from azure.quantum.optimization import Problem, ProblemType, Term

# Connect to workspace
workspace = Workspace(
    subscription_id="...",
    resource_group="quantum-rg",
    name="quantum-workspace"
)

# Define a simple optimization problem
# Minimize: 3x0 + 2x1 - 4x0*x1
problem = Problem(
    name="simple_optimization",
    problem_type=ProblemType.pubo  # Polynomial Unconstrained Binary Optimization
)

# Add terms
problem.add_term(c=3, indices=[0])      # 3x0
problem.add_term(c=2, indices=[1])      # 2x1
problem.add_term(c=-4, indices=[0, 1])  # -4x0*x1

# Solve using different solvers
from azure.quantum.optimization import SimulatedAnnealing, ParallelTempering

# Simulated Annealing
sa_solver = SimulatedAnnealing(workspace, timeout=60)
sa_result = sa_solver.optimize(problem)
print(f"SA Result: {sa_result['configuration']}, Cost: {sa_result['cost']}")

# Parallel Tempering
pt_solver = ParallelTempering(workspace, timeout=60)
pt_result = pt_solver.optimize(problem)
print(f"PT Result: {pt_result['configuration']}, Cost: {pt_result['cost']}")
```

## Portfolio Optimization

Optimize investment portfolio allocation:

```python
import numpy as np
from azure.quantum.optimization import Problem, ProblemType, Term

class PortfolioOptimizer:
    def __init__(self, returns, covariance, risk_factor=0.5):
        """
        Initialize portfolio optimizer.

        Args:
            returns: Expected returns for each asset
            covariance: Covariance matrix of returns
            risk_factor: Trade-off between return and risk
        """
        self.returns = returns
        self.covariance = covariance
        self.risk_factor = risk_factor
        self.n_assets = len(returns)

    def create_problem(self, n_bits_per_asset=4):
        """
        Create QUBO formulation for portfolio optimization.

        Maximize: returns - risk_factor * variance
        Subject to: sum of weights = 1
        """
        n_vars = self.n_assets * n_bits_per_asset
        problem = Problem(name="portfolio", problem_type=ProblemType.pubo)

        # Binary encoding: weight_i = sum_j (2^-j * x_{i,j})
        def get_weight(asset, bit, n_bits):
            return 2 ** (-(bit + 1))

        # Return terms (maximize, so negate)
        for i in range(self.n_assets):
            for j in range(n_bits_per_asset):
                idx = i * n_bits_per_asset + j
                weight = get_weight(i, j, n_bits_per_asset)
                problem.add_term(c=-self.returns[i] * weight, indices=[idx])

        # Risk (variance) terms
        for i in range(self.n_assets):
            for j in range(self.n_assets):
                for bi in range(n_bits_per_asset):
                    for bj in range(n_bits_per_asset):
                        idx_i = i * n_bits_per_asset + bi
                        idx_j = j * n_bits_per_asset + bj
                        weight_i = get_weight(i, bi, n_bits_per_asset)
                        weight_j = get_weight(j, bj, n_bits_per_asset)

                        coef = self.risk_factor * self.covariance[i, j] * weight_i * weight_j

                        if idx_i == idx_j:
                            problem.add_term(c=coef, indices=[idx_i])
                        else:
                            problem.add_term(c=coef, indices=[idx_i, idx_j])

        # Constraint: weights sum to 1 (penalty method)
        penalty = 10.0
        # (sum(weights) - 1)^2 expanded
        for i in range(self.n_assets):
            for bi in range(n_bits_per_asset):
                idx_i = i * n_bits_per_asset + bi
                weight_i = get_weight(i, bi, n_bits_per_asset)

                # Linear terms from expansion
                problem.add_term(c=penalty * weight_i * (weight_i - 2), indices=[idx_i])

                # Quadratic terms
                for j in range(i + 1, self.n_assets):
                    for bj in range(n_bits_per_asset):
                        idx_j = j * n_bits_per_asset + bj
                        weight_j = get_weight(j, bj, n_bits_per_asset)
                        problem.add_term(c=2 * penalty * weight_i * weight_j, indices=[idx_i, idx_j])

        return problem

    def decode_solution(self, config, n_bits_per_asset=4):
        """Convert binary solution to portfolio weights."""
        weights = []
        for i in range(self.n_assets):
            weight = 0
            for j in range(n_bits_per_asset):
                idx = i * n_bits_per_asset + j
                if config.get(idx, 0) == 1:
                    weight += 2 ** (-(j + 1))
            weights.append(weight)

        # Normalize
        total = sum(weights)
        if total > 0:
            weights = [w / total for w in weights]

        return weights


# Example usage
returns = np.array([0.12, 0.10, 0.08, 0.15, 0.09])
covariance = np.array([
    [0.04, 0.01, 0.02, 0.01, 0.01],
    [0.01, 0.03, 0.01, 0.02, 0.01],
    [0.02, 0.01, 0.05, 0.01, 0.02],
    [0.01, 0.02, 0.01, 0.06, 0.01],
    [0.01, 0.01, 0.02, 0.01, 0.04]
])

optimizer = PortfolioOptimizer(returns, covariance, risk_factor=0.5)
problem = optimizer.create_problem()

# Solve
solver = SimulatedAnnealing(workspace, timeout=120)
result = solver.optimize(problem)

weights = optimizer.decode_solution(result['configuration'])
print("Optimal portfolio weights:")
for i, w in enumerate(weights):
    print(f"  Asset {i+1}: {w:.2%}")
```

## Traveling Salesman Problem

```python
from azure.quantum.optimization import Problem, ProblemType, Term
import numpy as np

class TSPSolver:
    def __init__(self, distances):
        """
        Initialize TSP solver.

        Args:
            distances: NxN distance matrix
        """
        self.distances = distances
        self.n_cities = len(distances)

    def create_problem(self, penalty=1000):
        """
        Create QUBO formulation for TSP.

        Variables: x_{i,t} = 1 if city i is visited at time t
        """
        n = self.n_cities
        problem = Problem(name="tsp", problem_type=ProblemType.pubo)

        def var_idx(city, time):
            return city * n + time

        # Distance objective
        for t in range(n):
            next_t = (t + 1) % n
            for i in range(n):
                for j in range(n):
                    if i != j:
                        idx_i = var_idx(i, t)
                        idx_j = var_idx(j, next_t)
                        problem.add_term(
                            c=self.distances[i, j],
                            indices=[idx_i, idx_j]
                        )

        # Constraint: each city visited exactly once
        for i in range(n):
            # Sum over times should be 1
            # (sum_t x_{i,t} - 1)^2
            for t1 in range(n):
                idx = var_idx(i, t1)
                problem.add_term(c=penalty * (1 - 2), indices=[idx])  # -2x + x^2
                for t2 in range(t1 + 1, n):
                    idx2 = var_idx(i, t2)
                    problem.add_term(c=2 * penalty, indices=[idx, idx2])

        # Constraint: each time has exactly one city
        for t in range(n):
            for i1 in range(n):
                idx = var_idx(i1, t)
                problem.add_term(c=penalty * (1 - 2), indices=[idx])
                for i2 in range(i1 + 1, n):
                    idx2 = var_idx(i2, t)
                    problem.add_term(c=2 * penalty, indices=[idx, idx2])

        return problem

    def decode_solution(self, config):
        """Extract tour from binary solution."""
        n = self.n_cities
        tour = []

        for t in range(n):
            for i in range(n):
                idx = i * n + t
                if config.get(idx, 0) == 1:
                    tour.append(i)
                    break

        return tour

    def calculate_tour_distance(self, tour):
        """Calculate total tour distance."""
        total = 0
        for i in range(len(tour)):
            total += self.distances[tour[i], tour[(i + 1) % len(tour)]]
        return total


# Example: 5-city TSP
distances = np.array([
    [0, 10, 15, 20, 25],
    [10, 0, 35, 25, 30],
    [15, 35, 0, 30, 20],
    [20, 25, 30, 0, 15],
    [25, 30, 20, 15, 0]
])

tsp = TSPSolver(distances)
problem = tsp.create_problem()

solver = ParallelTempering(workspace, timeout=300)
result = solver.optimize(problem)

tour = tsp.decode_solution(result['configuration'])
distance = tsp.calculate_tour_distance(tour)

print(f"Optimal tour: {tour}")
print(f"Total distance: {distance}")
```

## QAOA Implementation

Quantum Approximate Optimization Algorithm:

```qsharp
namespace QAOA {
    open Microsoft.Quantum.Canon;
    open Microsoft.Quantum.Intrinsic;
    open Microsoft.Quantum.Math;

    operation ApplyMaxCutCost(qubits : Qubit[], edges : (Int, Int)[], gamma : Double) : Unit {
        // Cost Hamiltonian for Max-Cut
        for (i, j) in edges {
            // e^(-i * gamma * (1 - Z_i * Z_j) / 2)
            CNOT(qubits[i], qubits[j]);
            Rz(gamma, qubits[j]);
            CNOT(qubits[i], qubits[j]);
        }
    }

    operation ApplyMixer(qubits : Qubit[], beta : Double) : Unit {
        // Mixer Hamiltonian: sum of X operators
        for qubit in qubits {
            Rx(2.0 * beta, qubit);
        }
    }

    operation QAOA(
        nQubits : Int,
        edges : (Int, Int)[],
        gammas : Double[],
        betas : Double[]
    ) : Result[] {
        let p = Length(gammas);  // Number of QAOA layers

        use qubits = Qubit[nQubits];

        // Initialize in uniform superposition
        ApplyToEach(H, qubits);

        // Apply p layers
        for layer in 0..p-1 {
            ApplyMaxCutCost(qubits, edges, gammas[layer]);
            ApplyMixer(qubits, betas[layer]);
        }

        // Measure
        let results = ForEach(M, qubits);
        ResetAll(qubits);

        return results;
    }

    @EntryPoint()
    operation RunQAOA() : Unit {
        // Simple graph: 4 nodes, 4 edges
        let edges = [(0, 1), (1, 2), (2, 3), (3, 0)];
        let gammas = [0.5, 0.3];
        let betas = [0.4, 0.2];

        // Run multiple times
        for _ in 1..10 {
            let result = QAOA(4, edges, gammas, betas);
            Message($"Result: {result}");
        }
    }
}
```

## Summary

Quantum optimization enables:

- Portfolio optimization for finance
- Route optimization for logistics
- Scheduling optimization
- Network design problems
- Machine learning applications

Azure Quantum provides accessible tools for these applications.
