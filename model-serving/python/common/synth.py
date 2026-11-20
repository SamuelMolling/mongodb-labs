"""
Synthetic churn data -- the same generator feeds training and the load
generator, so "drift" is a parameter you turn, not an accident.

drift = 0.0  traffic looks like the training data
drift = 1.0  a new cohort: much younger accounts, more support tickets,
             fewer logins. Same label function (covariate shift), so the
             models are not wrong about the world -- they are being asked
             about a part of it they barely saw.
"""
import numpy as np

FEATURES = ["tenure_days", "seats", "tickets_30d", "logins_7d", "plan_tier", "mrr"]
INPUT_SCHEMA = [
    {"name": "tenure_days", "type": "double"},
    {"name": "seats", "type": "int"},
    {"name": "tickets_30d", "type": "int"},
    {"name": "logins_7d", "type": "int"},
    {"name": "plan_tier", "type": "int"},
    {"name": "mrr", "type": "double"},
]

_PRICE = np.array([0.0, 20.0, 60.0])


def sample(n: int, rng: np.random.Generator, drift: float = 0.0):
    """Returns (X float64 [n, 6], y int [n]) in FEATURES order."""
    d = float(np.clip(drift, 0.0, 1.0))

    tenure = np.clip(rng.lognormal(mean=np.log(300) - d * np.log(5), sigma=0.9, size=n), 1, 3000)
    seats = 1 + rng.poisson(7, size=n)
    tickets = rng.poisson(1.5 + 2.5 * d, size=n)
    logins = rng.poisson(12 - 7 * d, size=n)
    tier = rng.choice(3, size=n, p=[0.5, 0.35, 0.15])
    mrr = np.round(seats * _PRICE[tier] * rng.uniform(0.8, 1.2, size=n), 2)

    # Label function: fixed across drift. Includes an interaction (tickets
    # hurt young accounts much more) so a tree model has something to find
    # that a linear one cannot.
    young = (tenure < 90).astype(float)
    z = (
        0.6
        - 0.003 * np.minimum(tenure, 1200)
        + 0.15 * tickets
        + 1.1 * tickets * young
        - 0.16 * logins
        - 0.45 * tier
        - 0.02 * seats
        + rng.normal(0, 0.3, size=n)
    )
    y = (rng.uniform(size=n) < 1 / (1 + np.exp(-z))).astype(int)

    X = np.column_stack([tenure, seats, tickets, logins, tier, mrr]).astype(np.float64)
    return X, y


def to_features(row) -> dict:
    """One row -> the JSON body a client sends. Ints stay ints."""
    out = {}
    for name, value in zip(FEATURES, row):
        spec = next(s for s in INPUT_SCHEMA if s["name"] == name)
        out[name] = int(value) if spec["type"] == "int" else round(float(value), 3)
    return out
