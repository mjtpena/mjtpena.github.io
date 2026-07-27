---
title: "Synthetic Data Generation: When Real Data Isn't Available"
author: Michael John Pena
draft: false
date: 2021-12-24
tags:
  - Synthetic Data
  - Machine Learning
  - Data Privacy
  - Data Generation
  - Testing

---

I wrote "Synthetic Data Generation: When Real Data Isn't Available" to share practical, production-minded guidance on this topic.

## Why Synthetic Data?

- **Privacy**: No real personal information
- **Testing**: Generate edge cases and scenarios
- **Data Augmentation**: Expand limited datasets
- **Cost**: Cheaper than collecting real data
- **Compliance**: Avoid regulatory concerns

## Statistical Synthetic Data Generation

```python
import numpy as np
import pandas as pd
from scipy import stats
from typing import Dict, List, Optional
from dataclasses import dataclass

@dataclass
class ColumnProfile:
    name: str
    dtype: str
    distribution: str
    parameters: dict
    null_rate: float = 0.0
    constraints: Optional[dict] = None

class StatisticalSynthesizer:
    """Generate synthetic data based on statistical properties"""

    def __init__(self):
        self.profiles: Dict[str, ColumnProfile] = {}
        self.correlations: Optional[np.ndarray] = None
        self.column_order: List[str] = []

    def fit(self, df: pd.DataFrame):
        """Learn statistical properties from real data"""
        self.column_order = list(df.columns)

        # Profile each column
        for col in df.columns:
            self.profiles[col] = self._profile_column(df[col])

        # Learn correlations for numeric columns
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        if len(numeric_cols) > 1:
            self.correlations = df[numeric_cols].corr().values

        return self

    def _profile_column(self, series: pd.Series) -> ColumnProfile:
        """Profile a single column"""
        null_rate = series.isnull().mean()
        series_clean = series.dropna()

        if series.dtype in ['int64', 'float64']:
            # Fit best distribution
            distribution, params = self._fit_numeric_distribution(series_clean)
            return ColumnProfile(
                name=series.name,
                dtype=str(series.dtype),
                distribution=distribution,
                parameters=params,
                null_rate=null_rate,
                constraints={
                    'min': series_clean.min(),
                    'max': series_clean.max()
                }
            )
        elif series.dtype == 'object' or series.dtype.name == 'category':
            # Categorical: use value frequencies
            value_counts = series_clean.value_counts(normalize=True)
            return ColumnProfile(
                name=series.name,
                dtype='category',
                distribution='categorical',
                parameters={
                    'categories': value_counts.index.tolist(),
                    'probabilities': value_counts.values.tolist()
                },
                null_rate=null_rate
            )
        elif np.issubdtype(series.dtype, np.datetime64):
            return ColumnProfile(
                name=series.name,
                dtype='datetime',
                distribution='uniform',
                parameters={
                    'start': series_clean.min(),
                    'end': series_clean.max()
                },
                null_rate=null_rate
            )
        else:
            raise ValueError(f"Unsupported dtype: {series.dtype}")

    def _fit_numeric_distribution(self, series: pd.Series) -> tuple:
        """Fit the best distribution for numeric data"""
        distributions = ['norm', 'lognorm', 'expon', 'uniform']
        best_dist = None
        best_sse = np.inf

        for dist_name in distributions:
            try:
                dist = getattr(stats, dist_name)
                params = dist.fit(series)

                # Calculate goodness of fit
                ks_stat, p_value = stats.kstest(series, dist_name, params)
                if ks_stat < best_sse:
                    best_sse = ks_stat
                    best_dist = (dist_name, params)
            except Exception:
                continue

        return best_dist or ('norm', (series.mean(), series.std()))

    def generate(self, n_rows: int) -> pd.DataFrame:
        """Generate synthetic data"""
        data = {}

        for col_name in self.column_order:
            profile = self.profiles[col_name]
            values = self._generate_column(profile, n_rows)
            data[col_name] = values

        return pd.DataFrame(data)

    def _generate_column(self, profile: ColumnProfile, n_rows: int) -> np.ndarray:
        """Generate values for a single column"""
        if profile.distribution == 'categorical':
            values = np.random.choice(
                profile.parameters['categories'],
                size=n_rows,
                p=profile.parameters['probabilities']
            )
        elif profile.distribution == 'norm':
            loc, scale = profile.parameters
            values = np.random.normal(loc, scale, n_rows)
        elif profile.distribution == 'lognorm':
            s, loc, scale = profile.parameters
            values = stats.lognorm.rvs(s, loc, scale, size=n_rows)
        elif profile.distribution == 'uniform':
            if profile.dtype == 'datetime':
                start = profile.parameters['start'].value
                end = profile.parameters['end'].value
                values = pd.to_datetime(np.random.randint(start, end, n_rows))
            else:
                low, high = profile.parameters
                values = np.random.uniform(low, high, n_rows)
        else:
            raise ValueError(f"Unknown distribution: {profile.distribution}")

        # Apply constraints
        if profile.constraints and profile.dtype in ['int64', 'float64']:
            values = np.clip(values, profile.constraints['min'], profile.constraints['max'])
            if 'int' in profile.dtype:
                values = values.astype(int)

        # Add nulls
        if profile.null_rate > 0:
            null_mask = np.random.random(n_rows) < profile.null_rate
            values = np.where(null_mask, None, values)

        return values


# Usage
real_data = pd.read_csv('customers.csv')
synthesizer = StatisticalSynthesizer()
synthesizer.fit(real_data)
synthetic_data = synthesizer.generate(10000)
```

## GAN-Based Synthetic Data

```python
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

class TabularGAN:
    """GAN for generating tabular synthetic data"""

    def __init__(self, input_dim: int, latent_dim: int = 128):
        self.input_dim = input_dim
        self.latent_dim = latent_dim

        self.generator = self._build_generator()
        self.discriminator = self._build_discriminator()

    def _build_generator(self) -> nn.Module:
        return nn.Sequential(
            nn.Linear(self.latent_dim, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(),
            nn.Linear(256, 512),
            nn.BatchNorm1d(512),
            nn.ReLU(),
            nn.Linear(512, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(),
            nn.Linear(256, self.input_dim),
            nn.Tanh()
        )

    def _build_discriminator(self) -> nn.Module:
        return nn.Sequential(
            nn.Linear(self.input_dim, 256),
            nn.LeakyReLU(0.2),
            nn.Dropout(0.3),
            nn.Linear(256, 512),
            nn.LeakyReLU(0.2),
            nn.Dropout(0.3),
            nn.Linear(512, 256),
            nn.LeakyReLU(0.2),
            nn.Dropout(0.3),
            nn.Linear(256, 1),
            nn.Sigmoid()
        )

    def train(
        self,
        real_data: np.ndarray,
        epochs: int = 1000,
        batch_size: int = 64,
        lr: float = 0.0002
    ):
        """Train the GAN"""
        dataset = TensorDataset(torch.FloatTensor(real_data))
        dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

        criterion = nn.BCELoss()
        g_optimizer = torch.optim.Adam(self.generator.parameters(), lr=lr, betas=(0.5, 0.999))
        d_optimizer = torch.optim.Adam(self.discriminator.parameters(), lr=lr, betas=(0.5, 0.999))

        for epoch in range(epochs):
            for real_batch, in dataloader:
                batch_size = real_batch.size(0)

                # Train discriminator
                d_optimizer.zero_grad()

                real_labels = torch.ones(batch_size, 1)
                fake_labels = torch.zeros(batch_size, 1)

                # Real data
                d_real = self.discriminator(real_batch)
                d_loss_real = criterion(d_real, real_labels)

                # Fake data
                noise = torch.randn(batch_size, self.latent_dim)
                fake_data = self.generator(noise)
                d_fake = self.discriminator(fake_data.detach())
                d_loss_fake = criterion(d_fake, fake_labels)

                d_loss = d_loss_real + d_loss_fake
                d_loss.backward()
                d_optimizer.step()

                # Train generator
                g_optimizer.zero_grad()
                d_fake = self.discriminator(fake_data)
                g_loss = criterion(d_fake, real_labels)
                g_loss.backward()
                g_optimizer.step()

            if epoch % 100 == 0:
                print(f"Epoch {epoch}: D_loss={d_loss.item():.4f}, G_loss={g_loss.item():.4f}")

    def generate(self, n_samples: int) -> np.ndarray:
        """Generate synthetic samples"""
        self.generator.eval()
        with torch.no_grad():
            noise = torch.randn(n_samples, self.latent_dim)
            synthetic = self.generator(noise)
        return synthetic.numpy()
```

## Synthetic Data with SDV

```python
from sdv.tabular import GaussianCopula, CTGAN
from sdv.evaluation import evaluate

class SDVSynthesizer:
    """Synthetic Data Vault wrapper for high-quality synthetic data"""

    def __init__(self, method: str = "gaussian_copula"):
        if method == "gaussian_copula":
            self.model = GaussianCopula()
        elif method == "ctgan":
            self.model = CTGAN()
        else:
            raise ValueError(f"Unknown method: {method}")

    def fit(self, df: pd.DataFrame, metadata: dict = None):
        """Fit the model to real data"""
        self.model.fit(df)
        return self

    def generate(self, n_rows: int) -> pd.DataFrame:
        """Generate synthetic data"""
        return self.model.sample(n_rows)

    def evaluate_quality(self, real_df: pd.DataFrame, synthetic_df: pd.DataFrame) -> dict:
        """Evaluate synthetic data quality"""
        scores = evaluate(synthetic_df, real_df)
        return {
            'overall_score': scores.get('Overall Score', 0),
            'column_shapes': scores.get('Column Shapes', 0),
            'column_pair_trends': scores.get('Column Pair Trends', 0)
        }


# Relational synthetic data
from sdv.relational import HMA1

class RelationalSynthesizer:
    """Generate synthetic data for relational databases"""

    def __init__(self):
        self.model = HMA1()

    def fit(self, tables: Dict[str, pd.DataFrame], metadata: dict):
        """Fit to relational schema"""
        self.model.fit(tables, metadata)
        return self

    def generate(self, scale: float = 1.0) -> Dict[str, pd.DataFrame]:
        """Generate synthetic tables maintaining relationships"""
        return self.model.sample(scale=scale)


# Example metadata for relational data
relational_metadata = {
    "tables": {
        "customers": {
            "primary_key": "customer_id",
            "fields": {
                "customer_id": {"type": "id"},
                "name": {"type": "categorical"},
                "email": {"type": "email"},
                "signup_date": {"type": "datetime"}
            }
        },
        "orders": {
            "primary_key": "order_id",
            "fields": {
                "order_id": {"type": "id"},
                "customer_id": {"type": "id"},
                "order_date": {"type": "datetime"},
                "total": {"type": "numerical", "subtype": "float"}
            }
        }
    },
    "relationships": [
        {
            "parent": "customers",
            "child": "orders",
            "foreign_key": "customer_id"
        }
    ]
}
```

## Synthetic Data Quality Assessment

```python
from scipy.stats import ks_2samp
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score

class SyntheticDataEvaluator:
    """Evaluate quality of synthetic data"""

    def statistical_similarity(
        self,
        real_df: pd.DataFrame,
        synthetic_df: pd.DataFrame
    ) -> dict:
        """Compare statistical properties"""
        results = {}

        for col in real_df.columns:
            if real_df[col].dtype in ['int64', 'float64']:
                # KS test for numeric columns
                stat, p_value = ks_2samp(
                    real_df[col].dropna(),
                    synthetic_df[col].dropna()
                )
                results[col] = {
                    'ks_statistic': stat,
                    'p_value': p_value,
                    'similar': p_value > 0.05
                }
            else:
                # Chi-square for categorical
                real_dist = real_df[col].value_counts(normalize=True)
                synth_dist = synthetic_df[col].value_counts(normalize=True)

                # Jensen-Shannon divergence
                all_categories = set(real_dist.index) | set(synth_dist.index)
                real_probs = [real_dist.get(c, 0) for c in all_categories]
                synth_probs = [synth_dist.get(c, 0) for c in all_categories]

                from scipy.spatial.distance import jensenshannon
                js_div = jensenshannon(real_probs, synth_probs)

                results[col] = {
                    'js_divergence': js_div,
                    'similar': js_div < 0.1
                }

        return results

    def discriminator_test(
        self,
        real_df: pd.DataFrame,
        synthetic_df: pd.DataFrame
    ) -> float:
        """Test if a classifier can distinguish real from synthetic"""
        # Prepare data
        real_df = real_df.copy()
        synthetic_df = synthetic_df.copy()

        real_df['is_real'] = 1
        synthetic_df['is_real'] = 0

        combined = pd.concat([real_df, synthetic_df])

        # Encode categorical columns
        for col in combined.select_dtypes(include=['object', 'category']).columns:
            combined[col] = combined[col].astype('category').cat.codes

        combined = combined.fillna(-999)

        X = combined.drop('is_real', axis=1)
        y = combined['is_real']

        # Train classifier
        clf = RandomForestClassifier(n_estimators=100, random_state=42)
        scores = cross_val_score(clf, X, y, cv=5, scoring='roc_auc')

        # Score close to 0.5 means synthetic is indistinguishable
        return scores.mean()

    def privacy_check(
        self,
        real_df: pd.DataFrame,
        synthetic_df: pd.DataFrame,
        key_columns: List[str]
    ) -> dict:
        """Check for privacy leakage"""
        # Check for exact matches
        merged = pd.merge(
            synthetic_df,
            real_df,
            on=key_columns,
            how='inner'
        )

        exact_matches = len(merged)
        match_rate = exact_matches / len(synthetic_df)

        return {
            'exact_matches': exact_matches,
            'match_rate': match_rate,
            'privacy_safe': match_rate < 0.01
        }
```

## Synthetic Data Use Cases

1. **ML Training**: Augment limited datasets
2. **Testing**: Generate test data for applications
3. **Privacy**: Share data without exposing PII
4. **Demo**: Create realistic demo environments
5. **Research**: Enable research on sensitive data

Synthetic data in 2021 became practical for production use. The key is validating that synthetic data maintains the statistical properties needed for your use case.

## Resources

- [Synthetic Data Vault](https://sdv.dev/)
- [Gretel.ai](https://gretel.ai/)
- [Mostly AI](https://mostly.ai/)
- [CTGAN Paper](https://arxiv.org/abs/1907.00503)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
