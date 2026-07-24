# Per-plan rule sets (`tfplan_rule_map`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workflow bind a name to each plan JSON via `plan-files: name=glob`, and let the config apply a different rule set per name via a `tfplan_rule_map` keyed by name or glob.

**Architecture:** Two new pure modules — `src/plan-files.ts` (parse the input into `{name, pattern}` entries) and `src/rule-map.ts` (resolve a name to a rule set) — plus schema changes in `config.ts` and wiring in `main.ts`. `evaluate.ts` is untouched: it already takes `(plan, rules)`, so per-plan rule sets only change which array is handed to it.

**Tech Stack:** TypeScript, Node 24, vitest, zod, minimatch, `@actions/core` / `@actions/glob`, esbuild.

Spec: [`docs/superpowers/specs/2026-07-23-per-plan-rule-map-design.md`](../specs/2026-07-23-per-plan-rule-map-design.md)

## Global Constraints

- **Write everything in English**: code comments, doc comments, documentation, commit messages, PR titles and bodies.
- **`dist/` is committed.** Any change under `src/` requires `npm run package` and a `dist/` commit, or the `check-dist` workflow fails. This is handled once in Task 6 — do not run it per task.
- **Run `npm run format` before committing** (CI runs `format:check`).
- Commit messages follow Conventional Commits (`feat:` / `fix:` / `docs:` / `test:` / `refactor:`).
- Keep `evaluate.ts` and `paths.ts` free of I/O and side effects. The two new modules must be pure too.
- Fail-closed is deliberate everywhere. Config/input problems are `core.setFailed` failures; "no rule matched" stays a normal skip.
- Existing behavior must not regress: a config with only `rules` and a `plan-files` input with only bare globs must behave exactly as today.

---

### Task 1: `plan-files.ts` — parse the `plan-files` input

**Files:**
- Create: `src/plan-files.ts`
- Test: `__tests__/plan-files.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PlanFileEntry { name: string | null; pattern: string }`
  - `function parsePlanFilesInput(input: string): PlanFileEntry[]`

- [ ] **Step 1: Write the failing test**

Create `__tests__/plan-files.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsePlanFilesInput } from '../src/plan-files'

describe('parsePlanFilesInput', () => {
  it('treats a plain line as an unnamed glob', () => {
    expect(parsePlanFilesInput('plans/*.json')).toEqual([{ name: null, pattern: 'plans/*.json' }])
  })

  it('parses newline-separated entries and ignores blank lines', () => {
    expect(parsePlanFilesInput('\n  plans/a.json  \n\nplans/b.json\n')).toEqual([
      { name: null, pattern: 'plans/a.json' },
      { name: null, pattern: 'plans/b.json' },
    ])
  })

  it('binds a name with "name=glob"', () => {
    expect(parsePlanFilesInput('sandbox = tfplans/tfplan-sandbox/tfplan.json')).toEqual([
      { name: 'sandbox', pattern: 'tfplans/tfplan-sandbox/tfplan.json' },
    ])
  })

  it('splits on the first "=" only, so a "=" in the path is harmless', () => {
    expect(parsePlanFilesInput('a=plans/x=y/tfplan.json')).toEqual([
      { name: 'a', pattern: 'plans/x=y/tfplan.json' },
    ])
  })

  it('keeps a bare glob containing "=" unnamed', () => {
    // The text before the first "=" contains "/", which a name never can, so
    // this is a path rather than a binding. Regression guard for configs that
    // predate the `name=glob` form.
    expect(parsePlanFilesInput('plans/x=y/tfplan.json')).toEqual([
      { name: null, pattern: 'plans/x=y/tfplan.json' },
    ])
  })

  it('rejects a name containing glob metacharacters', () => {
    expect(() => parsePlanFilesInput('pro*d=plans/a.json')).toThrow(/invalid plan name/)
  })

  it('rejects an empty name', () => {
    expect(() => parsePlanFilesInput('=plans/a.json')).toThrow(/invalid plan name/)
  })

  it('rejects a name with no pattern after "="', () => {
    expect(() => parsePlanFilesInput('sandbox=')).toThrow(/no glob pattern/)
  })

  it('rejects a duplicate name', () => {
    expect(() => parsePlanFilesInput('a=x.json\na=y.json')).toThrow(/duplicate plan name "a"/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/plan-files.test.ts`

Expected: FAIL — `Failed to resolve import "../src/plan-files"`.

- [ ] **Step 3: Write the implementation**

Create `src/plan-files.ts`:

```ts
/**
 * Parses the `plan-files` action input into entries.
 *
 * Each newline-separated line is either a bare glob (the original form) or
 * `name=glob`, which binds a name to the plan that glob produces so
 * `tfplan_rule_map` can select a rule set per plan.
 *
 * Pure: no globbing and no filesystem access, so it can be unit-tested
 * exhaustively.
 */

export interface PlanFileEntry {
  /** null for a bare glob line: those plans fall into the default rule set. */
  name: string | null
  pattern: string
}

/**
 * Names are looked up as `tfplan_rule_map` keys and matched against the glob
 * keys there. Allowing glob metacharacters in a name would make that matching
 * ambiguous in both directions at once, so keep names literal.
 */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/

export function parsePlanFilesInput(input: string): PlanFileEntry[] {
  const entries: PlanFileEntry[] = []
  const seen = new Set<string>()

  for (const raw of input.split('\n')) {
    const line = raw.trim()
    if (line === '') continue

    const eq = line.indexOf('=')
    // A name can never contain "/", so a "=" appearing after one belongs to the
    // path, not to a `name=glob` binding. That keeps a pre-existing bare glob
    // such as `plans/a=b/tfplan.json` working unchanged.
    if (eq === -1 || line.slice(0, eq).includes('/')) {
      entries.push({ name: null, pattern: line })
      continue
    }

    const name = line.slice(0, eq).trim()
    const pattern = line.slice(eq + 1).trim()
    if (!NAME_PATTERN.test(name)) {
      throw new Error(
        `invalid plan name "${name}" in "plan-files": a name may contain only letters, digits, ` +
          '".", "_" and "-"'
      )
    }
    if (pattern === '') {
      throw new Error(`plan name "${name}" in "plan-files" has no glob pattern after "="`)
    }
    if (seen.has(name)) {
      throw new Error(`duplicate plan name "${name}" in "plan-files"`)
    }
    seen.add(name)
    entries.push({ name, pattern })
  }

  return entries
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/plan-files.test.ts`

Expected: PASS, 9 tests.

- [ ] **Step 5: Lint, format and commit**

```bash
npm run format
npm run lint
git add src/plan-files.ts __tests__/plan-files.test.ts
git commit -m "feat: parse \"name=glob\" entries in the plan-files input"
```

---

### Task 2: `rule-map.ts` — resolve a plan name to a rule set

**Files:**
- Create: `src/rule-map.ts`
- Test: `__tests__/rule-map.test.ts`

**Interfaces:**
- Consumes: `Rule` from `src/config.ts` (already exists: `{ name: string; when: Conditions }`).
- Produces:
  - `const DEFAULT_KEY = 'default'`
  - `const BUILT_IN_LABEL = 'built-in default'` (also consumed by Task 5)
  - `const BUILT_IN_DEFAULT_RULES: Rule[]`
  - `type RuleMap = Record<string, Rule[]>`
  - `interface RuleSetResolution { ruleSet: string; rules: Rule[] }`
  - `interface RuleSources { ruleMap?: RuleMap; rules?: Rule[] }`
  - `function resolveRuleSet(name: string | null, sources: RuleSources): RuleSetResolution`
  - `function unusedRuleMapKeys(ruleMap: RuleMap | undefined, usedRuleSets: string[]): string[]`

This module takes plain rule arrays rather than a `Config`, so it does not depend on Task 3.

- [ ] **Step 1: Write the failing test**

Create `__tests__/rule-map.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Rule } from '../src/config'
import { BUILT_IN_DEFAULT_RULES, resolveRuleSet, unusedRuleMapKeys } from '../src/rule-map'

/** Rule sets are told apart by the rule name; the conditions are irrelevant here. */
const rules = (label: string): Rule[] => [{ name: label, when: { no_changes: true } }]

describe('resolveRuleSet', () => {
  it('prefers a key that matches the name exactly', () => {
    const r = resolveRuleSet('sandbox', { ruleMap: { sandbox: rules('exact') } })
    expect(r).toEqual({ ruleSet: 'sandbox', rules: rules('exact') })
  })

  it('falls back to a glob key', () => {
    const r = resolveRuleSet('api-prod', { ruleMap: { '*-prod': rules('glob') } })
    expect(r).toEqual({ ruleSet: '*-prod', rules: rules('glob') })
  })

  it('lets an exact key beat a glob key that also matches', () => {
    const r = resolveRuleSet('api-prod', {
      ruleMap: { 'api-prod': rules('exact'), '*-prod': rules('glob') },
    })
    expect(r.ruleSet).toBe('api-prod')
  })

  it('throws when two glob keys match and no exact key does', () => {
    // Deliberately not resolved by specificity: an implicit winner here would
    // decide which plans get the permissive rules.
    expect(() =>
      resolveRuleSet('api-prod', { ruleMap: { '*-prod': rules('a'), 'api-*': rules('b') } })
    ).toThrow(/more than one "tfplan_rule_map" pattern/)
  })

  it('uses the explicit default for an unlisted name', () => {
    const r = resolveRuleSet('other', {
      ruleMap: { sandbox: rules('sandbox'), default: rules('default') },
    })
    expect(r).toEqual({ ruleSet: 'default', rules: rules('default') })
  })

  it('uses the explicit default for an unnamed plan', () => {
    const r = resolveRuleSet(null, { ruleMap: { sandbox: rules('sandbox'), default: rules('d') } })
    expect(r.ruleSet).toBe('default')
  })

  it('never selects the reserved "default" key as an exact or glob match', () => {
    // A plan literally named "default" still lands in the default bucket, which
    // is the same rules — but the bucket label must stay honest.
    const r = resolveRuleSet('default', { ruleMap: { default: rules('d') } })
    expect(r.ruleSet).toBe('default')
  })

  it('uses top-level rules as the default bucket', () => {
    const r = resolveRuleSet('other', { ruleMap: { sandbox: rules('sandbox') }, rules: rules('top') })
    expect(r).toEqual({ ruleSet: 'rules', rules: rules('top') })
  })

  it('prefers tfplan_rule_map.default over top-level rules', () => {
    // config.ts rejects this combination; the pure function stays deterministic.
    const r = resolveRuleSet('other', { ruleMap: { default: rules('map') }, rules: rules('top') })
    expect(r.ruleSet).toBe('default')
  })

  it('falls back to the built-in default when nothing is configured', () => {
    expect(resolveRuleSet('other', {})).toEqual({
      ruleSet: 'built-in default',
      rules: BUILT_IN_DEFAULT_RULES,
    })
    expect(BUILT_IN_DEFAULT_RULES).toEqual([{ name: 'no-changes', when: { no_changes: true } }])
  })

  it('does not treat inherited Object properties as rule map keys', () => {
    // `ruleMap["constructor"]` would otherwise return a function and be truthy.
    expect(resolveRuleSet('constructor', { ruleMap: {} }).ruleSet).toBe('built-in default')
    expect(resolveRuleSet('toString', { ruleMap: {} }).ruleSet).toBe('built-in default')
  })
})

describe('unusedRuleMapKeys', () => {
  it('reports keys that selected no plan', () => {
    expect(unusedRuleMapKeys({ sandbox: rules('a'), prod: rules('b') }, ['sandbox'])).toEqual([
      'prod',
    ])
  })

  it('never reports the reserved default key', () => {
    expect(unusedRuleMapKeys({ default: rules('a') }, [])).toEqual([])
  })

  it('returns nothing when there is no rule map', () => {
    expect(unusedRuleMapKeys(undefined, [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/rule-map.test.ts`

Expected: FAIL — `Failed to resolve import "../src/rule-map"`.

- [ ] **Step 3: Write the implementation**

Create `src/rule-map.ts`:

```ts
/**
 * Selects which rule set applies to a plan, from the plan's name and the
 * config's `tfplan_rule_map`.
 *
 * Resolution order, per plan:
 *   1. a key matching the name exactly
 *   2. a glob key — exactly one, or it is an error
 *   3. the default bucket (`tfplan_rule_map.default`, else top-level `rules`)
 *   4. the built-in default
 *
 * Step 4 is what makes an incomplete configuration fail closed: an unlisted
 * name lands on the most conservative useful rule instead of on a hole.
 *
 * Pure logic, no I/O, so it can be unit-tested exhaustively.
 */
import { minimatch } from 'minimatch'
import { Rule } from './config'

/** Reserved key naming the fallback bucket; never matched as a name or a glob. */
export const DEFAULT_KEY = 'default'

/** Bucket label reported when the top-level `rules` list is used. */
const TOP_LEVEL_RULES_LABEL = 'rules'

/** Bucket label reported when nothing at all is configured. Also used by `summary.ts`. */
export const BUILT_IN_LABEL = 'built-in default'

/**
 * Applied when neither `tfplan_rule_map.default` nor `rules` is configured.
 * `no_changes` is the most conservative rule that still approves anything.
 */
export const BUILT_IN_DEFAULT_RULES: Rule[] = [{ name: 'no-changes', when: { no_changes: true } }]

export type RuleMap = Record<string, Rule[]>

export interface RuleSetResolution {
  /** The selected bucket: a map key, "default", "rules", or "built-in default". */
  ruleSet: string
  rules: Rule[]
}

export interface RuleSources {
  ruleMap?: RuleMap
  /** Top-level `rules`: the same bucket as `tfplan_rule_map.default`. */
  rules?: Rule[]
}

/** Characters that make a key a glob rather than a literal name. */
const GLOB_MAGIC = /[*?[\]{}!()]/

/**
 * Same `nonegate` reasoning as `paths.ts`: a leading "!" must not turn a narrow
 * key into one that matches almost every name. `config.ts` rejects such keys;
 * this keeps the pure function safe on its own too.
 */
const MINIMATCH_OPTIONS = { nonegate: true } as const

export function resolveRuleSet(name: string | null, sources: RuleSources): RuleSetResolution {
  const ruleMap = sources.ruleMap ?? {}

  // `Object.hasOwn` rather than a truthiness check: a plan named "constructor"
  // or "toString" would otherwise pick up an inherited Object property.
  if (name !== null && name !== DEFAULT_KEY) {
    if (Object.hasOwn(ruleMap, name)) {
      return { ruleSet: name, rules: ruleMap[name] }
    }
    const globKeys = Object.keys(ruleMap).filter(
      (key) => key !== DEFAULT_KEY && GLOB_MAGIC.test(key) && minimatch(name, key, MINIMATCH_OPTIONS)
    )
    if (globKeys.length > 1) {
      throw new Error(
        `plan "${name}" is matched by more than one "tfplan_rule_map" pattern ` +
          `(${globKeys.map((k) => `"${k}"`).join(', ')}); make the patterns disjoint, or add a ` +
          'key matching the name exactly'
      )
    }
    if (globKeys.length === 1) {
      return { ruleSet: globKeys[0], rules: ruleMap[globKeys[0]] }
    }
  }

  if (Object.hasOwn(ruleMap, DEFAULT_KEY)) {
    return { ruleSet: DEFAULT_KEY, rules: ruleMap[DEFAULT_KEY] }
  }
  if (sources.rules) {
    return { ruleSet: TOP_LEVEL_RULES_LABEL, rules: sources.rules }
  }
  return { ruleSet: BUILT_IN_LABEL, rules: BUILT_IN_DEFAULT_RULES }
}

/**
 * Keys that selected no plan in this run. Usually a typo in a `plan-files`
 * name, but indistinguishable from a stack that was simply not planned in this
 * PR — so the caller warns rather than fails. It fails in the safe direction
 * anyway: the intended rules go unused and the plan falls through to a
 * stricter bucket.
 */
export function unusedRuleMapKeys(ruleMap: RuleMap | undefined, usedRuleSets: string[]): string[] {
  if (!ruleMap) return []
  const used = new Set(usedRuleSets)
  return Object.keys(ruleMap).filter((key) => key !== DEFAULT_KEY && !used.has(key))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/rule-map.test.ts`

Expected: PASS, 14 tests.

- [ ] **Step 5: Lint, format and commit**

```bash
npm run format
npm run lint
git add src/rule-map.ts __tests__/rule-map.test.ts
git commit -m "feat: resolve a plan name to a rule set with exact-then-glob precedence"
```

---

### Task 3: `config.ts` — the `tfplan_rule_map` schema

**Files:**
- Modify: `src/config.ts:63-79` (the `ConfigSchema` block and the type exports)
- Test: `__tests__/config.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `RuleSchema` (already in `config.ts`).
- Produces: `Config` gains `tfplan_rule_map?: Record<string, Rule[]>`, and `rules` becomes `Rule[] | undefined`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/config.test.ts`:

```ts
describe('parseConfig: tfplan_rule_map', () => {
  const ruleList = [{ name: 'no-changes', when: { no_changes: true } }]

  it('accepts a map keyed by plan name and by glob', () => {
    const cfg = parseConfig({
      tfplan_rule_map: { sandbox: ruleList, '*-prod': ruleList, default: ruleList },
    })
    expect(Object.keys(cfg.tfplan_rule_map ?? {})).toEqual(['sandbox', '*-prod', 'default'])
  })

  it('accepts a config with neither rules nor tfplan_rule_map', () => {
    // Everything then evaluates against the built-in default (no_changes).
    const cfg = parseConfig({ target_paths: { include: ['terraform/**'] } })
    expect(cfg.rules).toBeUndefined()
    expect(cfg.tfplan_rule_map).toBeUndefined()
  })

  it('rejects rules alongside tfplan_rule_map.default', () => {
    expect(() => parseConfig({ rules: ruleList, tfplan_rule_map: { default: ruleList } })).toThrow(
      /both define the default rule set/
    )
  })

  it('accepts rules alongside a tfplan_rule_map without a default key', () => {
    const cfg = parseConfig({ rules: ruleList, tfplan_rule_map: { sandbox: ruleList } })
    expect(cfg.rules).toHaveLength(1)
  })

  it('rejects a key starting with "!"', () => {
    expect(() => parseConfig({ tfplan_rule_map: { '!prod': ruleList } })).toThrow(
      /negated patterns/
    )
  })

  it('rejects an empty rule list under a key', () => {
    expect(() => parseConfig({ tfplan_rule_map: { sandbox: [] } })).toThrow(/invalid config/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/config.test.ts`

Expected: FAIL — the first case fails because `.strict()` rejects the unknown key `tfplan_rule_map`.

- [ ] **Step 3: Write the implementation**

In `src/config.ts`, replace the `ConfigSchema` block (currently lines 63-79) with:

```ts
const RuleListSchema = z.array(RuleSchema).nonempty()

const ConfigSchema = z
  .object({
    /**
     * Scope gate. A PR changing anything outside it is skipped before the plan
     * is even evaluated. Omitting `target_paths` disables the gate entirely
     * (every changed file is in scope) — which is not the same as an empty
     * `include`, where nothing is in scope and nothing is ever approved.
     */
    target_paths: TargetPathsSchema.optional(),
    /**
     * Rules for plans that no `tfplan_rule_map` key selects. The same bucket as
     * `tfplan_rule_map.default`, kept as-is for configs written before the map
     * existed. Omitting both falls back to the built-in `no_changes` rule
     * (see `rule-map.ts`), so an incomplete config is strict, not permissive.
     */
    rules: RuleListSchema.optional(),
    /**
     * Plan name — or a glob over plan names — to the rules that plan must
     * satisfy. Names come from the `name=glob` form of the `plan-files` input.
     */
    tfplan_rule_map: z.record(z.string().min(1), RuleListSchema).optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    // Key-level checks live here rather than in the record's key schema so the
    // behavior does not depend on how zod applies refinements to record keys.
    for (const key of Object.keys(cfg.tfplan_rule_map ?? {})) {
      if (key.startsWith('!')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tfplan_rule_map', key],
          message:
            'negated patterns (starting with "!") are not supported as "tfplan_rule_map" keys',
        })
      }
    }
    // Two places claiming the same bucket: which one wins would be invisible in
    // the config, so refuse rather than pick.
    if (cfg.rules && Object.hasOwn(cfg.tfplan_rule_map ?? {}, 'default')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules'],
        message:
          '"rules" and "tfplan_rule_map.default" both define the default rule set; keep only one',
      })
    }
  })
```

Leave the `export type` lines that follow unchanged — `Config` is inferred, so it picks up both new shapes automatically.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/config.test.ts && npm run build`

Expected: PASS for all config tests. `npm run build` (tsc) will now report errors in `src/main.ts` because `config.rules` is possibly `undefined` — that is expected and is fixed in Task 4. Confirm the only errors are in `src/main.ts`.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/config.ts __tests__/config.test.ts
git commit -m "feat: add the tfplan_rule_map config schema and make rules optional"
```

---

### Task 4: `main.ts` — per-name globbing and per-plan rule sets

**Files:**
- Modify: `src/main.ts` (the module doc comment, imports, `resolvePlanFiles`, the plan-evaluation block, the outputs)
- Modify: `src/summary.ts:9-12` (`PlanResult` gains two fields)
- Test: `__tests__/main.test.ts` (make the glob mock pattern-aware, then append a new `describe`)

**Interfaces:**
- Consumes: `parsePlanFilesInput` / `PlanFileEntry` (Task 1), `resolveRuleSet` / `unusedRuleMapKeys` (Task 2), `Config.tfplan_rule_map` (Task 3).
- Produces: `PlanResult` becomes `{ file: string; name: string | null; ruleSet: string; evaluation: PlanEvaluation }`, consumed by Task 5. New action output `plan-results`.

- [ ] **Step 1: Extend `PlanResult` so `main.ts` has somewhere to put the new fields**

In `src/summary.ts`, replace the `PlanResult` interface (lines 9-12) with:

```ts
export interface PlanResult {
  file: string
  /** null when the plan came from a bare glob rather than a `name=glob` entry. */
  name: string | null
  /** Which `tfplan_rule_map` bucket was applied; see `rule-map.ts`. */
  ruleSet: string
  evaluation: PlanEvaluation
}
```

Rendering these fields is Task 5; this step only widens the type.

- [ ] **Step 2: Make the glob mock in `main.test.ts` pattern-aware**

`main.ts` will glob once per `plan-files` entry, so the mock can no longer return one fixed list for every pattern.

In `__tests__/main.test.ts`, add a declaration next to `let planFiles: string[]`:

```ts
let planFilesByPattern: Record<string, string[]>
```

In `beforeEach`, add `planFilesByPattern = {}` next to `planFiles = []`, and replace the `glob.create` mock with:

```ts
  vi.mocked(glob.create).mockImplementation(async (pattern: string) => {
    // Tests that set a single-line `plan-files` keep using `planFiles`; tests
    // with several entries look each pattern up in `planFilesByPattern`.
    const files = pattern === inputs['plan-files'] ? planFiles : (planFilesByPattern[pattern] ?? [])
    return { glob: async () => files } as unknown as glob.Globber
  })
```

Run: `npx vitest run __tests__/main.test.ts`

Expected: PASS — the existing tests all use a single-line `plan-files`, so this is a no-op for them. This confirms the mock rework in isolation before any `main.ts` change.

- [ ] **Step 3: Write the failing test**

Append to `__tests__/main.test.ts`:

```ts
describe('run: per-plan rule sets', () => {
  /** Point a named entry at a fixture plan. */
  function namePlan(name: string, fixture: string): string {
    const pattern = `plans/${name}.json`
    planFilesByPattern[pattern] = [path.join(FIXTURES, fixture)]
    return `${name}=${pattern}`
  }

  it('applies a different rule set per plan name', async () => {
    writeConfig(`
target_paths:
  include:
    - terraform/**
tfplan_rule_map:
  sandbox:
    - name: anything
      when:
        allowed_actions: [create, update, delete]
  default:
    - name: no-changes
      when:
        no_changes: true
`)
    inputs['plan-files'] = [
      namePlan('sandbox', 'with-delete.json'),
      namePlan('prod', 'no-changes.json'),
    ].join('\n')

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(outputs().approved).toBe('true')
    const results = JSON.parse(outputs()['plan-results']) as Array<Record<string, unknown>>
    expect(results.map((r) => [r.name, r.ruleSet, r.rule])).toEqual([
      ['sandbox', 'sandbox', 'anything'],
      ['prod', 'default', 'no-changes'],
    ])
  })

  it('does not let a permissive rule set leak onto another plan', async () => {
    writeConfig(`
target_paths:
  include:
    - terraform/**
tfplan_rule_map:
  sandbox:
    - name: anything
      when:
        allowed_actions: [create, update, delete]
  default:
    - name: no-changes
      when:
        no_changes: true
`)
    inputs['plan-files'] = [
      namePlan('sandbox', 'with-delete.json'),
      namePlan('prod', 'with-delete.json'),
    ].join('\n')

    await run()

    expect(approvePullRequest).not.toHaveBeenCalled()
    expect(outputs().approved).toBe('false')
  })

  it('evaluates an unnamed plan against the built-in default', async () => {
    writeConfig('target_paths:\n  include:\n    - terraform/**\n')
    inputs['plan-files'] = 'plans/*.json'
    planFiles = [path.join(FIXTURES, 'no-changes.json')]

    await run()

    expect(outputs().approved).toBe('true')
    const results = JSON.parse(outputs()['plan-results']) as Array<Record<string, unknown>>
    expect(results[0].name).toBeNull()
    expect(results[0].ruleSet).toBe('built-in default')
  })

  it('fails when a named entry matches more than one file', async () => {
    writeConfig('target_paths:\n  include:\n    - terraform/**\n')
    inputs['plan-files'] = 'sandbox=plans/*.json'
    planFilesByPattern['plans/*.json'] = [
      path.join(FIXTURES, 'no-changes.json'),
      path.join(FIXTURES, 'update-only.json'),
    ]

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('matched 2 files'))
    expect(approvePullRequest).not.toHaveBeenCalled()
  })

  it('treats a named entry matching no file as a stack that was not planned', async () => {
    // The normal monorepo case: only the stacks a PR touches produce artifacts.
    writeConfig('target_paths:\n  include:\n    - terraform/**\n')
    inputs['plan-files'] = ['absent=plans/absent.json', namePlan('prod', 'no-changes.json')].join(
      '\n'
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(outputs().approved).toBe('true')
    expect(JSON.parse(outputs()['plan-results'])).toHaveLength(1)
  })

  it('warns about a rule map key that selected no plan', async () => {
    writeConfig(`
target_paths:
  include:
    - terraform/**
tfplan_rule_map:
  sandbbox:
    - name: anything
      when:
        allowed_actions: [create, update, delete]
  default:
    - name: no-changes
      when:
        no_changes: true
`)
    inputs['plan-files'] = namePlan('sandbox', 'no-changes.json')

    await run()

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('"sandbbox" matched no plan'))
  })

  it('reports plan-results as empty when the scope check short-circuits', async () => {
    vi.mocked(listChangedFiles).mockResolvedValue(['app/main.go'])

    await run()

    expect(outputs()['plan-results']).toBe('[]')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run __tests__/main.test.ts`

Expected: FAIL — `outputs()['plan-results']` is `undefined`, and the named entries produce no per-name globbing yet.

- [ ] **Step 5: Rework `resolvePlanFiles` in `src/main.ts`**

Replace the `resolvePlanFiles` function (currently lines 32-36) with:

```ts
interface ResolvedPlanFile {
  file: string
  /** null when the file came from a bare glob rather than a `name=glob` entry. */
  name: string | null
}

async function resolvePlanFiles(entries: PlanFileEntry[]): Promise<ResolvedPlanFile[]> {
  const byFile = new Map<string, ResolvedPlanFile>()

  for (const entry of entries) {
    const globber = await glob.create(entry.pattern, { matchDirectories: false })
    const files = Array.from(new Set(await globber.glob()))

    // Matching nothing is normal — only the stacks a PR touches produce a plan.
    // Matching several files is not: the outputs and the summary key per-plan
    // results by name, so a name has to identify exactly one plan.
    if (entry.name !== null && files.length > 1) {
      throw new Error(
        `plan name "${entry.name}" matched ${files.length} files (${files.join(', ')}); ` +
          'a name must identify exactly one plan'
      )
    }
    if (entry.name !== null && files.length === 0) {
      core.info(`  ${entry.name}: no plan file matched ${entry.pattern} (stack not planned)`)
    }

    for (const file of files) {
      const existing = byFile.get(file)
      if (!existing) {
        byFile.set(file, { file, name: entry.name })
        continue
      }
      // A file reachable from both a named and a bare entry keeps the name:
      // the named entry is the more specific statement of intent, and the
      // result must not depend on which line happens to come first.
      if (existing.name === null && entry.name !== null) {
        existing.name = entry.name
      }
    }
  }

  return Array.from(byFile.values())
}
```

Add the imports at the top of `src/main.ts`, next to the existing ones:

```ts
import { parsePlanFilesInput, PlanFileEntry } from './plan-files'
import { resolveRuleSet, unusedRuleMapKeys } from './rule-map'
```

- [ ] **Step 6: Rework the plan-evaluation block in `src/main.ts`**

Replace the block from `const planFiles = await resolvePlanFiles(planInput)` down to and including the `const results: PlanResult[] = ...` assignment (currently lines 124-150) with:

```ts
    const planFiles = await resolvePlanFiles(parsePlanFilesInput(planInput))
    if (planFiles.length === 0 && !allowEmptyPlans) {
      throw new Error(
        `no plan files matched: ${planInput} (set "allow-empty-plans: true" if a PR in scope ` +
          'legitimately produces no plan, e.g. a docs-only change)'
      )
    }
    if (planFiles.length === 0) {
      // The scope check is the only thing standing between this PR and an
      // approval — say so loudly, because a lost artifact or a typo in
      // `plan-files` looks exactly like a legitimate docs-only change.
      core.warning(
        `no plan files matched: ${planInput} — no plan was evaluated; approving on the ` +
          'scope check alone. Verify that the plan job actually produced the plan JSON.'
      )
    }
    core.info(`Evaluating ${planFiles.length} plan file(s).`)

    const results: PlanResult[] = planFiles.map(({ file, name }) => {
      const content = fs.readFileSync(file, 'utf8')
      const plan = parsePlan(content)
      const { ruleSet, rules } = resolveRuleSet(name, {
        ruleMap: config.tfplan_rule_map,
        rules: config.rules,
      })
      const evaluation = evaluatePlan(plan, rules)
      core.info(
        `  ${file} [${name ?? 'unnamed'}] against "${ruleSet}": ` +
          (evaluation.matched ? `matched "${evaluation.matchedRule}"` : 'no match')
      )
      return { file, name, ruleSet, evaluation }
    })

    for (const key of unusedRuleMapKeys(
      config.tfplan_rule_map,
      results.map((r) => r.ruleSet)
    )) {
      core.warning(
        `"tfplan_rule_map" key "${key}" matched no plan in this run — check the "plan-files" ` +
          'names if that stack was expected to be evaluated.'
      )
    }
```

Note that the `core.info` line no longer mentions `config.rules.length`: with per-plan rule sets there is no single rule count for the run, and `config.rules` is now optional.

- [ ] **Step 7: Add the `plan-results` output**

In `src/main.ts`, immediately after the existing `core.setOutput('out-of-scope-files', '[]')` line, add:

```ts
    core.setOutput(
      'plan-results',
      JSON.stringify(
        results.map((r) => ({
          file: r.file,
          name: r.name,
          ruleSet: r.ruleSet,
          rule: r.evaluation.matchedRule,
          matched: r.evaluation.matched,
        }))
      )
    )
```

And in the scope-gate short-circuit block, next to `core.setOutput('matched-rules', '{}')`, add:

```ts
      core.setOutput('plan-results', '[]')
```

`matched-rules` keeps its existing shape — consumers depend on it.

- [ ] **Step 8: Update the module doc comment in `src/main.ts`**

Replace step 4 of the flow comment (currently line 10, `*   4. evaluate each plan against the rules`) with:

```
 *   4. evaluate each plan against the rule set its name selects
```

- [ ] **Step 9: Run the full test suite and the type check**

Run: `npm run test && npm run build`

Expected: PASS for every test file, and `tsc` reports no errors.

- [ ] **Step 10: Commit**

```bash
npm run format
npm run lint
git add src/main.ts src/summary.ts __tests__/main.test.ts
git commit -m "feat: evaluate each plan against the rule set its name selects"
```

---

### Task 5: `summary.ts` — render the name and rule set

**Files:**
- Modify: `src/summary.ts` (the plan table and the no-match details)
- Test: `__tests__/summary.test.ts` (new)

**Interfaces:**
- Consumes: `PlanResult` with `name` and `ruleSet` (Task 4).
- Produces: nothing other modules use.

- [ ] **Step 1: Write the failing test**

Create `__tests__/summary.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@actions/core')

import * as core from '@actions/core'
import { PlanResult, writeSummary } from '../src/summary'

/** A chainable stub standing in for `core.summary`. */
function stubSummary(): { addTable: ReturnType<typeof vi.fn>; addRaw: ReturnType<typeof vi.fn> } {
  const calls = { addTable: vi.fn(), addRaw: vi.fn() }
  const chain = {
    addHeading: vi.fn(() => chain),
    addRaw: vi.fn((...args: unknown[]) => {
      calls.addRaw(...args)
      return chain
    }),
    addList: vi.fn(() => chain),
    addDetails: vi.fn(() => chain),
    addTable: vi.fn((...args: unknown[]) => {
      calls.addTable(...args)
      return chain
    }),
    write: vi.fn(async () => chain),
  }
  Object.defineProperty(core, 'summary', { value: chain, configurable: true })
  return calls
}

const result = (over: Partial<PlanResult> = {}): PlanResult => ({
  file: 'plans/a.json',
  name: 'sandbox',
  ruleSet: 'sandbox',
  evaluation: { matched: true, matchedRule: 'anything', ruleEvaluations: [] },
  ...over,
})

let calls: ReturnType<typeof stubSummary>

beforeEach(() => {
  vi.clearAllMocks()
  calls = stubSummary()
})

describe('writeSummary', () => {
  it('renders a name and rule set column for every plan', async () => {
    await writeSummary({ pathCheck: null, results: [result()], approved: true })

    const [rows] = calls.addTable.mock.calls[0] as [Array<Array<unknown>>]
    expect(rows[0]).toEqual([
      { data: 'Plan file', header: true },
      { data: 'Name', header: true },
      { data: 'Rule set', header: true },
      { data: 'Result', header: true },
      { data: 'Matched rule', header: true },
    ])
    expect(rows[1]).toEqual(['plans/a.json', 'sandbox', 'sandbox', '✅ matched', 'anything'])
  })

  it('shows an unnamed plan with a placeholder rather than an empty cell', async () => {
    await writeSummary({
      pathCheck: null,
      results: [result({ name: null, ruleSet: 'built-in default' })],
      approved: true,
    })

    const [rows] = calls.addTable.mock.calls[0] as [Array<Array<unknown>>]
    expect(rows[1]).toEqual([
      'plans/a.json',
      '-',
      'built-in default',
      '✅ matched',
      'anything',
    ])
  })

  it('warns when a plan fell through to the built-in default', async () => {
    // Usually means a name was never wired up in `plan-files`.
    await writeSummary({
      pathCheck: null,
      results: [result({ name: null, ruleSet: 'built-in default' })],
      approved: true,
    })

    const raw = calls.addRaw.mock.calls.map((c) => String(c[0])).join('\n')
    expect(raw).toContain('built-in default')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/summary.test.ts`

Expected: FAIL — the header row has three columns, not five.

- [ ] **Step 3: Write the implementation**

In `src/summary.ts`, replace the `summary.addTable([...])` call (currently lines 76-87) with:

```ts
      summary.addTable([
        [
          { data: 'Plan file', header: true },
          { data: 'Name', header: true },
          { data: 'Rule set', header: true },
          { data: 'Result', header: true },
          { data: 'Matched rule', header: true },
        ],
        ...results.map((r) => [
          r.file,
          r.name ?? '-',
          r.ruleSet,
          r.evaluation.matched ? '✅ matched' : '❌ no match',
          r.evaluation.matchedRule ?? '-',
        ]),
      ])

      // Landing on the built-in default nearly always means a name was never
      // wired up, so the plan was judged by stricter rules than intended.
      const builtIn = results.filter((r) => r.ruleSet === BUILT_IN_LABEL)
      if (builtIn.length > 0) {
        summary.addRaw(
          `⚠️ ${builtIn.length} plan(s) were evaluated against the **built-in default** ` +
            '(`no_changes` only) because no rule set selected them.',
          true
        )
      }
```

Import the label from `rule-map.ts` rather than restating it, so the two cannot
drift apart. Add to the imports at the top of `src/summary.ts`:

```ts
import { BUILT_IN_LABEL } from './rule-map'
```

(`rule-map.ts` imports only from `config.ts`, so this introduces no cycle.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/summary.test.ts && npm run test`

Expected: PASS for the new file and for the whole suite.

- [ ] **Step 5: Commit**

```bash
npm run format
npm run lint
git add src/summary.ts __tests__/summary.test.ts
git commit -m "feat: show the plan name and rule set in the job summary"
```

---

### Task 6: `action.yml`, docs, example config and `dist/`

**Files:**
- Modify: `action.yml` (the `plan-files` input description, a new `plan-results` output)
- Modify: `README.md:78` (the `plan-files` input row)
- Modify: `docs/configuration.md` (a new section)
- Modify: `docs/monorepo.md` (a new section)
- Modify: `examples/tf-pr-approver.yml` (a commented pointer)
- Modify: `dist/index.js`, `dist/index.js.map` (generated)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: nothing.

- [ ] **Step 1: Update `action.yml`**

Replace the `plan-files` input description with:

```yaml
  plan-files:
    description: >-
      Glob pattern(s) or newline-separated paths to the terraform plan JSON
      file(s) to evaluate (produced by `terraform show -json <planfile>`).
      A line may also take the `name=glob` form, which binds a name to that
      plan so `tfplan_rule_map` in the config can apply a rule set to it.
      Every matched plan must satisfy at least one rule for the PR to be
      approved.
    required: true
```

Add to `outputs:`, after `out-of-scope-files`:

```yaml
  plan-results:
    description: >-
      JSON array of per-plan results: `file`, `name` (null when unnamed),
      `ruleSet` (the `tfplan_rule_map` bucket applied), `rule` (the rule that
      matched, or null) and `matched`.
```

- [ ] **Step 2: Update `README.md`**

Replace the `plan-files` row of the inputs table (line 78) with:

```markdown
| `plan-files`          | yes      | —                               | Glob pattern(s) or newline-separated paths to the plan JSON files, optionally as `name=glob` to bind a name for `tfplan_rule_map`. Every matched plan must be safe. |
```

In the outputs table in the same file, add a row:

```markdown
| `plan-results`   | JSON array of per-plan results: file, name, rule set, matched rule. |
```

- [ ] **Step 3: Add the `tfplan_rule_map` section to `docs/configuration.md`**

Insert before the `## Behavior` section (currently line 93):

````markdown
## `tfplan_rule_map` (per-plan rules)

In a monorepo, different stacks carry different risk. `rules` is one flat list
applied to every plan, and rules are OR'd, so a permissive rule added for a
sandbox stack also applies to production. `tfplan_rule_map` keys rule sets by
plan name instead:

```yaml
tfplan_rule_map:
  sandbox:
    - name: anything
      when:
        allowed_actions: [create, update, delete]
  "*-prod":
    - name: no-changes
      when:
        no_changes: true
  default:
    - name: create-only
      when:
        allowed_actions: [create]
        denied_resource_types: [google_project_iam_member]
```

Names come from the `name=glob` form of the `plan-files` input:

```yaml
plan-files: |
  sandbox=tfplans/tfplan-sandbox/tfplan.json
  api-prod=tfplans/tfplan-api-prod/tfplan.json
```

### Resolution order

For each plan, in order:

1. a key matching the name **exactly**
2. a **glob** key — exactly one must match, or the action fails
3. `default`
4. the top-level `rules`, if there is no `default`
5. the **built-in default**: `no_changes` only

`default` is reserved and is never matched as a glob. Steps 4 and 5 are what
make an incomplete configuration fail closed — a plan whose name was never
listed is judged by the strictest useful rule, not waved through.

`rules` and `tfplan_rule_map.default` mean the same thing, so declaring both is
rejected. `rules` on its own keeps working exactly as before.

> **`target_paths` must exclude your workflow files when you use
> `tfplan_rule_map`.** Plan names come from the workflow, which lives in the
> repository, and under `pull_request` the head branch's workflow is what runs.
> Without that exclusion a PR could rename a production artifact into a
> permissive rule set. The scope check is what prevents this.
````

- [ ] **Step 4: Add the per-stack section to `docs/monorepo.md`**

Append to `docs/monorepo.md`:

````markdown
## Different rules per stack

Bind a name to each stack's plan and give the risky ones their own rule set. The
plan jobs already know their artifact names, so the workflow can pass them
through:

```yaml
- uses: nakamasato/tf-pr-approver@v1
  with:
    plan-files: |
      sandbox=tfplans/${{ needs.sandbox.outputs.tfplan_artifact_name }}/tfplan.json
      api-prod=tfplans/${{ needs.api-prod.outputs.tfplan_artifact_name }}/tfplan.json
```

```yaml
# .github/tf-pr-approver.yml
target_paths:
  include:
    - stacks/**
  exclude:
    - .github/workflows/**
    - .github/tf-pr-approver.yml

tfplan_rule_map:
  sandbox:
    - name: anything
      when:
        allowed_actions: [create, update, delete]
  default:
    - name: no-changes
      when:
        no_changes: true
```

A named entry that matches no file is fine — only the stacks a PR touches
produce an artifact. A named entry matching *several* files fails the job: a
name has to identify one plan for the summary and `plan-results` to stay
readable.

See [configuration.md](configuration.md#tfplan_rule_map-per-plan-rules) for the
full resolution order and the `target_paths` requirement.
````

- [ ] **Step 5: Point at the new section from the example config**

Append to `examples/tf-pr-approver.yml`:

```yaml
# For per-stack rules in a monorepo, replace `rules` with `tfplan_rule_map`.
# See docs/configuration.md and docs/monorepo.md.
```

- [ ] **Step 6: Rebuild `dist/`**

Run: `npm run all`

Expected: `tsc` clean, every test passing, `dist/index.js` rewritten. The
`check-dist` workflow fails if this is skipped.

- [ ] **Step 7: Commit**

```bash
npm run format
git add action.yml README.md docs/configuration.md docs/monorepo.md examples/tf-pr-approver.yml dist
git commit -m "docs: document tfplan_rule_map and rebuild dist"
```

- [ ] **Step 8: Final verification**

```bash
npm run all
npm run lint
npm run format:check
git status --short
```

Expected: all green, and `git status` clean — a dirty `dist/` here means step 6
was run before a later `src/` edit.

---

## Out of scope

Recorded in the spec, deliberately not built here:

- An optional `paths` selector alongside the name, so a permissive rule set
  applies only when the PR's changed files also fall under those paths. This
  would close the workflow-rename gap that `target_paths` currently covers.
- Changing the shape of the existing `matched-rules` output.
