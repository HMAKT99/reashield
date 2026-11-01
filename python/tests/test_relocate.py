from _util import load

SHAPES = '''
def f_default(a, b=10):
    return a + b
def f_varargs(*args):
    return sum(args)
def f_kwargs(**kw):
    return sum(kw.values())
def f_kwonly(a, *, c, d=3):
    return a + c + d
def f_mixed(a, b=1, *args, c, **kw):
    return a + b + sum(args) + c + len(kw)
'''

LOW = {"string_indirection": False, "name_mangling": False, "decoys_enabled": False}


def test_param_shapes_relocate_faithfully():
    names = ["f_default", "f_varargs", "f_kwargs", "f_kwonly", "f_mixed"]
    cfg = {"preset": "low", "seed": "s", "layers": LOW,
           "protect": [{"name": n, "mode": "relocate"} for n in names]}
    orig, cli, art = load(SHAPES, cfg)
    assert not art.state.refusals, art.state.refusals
    assert cli.f_default(1) == orig.f_default(1) == 11
    assert cli.f_default(1, 2) == orig.f_default(1, 2) == 3
    assert cli.f_varargs(1, 2, 3) == orig.f_varargs(1, 2, 3) == 6
    assert cli.f_kwargs(x=1, y=2) == orig.f_kwargs(x=1, y=2) == 3
    assert cli.f_kwonly(1, c=2) == orig.f_kwonly(1, c=2) == 6
    assert cli.f_kwonly(1, c=2, d=9) == orig.f_kwonly(1, c=2, d=9) == 12
    assert cli.f_mixed(1, 2, 3, 4, c=5, x=6) == orig.f_mixed(1, 2, 3, 4, c=5, x=6)
