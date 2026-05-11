# Path Analysis

Analyses the inline CFG to determine how choice and conditional divergence points converge, which choices are reachable from each branch, and where the control flow splits based on runtime conditions.

## Pipeline

```
Input:  out/inline-cfg.ndjson, out/loop-analysis.json
Output: out/path-analysis.ndjson, out/choice-map.ndjson
Run:    npm run analyse:paths
```

## What it produces

A `DivergenceRecord` for every block that has outgoing choice option edges or conditional branch edges. Each record contains:

- **convergeBlockId** — where the branches rejoin (or `null` if they never converge)
- **branches[]** — one `BranchRecord` per outgoing branch, with:
  - `entryBlockId` — first block of the branch
  - `embeddedChoices` — choice blocks reachable within the branch before convergence
  - `reachableChoices` — total count of choices reachable from the branch entry
  - `isLoopBack` — whether the branch loops back to its parent choice (hub detection)
  - `terminates` — whether the branch reaches a game end or scene progression
- **isSplitPoint** — `true` for conditionals where different branches lead to different first choices

The output also includes a `splitPoints` set used by the choice map to detect where conditional logic routes the player to structurally different parts of the game.

## Architecture (3-phase)

### Phase 1 — Pre-filter + conditional convergence

Not all divergence points matter equally. The analysis handles conditionals in three tiers:

1. **IfFallThrough** (~22k): Conditionals with a fallthrough edge have trivial convergence — the fallthrough target is the convergence point. Resolved instantly.
2. **BFS intersection** (~2k): Conditionals without fallthrough (full `*if`/`*else` blocks). BFS from each branch entry, intersect reachable sets, pick the nearest common block.
3. **Skipped** (~100): Conditionals where no branch reaches any choice within a quick BFS. These are trivial guards with no structural impact on the choice tree.

### Phase 2 — Choice convergence via SCC + bitset propagation

Finding where choice options converge requires knowing which choices are reachable from each branch — across the entire game graph, not just a local region.

1. **Tarjan SCC** — Compute strongly connected components on the full CFG (iterative, handles 80k+ blocks). Collapses cycles so reachability can be computed on a DAG.
2. **Bitset propagation** — Assign each non-stats choice a bit index. In reverse topological order on the condensed DAG, propagate reachable choice bitsets: `reachable[scc] = local[scc] | union(reachable[successor])`.
3. **Convergence** — For each choice divergence, intersect the reachable bitsets of all branch entries. BFS from the choice block to find the nearest common choice in the intersection.

This replaces per-choice BFS(10k) with a single O(V+E) structural pass plus O(choices) per divergence.

### Phase 3 — Branch metadata

With convergence points known, compute per-branch data using bounded walks (entry to convergence, typically 5-50 blocks instead of the previous 10k limit):

- `embeddedChoices`: BFS collecting choice blocks within the branch region
- `reachableChoices`: count of all choices reachable from branch entry
- `terminates`: whether any path hits a `GameEnd` or `SceneProgression` edge
- `isLoopBack`: whether the branch can reach back to its parent choice's canonical block

Finally, split point detection checks each conditional to see if its branches lead to different first embedded choices.

## Files

| File | Purpose |
|------|---------|
| `analyse-paths.ts` | Main analysis: pre-filter, SCC, convergence, branch metadata |
| `choice-map.ts` | Builds the navigable choice tree from divergence records |
| `run.ts` | CLI runner — reads CFG, runs analysis, writes output |
| `divergence-record.ts` | `DivergenceRecord` type definition |
| `branch-record.ts` | `BranchRecord` type definition |
| `path-analysis-result.ts` | `PathAnalysis` result type (divergences + splitPoints) |
| `index.ts` | Re-exports |

## Downstream consumers

- **choice-map.ts** — Walks the game CFG using divergence data to build a tree of player-facing choices. Uses `convergeBlockId`, `embeddedChoices`, `reachableChoices`, `isLoopBack`, and `splitPoints`.
- **guide/index.ts** — Enriches the choice tree with prose, variable state, and achievement data to produce the final guide output. Uses `convergeBlockId`, `embeddedChoices`, `isLoopBack`, `terminates`, and `splitPoints`.
