from pathlib import Path
from _util import load

SRC = (Path(__file__).parent.parent / "examples/sample_app/app.py").read_text()
CFG = {
    "input": "app.py", "preset": "balanced", "seed": "test-seed",
    "protect": [
        {"name": "license_check", "mode": "relocate"},
        {"name": "sealed_score", "mode": "seal"},
        {"name": "feature_gate", "mode": "obfuscate"},
    ],
}


def test_behavior_preserved_end_to_end():
    orig, cli, art = load(SRC, CFG)
    for key in ["REA-0001", "REA-ZZZ", "bad", "REA-abcdef"]:
        assert cli.activate(key) == orig.activate(key), key
    for args in [("pro", 5, 10, 4), ("team", 20, 0, 0), ("free", 1, 2, 3)]:
        assert cli.quote(*args) == orig.quote(*args), args
    for flag in ["export", "api", "sso", "nope"]:
        assert cli.can_use(flag) == orig.can_use(flag), flag
    assert not art.state.refusals, art.state.refusals


def test_secrets_left_the_client():
    _, _, art = load(SRC, CFG)
    assert "RSHLD-PRIVATE-ALGO-7731" not in art.client
    assert "RSHLD-PRIVATE-ALGO-7731" in art.server
    assert "0.6177" not in art.client            # sealed weight gone
    assert art.state.relocated == ["license_check"]
    assert art.state.sealed == ["sealed_score"]


def test_feature_gate_hidden():
    _, _, art = load(SRC, CFG)
    # internal obfuscate-mode fn is either dispatched (computed) or mangled
    assert "feature_gate" in (art.state.dispatched + art.state.mangled)
    assert "def feature_gate(" not in art.client   # the definition was renamed
    assert "def activate(" in art.client           # public API preserved
