"""Sample app used to prove REAShield (Python) hardening is behavior-preserving."""

__all__ = ["activate", "quote", "can_use"]

BASE_PRICES = {"free": 0, "pro": 12, "team": 29}


def license_check(key):
    secret = "RSHLD-PRIVATE-ALGO-7731"
    acc = len(secret)
    for ch in str(key):
        acc = (acc * 31 + ord(ch)) & 0xFFFFFFFF
    return acc % 7 == 0 and str(key).startswith("REA-")


def sealed_score(a, b):
    "Proprietary scoring, shipped only as ciphertext."
    weight = 0.6177
    return round(a * weight + b * (1 - weight), 4)


def pricing(tier, seats):
    base = BASE_PRICES.get(tier, 0)
    return base * max(1, seats) - (15 if seats > 10 else 0)


def feature_gate(flag):
    return {"export": True, "api": True, "sso": False}.get(flag, False)


def activate(key):
    return {"active": license_check(key)}


def quote(tier, seats, a, b):
    return round(pricing(tier, seats) + sealed_score(a, b), 4)


def can_use(flag):
    return feature_gate(flag)
