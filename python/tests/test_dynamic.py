from _util import load

SRC = '''
__all__ = ["run"]

def _gate(flag):
    table = {"a": 1, "b": 2}
    return table.get(flag, 0)

def run(flag):
    return _gate(flag) + 10
'''


def test_computed_dispatch_preserves_behavior_and_hides_calls():
    cfg = {"preset": "balanced", "seed": "s",
           "layers": {"string_indirection": False, "name_mangling": False, "decoys_enabled": False},
           "protect": [{"name": "_gate", "mode": "obfuscate"}]}
    orig, cli, art = load(SRC, cfg)
    assert "_gate" in art.state.dispatched
    assert "_rk(" in art.client                 # computed key assembler present
    assert "def _gate(" not in art.client        # original name gone
    for flag in ["a", "b", "zzz"]:
        assert cli.run(flag) == orig.run(flag)
