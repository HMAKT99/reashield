import asyncio
from _util import load

SRC = '''
def score(a, b=2, *, w=0.5):
    marker = "SEAL-SECRET-XYZ"
    return round(a * w + b * (1 - w), 3)

async def ascore(a, b):
    return a * 2 + b
'''


def test_seal_sync_and_async_behavior_and_ciphertext():
    cfg = {"preset": "low", "seed": "s",
           "layers": {"string_indirection": False, "name_mangling": False, "decoys_enabled": False},
           "protect": [{"name": "score", "mode": "seal"}, {"name": "ascore", "mode": "seal"}]}
    orig, cli, art = load(SRC, cfg)
    assert not art.state.refusals, art.state.refusals
    assert cli.score(4, 2) == orig.score(4, 2)
    assert cli.score(4, 2, w=0.9) == orig.score(4, 2, w=0.9)
    assert asyncio.run(cli.ascore(3, 4)) == asyncio.run(orig.ascore(3, 4)) == 10
    # Ciphertext only: plaintext marker must not appear in the shipped client.
    assert "SEAL-SECRET-XYZ" not in art.client
    assert "SEAL-SECRET-XYZ" not in art.server   # server only holds the key
