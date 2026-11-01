from _util import load

SRC = "def f():\n    return 1\n"


def test_decoys_present_and_inert():
    cfg = {"preset": "balanced", "seed": "s",
           "layers": {"string_indirection": False, "name_mangling": False,
                      "decoys_enabled": True, "decoy_count": 6},
           "protect": []}
    _, cli, art = load(SRC, cfg)
    assert len(art.state.decoy_names) >= 6
    assert "__REASHIELD_DECOY_NEVER__" in art.client
    assert cli.f() == 1
    assert cli.__dict__["__REASHIELD_DECOY_TRIPWIRE__"] == 0   # nothing ran
