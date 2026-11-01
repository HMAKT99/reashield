from reashield import Polymorph


def test_determinism_and_divergence():
    a, b, c = Polymorph("s1"), Polymorph("s1"), Polymorph("s2")
    assert a.op_id("x") == b.op_id("x")
    assert a.op_id("x") != c.op_id("x")
    assert Polymorph("auto").seed != Polymorph("auto").seed
