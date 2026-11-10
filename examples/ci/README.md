# CI example

`reashield-ci.yml` hardens your build and runs `reashield test --rea` on every push,
PR and weekly. It fails when a protected token is recovered or REA recovers more
than your committed baseline.

1. Create `shield.config.cjs` (`npx reashield init`) and commit it.
2. Copy `reashield-ci.yml` to `.github/workflows/` in your repo.

Limits: this measures *automated static* recovery only. It does not prove a human
analyst can't extract the code. See the main README's "Honest promise & limits".
