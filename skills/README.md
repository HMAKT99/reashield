# REAShield skills

Agent skills (`SKILL.md` workflows) for protecting shipped code against automated
reverse engineering. Process-first; they use the REAShield CLI / MCP server as the
tool.

## [`protect-shipped-code`](./protect-shipped-code/SKILL.md)

The workflow for hardening shipped JS/Electron/Python against REA-type tools:
inventory secrets → move them off-device → harden what ships → **measure what an
attacker can still recover** → gate it in CI. Honest about limits.

## Install it

**Claude Code** — copy the skill into your skills directory:

```bash
# project-scoped
mkdir -p .claude/skills && cp -r skills/protect-shipped-code .claude/skills/
# or user-scoped: ~/.claude/skills/
```

**Any MCP-capable agent (Claude Code / Cursor)** — add the REAShield MCP server so
the agent can actually run the steps (`reashield_doctor` / `reashield_harden` /
`reashield_measure`):

```bash
claude mcp add reashield -- npx -y reashield-mcp
```

The skill tells the agent *what to do*; the MCP server (or the `reashield` CLI)
lets it *do it*.
