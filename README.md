# choicescript-tree

A static analyser for [ChoiceScript](https://www.choiceofgames.com/make-your-own-games/choicescript-intro/) interactive fiction games. Implements a full compiler pipeline — fetch, scan, parse, analyse — that builds an AST, constructs control flow graphs, performs dataflow analysis, and generates human-readable output like choice guides and Graphviz diagrams.

## Requirements

- Node.js (v18+)
- npm

## Setup

```
npm install
```

## Quick Start

Run the full pipeline:

```
npm start
```

This executes every stage in order: scan → parse → symbol table → scope check → CFG → statements → gosub flattening → inline CFG → variable casing → dataflow → reachability → path analysis → guide → graph.

## Pipeline

Each stage reads from `out/` and writes back to `out/`. Stages are standalone scripts with no shared runtime state.

| Stage | Command | Output |
|---|---|---|
| Fetch | `npm run fetch` | `out/raw-scenes.json` |
| Scan | `npm run scan` | `out/scanned-tokens.json` |
| Parse | `npm run parse` | `out/parsed.json` |
| Symbol table | `npm run analyse:symbols` | `out/symbol-table.json` |
| Scope check | `npm run analyse:scope` | `out/symbol-table.json` (updated) |
| CFG | `npm run analyse:cfg` | `out/cfg.ndjson` |
| Statements | `npm run analyse:statements` | `out/game-statements.ndjson` |
| Gosub flattening | `npm run analyse:flatten-gosubs` | flattened CFG |
| Inline CFG | `npm run analyse:inline-cfg` | `out/inline-cfg.ndjson`, `out/loop-analysis.json` |
| Variable casing | `npm run analyse:variable-casing` | casing warnings |
| Dataflow | `npm run analyse:dataflow` | `out/dataflow.ndjson`, `out/block-states.ndjson` |
| Reachability | `npm run analyse:reachability` | reachability results |
| Path analysis | `npm run analyse:paths` | `out/path-analysis.ndjson` |
| Guide | `npm run guide` | `out/guide.ndjson`, `out/guide.md` |
| Graph | `npm run graph` | `out/graph.dot` |

Run all analysis stages together:

```
npm run analyse
```

## Architecture

```
fetch/          Fetches ChoiceScript scenes from remote URL or local files
scanner/        Lexical analysis — mode-based state machine producing tokens per scene
parser/         Recursive descent parser using indentation-based scoping
analysis/
  symbol-table/ Visitor-pattern AST walk collecting labels, variables, gotos, gosubs
  scope/        Validates cross-scene references (goto_scene, goto_label targets)
  control-flow-graph/
    build-scene/    Per-scene CFG construction
    merge-scenes/   Whole-game CFG stitching with cross-scene edges
    inline/         Gosub flattening and CFG inlining
    loop-analysis/  Natural loop detection and bounding
  dataflow/     Forward abstract interpretation (constants, ranges, sets, input, top)
  reachability/ Dead code and unreachable path detection
  path-analysis/  Path enumeration through the game CFG
  variable-casing/  Case-consistency checks for variable names
renderer/
  guide/        Choice guide generation (markdown + NDJSON)
  graph/        Graphviz .dot output from inline CFG
```

## Tests

```
npm test
```

Tests use snapshot-based comparison against expected output in `tests/snippets/`. Each snippet is a small ChoiceScript game with expected tokens, AST, symbols, and CFG.

Update snapshots after intentional changes:

```
npm run test:update
```

## Codegen

Regenerate scanner token type enums from token definitions:

```
npm run generate:token-types
```

## License

MIT
