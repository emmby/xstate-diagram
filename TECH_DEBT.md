# Technical Debt & Follow-Up Backlog

This document tracks known follow-up items following the replacement of the legacy Mermaid `stateDiagram-v2` compiler (`v0.0.1`, preserved at tag `archive/mermaid-v0.0.1`) with the `elkjs` + pure-JS SVG statechart engine (`v0.2.0`).

---

## 1. ~~XState v5 Core Test-Suite Spec Conformance (`tests/xstate-core-specs/`)~~ *(Retired & Removed)*

- Retired and removed `tests/xstate-core-specs/` (977 raw TypeScript AST scraper JSON dumps from the `v0.0.1` Mermaid prototype) and `scripts/extract-xstate-core-specs.ts` (historical files remain preserved at tag `archive/mermaid-v0.0.1`).
- Conformance and visual/geometric verification are covered directly by the Tier 1–4 closed-loop suites (`tests/tier1.test.ts`–`tests/tier4.test.ts` + `tests/fixtures/`) and the Stately reference corpus (`tests/reference-corpus/`).

---

## 2. Post-Merge Mermaid Legacy Cleanup

Following the v0.2.0 ELK/SVG engine cutover on main (with the final Mermaid commit 56c5712 preserved on origin at tag archive/mermaid-v0.0.1):

1. ~~**Close Superseded Mermaid-Era Pull Requests:**~~ *(Completed)*
   - Closed open PRs targeting the retired Mermaid compiler (`#22`, `#23`, `#25`) with a note linking to the `v0.2.0` ELK/SVG engine replacement.
2. ~~**Close Resolved / Superseded Mermaid-Era Issues:**~~ *(Completed)*
   - Closed `#13` (`getSafeId` Mermaid identifier collisions) and `#24` (multi-edge transitions between identical states colliding in Mermaid/Dagre).
3. ~~**Prune Stale `wt-*` Mermaid Branches & Worktrees:**~~ *(Remote branches pruned on `origin`)*
   - Pruned all 20 remote `wt-*` branches on `origin` (`wt-after-transitions`, `wt-batch-*`, `wt-bead-system`, `wt-deep-states`, `wt-entry-actions`, `wt-final-states`, `wt-history-*`, `wt-issue-16-v1`, `wt-parallel*`, `wt-phase*`, `wt-setup-ci`). Any remaining local worktrees or local branches (`wt-*`, `fix_mermaid_labels_actions`) on a developer workstation can be pruned with `git worktree prune && git fetch --prune origin`.
4. **Retire Bootstrap Directory:** Archive or remove the local `/Users/mike/GitHub/xstate-svg` bootstrap repository now that `main` on `xstate-diagram` is canonical.
