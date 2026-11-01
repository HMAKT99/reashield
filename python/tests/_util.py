import types
from reashield import harden, in_process
from reashield.config import normalize


def load(source, raw_config):
    """Build + load original, hardened client (server wired in-process)."""
    cfg = normalize(raw_config)
    art = harden(source, cfg)

    orig = types.ModuleType("orig")
    exec(compile(source, "orig", "exec"), orig.__dict__)

    srv = None
    if art.server:
        srv = types.ModuleType("srv")
        exec(compile(art.server, "srv", "exec"), srv.__dict__)

    cli = types.ModuleType("cli")
    exec(compile(art.client, "cli", "exec"), cli.__dict__)

    if srv is not None:
        t, kt = in_process(srv)
        cli.configure_shield(transport=t, key_transport=kt)

    return orig, cli, art
