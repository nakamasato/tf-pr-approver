# Changelog

## [2.1.0](https://github.com/nakamasato/tf-pr-approver/compare/v2.0.1...v2.1.0) (2026-08-25)


### Features

* list the matched rule per plan in the approval review body ([#16](https://github.com/nakamasato/tf-pr-approver/issues/16)) ([f74567e](https://github.com/nakamasato/tf-pr-approver/commit/f74567ec2ea7e763eb9b782bdad821fc1c7291e2))

## [2.0.1](https://github.com/nakamasato/tf-pr-approver/compare/v2.0.0...v2.0.1) (2026-08-10)


### Bug Fixes

* treat a plan-files glob with an empty path segment as no match ([#12](https://github.com/nakamasato/tf-pr-approver/issues/12)) ([6bc3bd6](https://github.com/nakamasato/tf-pr-approver/commit/6bc3bd608dac9859e4bb0100049e8c14394de00b))

## [2.0.0](https://github.com/nakamasato/tf-pr-approver/compare/v1.0.1...v2.0.0) (2026-07-31)


### ⚠ BREAKING CHANGES

* per-plan rule sets via tfplan_rule_map ([#10](https://github.com/nakamasato/tf-pr-approver/issues/10))

### Features

* per-plan rule sets via tfplan_rule_map ([#10](https://github.com/nakamasato/tf-pr-approver/issues/10)) ([94547fa](https://github.com/nakamasato/tf-pr-approver/commit/94547fafc40179cdde17f4e3503343baf43b1be1))

## [1.0.1](https://github.com/nakamasato/tf-pr-approver/compare/v1.0.0...v1.0.1) (2026-07-23)


### Bug Fixes

* bump action runtime from node20 to node24 ([#5](https://github.com/nakamasato/tf-pr-approver/issues/5)) ([d81e9fb](https://github.com/nakamasato/tf-pr-approver/commit/d81e9fb4effbef289e3df2b78ad87a0e6417718f))

## [1.0.0](https://github.com/nakamasato/tf-pr-approver/compare/v0.1.0...v1.0.0) (2026-07-22)


### ⚠ BREAKING CHANGES

* split target_paths into include/exclude ([#2](https://github.com/nakamasato/tf-pr-approver/issues/2))

### Features

* gate auto-approval on a target_paths scope check ([#1](https://github.com/nakamasato/tf-pr-approver/issues/1)) ([aa613e9](https://github.com/nakamasato/tf-pr-approver/commit/aa613e94393157234df82d8550e5d51b93b2f11c))
* initial implementation of tf-pr-approver action ([755aaff](https://github.com/nakamasato/tf-pr-approver/commit/755aaffe5b0122ace5812a6c88ab8139a33354ab))
* split target_paths into include/exclude ([#2](https://github.com/nakamasato/tf-pr-approver/issues/2)) ([6482a90](https://github.com/nakamasato/tf-pr-approver/commit/6482a90a7dd948ee842a6884908c4693390ca201))
