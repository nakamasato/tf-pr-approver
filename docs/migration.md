# Migration

Notes for upgrading across changes that affect an existing configuration or
workflow. Nothing here is required for a fresh setup.

## Per-plan rule sets (`tfplan_rule_map`)

### `matched-rules` output removed

The `matched-rules` output has been removed. Use `plan-results`, which is a
superset: it carries the same file → rule mapping plus the plan name and the
rule set that was applied.

Before:

```yaml
- id: approve
  uses: nakamasato/tf-pr-approver@v1
  with:
    plan-files: plans/*.json
- run: echo '${{ steps.approve.outputs.matched-rules }}'
  # {"plans/a.json":"no-changes"}
```

After:

```yaml
- id: approve
  uses: nakamasato/tf-pr-approver@v1
  with:
    plan-files: plans/*.json
- run: echo '${{ steps.approve.outputs.plan-results }}'
  # [{"file":"plans/a.json","name":null,"ruleSet":"rules","rule":"no-changes","matched":true}]
```

To reproduce the old shape from `plan-results`:

```bash
echo "$PLAN_RESULTS" | jq 'map({(.file): .rule}) | add'
```

### Flat `rules` still works

The top-level `rules` list is unchanged and remains the simplest form for a
single stack — you do **not** need to move to `tfplan_rule_map`:

```yaml
# still valid, still recommended for a single rule set
rules:
  - name: no-changes
    when:
      no_changes: true
```

Adopt `tfplan_rule_map` only when a monorepo needs a different rule set per
stack. When you do, either keep `rules` as the fallback bucket **or** move it
under `tfplan_rule_map.default` — not both (the config is rejected if both
define the default). See
[monorepo.md](monorepo.md#different-rules-per-stack) and
[configuration.md](configuration.md#tfplan_rule_map-per-plan-rules).
