from _util import load

SRC = '''
__all__ = ["pub"]

def _internal():
    return "INTERNAL-SECRET-STR"

def pub():
    return _internal()
'''


def test_string_indirection_and_name_mangling():
    cfg = {"preset": "balanced", "seed": "s",
           "layers": {"decoys_enabled": False, "dynamic_graph": False},
           "protect": [{"name": "_internal", "mode": "obfuscate"}]}
    orig, cli, art = load(SRC, cfg)
    assert cli.pub() == orig.pub() == "INTERNAL-SECRET-STR"
    assert "INTERNAL-SECRET-STR" not in art.client   # string hidden
    assert "_internal" in art.state.mangled
    assert "pub" in art.client                        # public API kept
