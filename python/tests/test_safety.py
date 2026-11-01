from _util import load

LOW = {"string_indirection": False, "name_mangling": False, "decoys_enabled": False}


def test_refuses_reference_to_unprotected_toplevel_and_preserves_behavior():
    src = "HELPER = 1\ndef helper():\n    return 2\ndef target():\n    return helper() + HELPER\n"
    cfg = {"preset": "low", "seed": "s", "layers": LOW,
           "protect": [{"name": "target", "mode": "relocate"}]}
    orig, cli, art = load(src, cfg)
    assert any(n == "target" for n, _ in art.state.refusals)
    assert "target" not in art.state.relocated
    assert cli.target() == orig.target() == 3        # untouched, still works


def test_refuses_async_relocate():
    src = "async def a():\n    return 1\n"
    cfg = {"preset": "low", "seed": "s", "layers": LOW,
           "protect": [{"name": "a", "mode": "relocate"}]}
    _, _, art = load(src, cfg)
    assert any(n == "a" for n, _ in art.state.refusals)


def test_refuses_generator_relocate():
    src = "def g():\n    yield 1\n"
    cfg = {"preset": "low", "seed": "s", "layers": LOW,
           "protect": [{"name": "g", "mode": "relocate"}]}
    _, _, art = load(src, cfg)
    assert any(n == "g" for n, _ in art.state.refusals)
