# tf-pr-approver

Terraform plan JSON を宣言的ルールで評価し、安全な PR を GitHub App の ID で
auto-approve する GitHub Action (TypeScript / Node 24)。

利用者向けの仕様（inputs・outputs・config リファレンス）は [README.md](README.md) を参照。
ここには「触るときに壊しやすいこと」だけを書く。

## Commands

```bash
npm ci
npm test              # vitest
npm run lint          # eslint
npm run format        # prettier （format:check が CI にあるので commit 前に実行）
npm run build         # tsc 型チェック
npm run package       # esbuild → dist/index.js  ← src/ を変えたら必須
npm run all           # build + test + package
```

## ⚠️ dist/ はコミットする

Action の実行実体は `dist/index.js`。`src/` を変更したら **必ず** `npm run package`
を実行して `dist/` も一緒に commit する。忘れると `check-dist` ワークフローが
差分を検出して CI が落ち、かつ古い挙動が黙って出荷される。

## PR / コミット規約

- **PR タイトルは必ず [Conventional Commits](https://www.conventionalcommits.org/) 形式**
  （`feat:` / `fix:` / `chore:` / `ci:` / `docs:` ...）。
  squash merge されたタイトルが release-please のリリース判定に使われるため、
  形式を外すとリリースが正しく作られない。`pr-title` ワークフローが CI でチェックする。
- `fix:` → patch / `feat:` → minor / `feat!:` または `BREAKING CHANGE:` → major

## Architecture

`src/index.ts` → `src/main.ts` の `run()` が全体をオーケストレーションする
（`index.ts` を薄く保っているのはテストが `run()` を直接叩けるようにするため）。

1. `config.ts` — YAML 読込 + zod 検証
2. `changed-files.ts` + `paths.ts` — **scope gate**（ここで短絡する）
3. `plan.ts` — plan JSON パース
4. `evaluate.ts` — ルール評価（ルール間は OR、`when` 内は AND）
5. `approve.ts` — approve（head SHA が既に APPROVED なら冪等スキップ）
6. `summary.ts` — Job Summary 出力

`evaluate.ts` と `paths.ts` は I/O・副作用なしの純粋ロジックに保つ。

## Fail-closed の不変条件（バグに見えるが意図的）

セキュリティゲートなので、迷ったら「承認しない」側に倒す。以下を「修正」しないこと。

- `target_paths` に `exclude` だけ書くと**何もスコープ内にならない**（＝何も承認されない）
- `target_paths` の省略は「ゲート無効（全ファイル in scope）」で、空の `include` とは別物
- `allow-empty-plans: true` + `target_paths` なし は**エラーで拒否**（任意の PR を無条件承認してしまうため）
- `!` 始まりのパターンは zod と minimatch の `nonegate: true` で二重に拒否する
- 変更ファイル数が GitHub の 3000 件上限に達したら throw（リスト切り捨てで scope check が信頼できない）
- rename は新旧の両パスを scope 対象に含める

## エラーポリシー

- 「条件を満たさない」＝ 正常な **skip**（`core.info` + `approved=false`）
- 設定・入力・plan JSON の不正 ＝ **失敗**（`core.setFailed`）
