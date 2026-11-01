import types
from reashield_py import harden

src = open("example/app.py").read()
client_src, server_src, opmap = harden(src, {"license_check"})

# Load original (oracle), hardened client, and server as in-process modules.
orig = types.ModuleType("orig"); exec(compile(src, "orig", "exec"), orig.__dict__)
server = types.ModuleType("srv"); exec(compile(server_src, "srv", "exec"), server.__dict__)
client = types.ModuleType("cli"); exec(compile(client_src, "cli", "exec"), client.__dict__)

# Wire the client's relocated calls to the server, in-process.
client.configure_shield(lambda op, args: server.handle(op, args))

# 1) Behavior preserved end to end.
for key in ["REA-0001", "REA-ZZZ", "bad-key", "REA-abcdef"]:
    assert client.activate(key) == orig.activate(key), f"mismatch for {key}"

# 2) The secret left the client entirely and lives only on the server.
assert "RSHLD-PRIVATE-ALGO-7731" not in client_src, "secret leaked into client"
assert "RSHLD-PRIVATE-ALGO-7731" in server_src, "secret missing from server"

# 3) The real algorithm (the loop) is gone from the client; only a stub remains.
assert "_shield_call" in client_src
assert "for ch in str(key)" not in client_src, "real logic leaked into client"
assert "for ch in str(key)" in server_src

print("Python prototype: ALL CHECKS PASS")
print(f"  relocated off-device: {list(opmap.values())}")
print(f"  secret in client: {'RSHLD-PRIVATE-ALGO-7731' in client_src}")
print(f"  secret in server: {'RSHLD-PRIVATE-ALGO-7731' in server_src}")
