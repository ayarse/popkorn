# Popcorn

A CSS-like DSL for defining scene graphs and animations, powered by tree-sitter.

## Packages

- `@popcorn/parser` - Tree-sitter based parser for Popcorn DSL
- `@popcorn/demo` - React demo application
- `tree-sitter-popcorn` - Tree-sitter grammar definition

## Getting Started

```bash
bun install
bun run dev
```

Open http://localhost:5173

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start demo dev server |
| `bun run build` | Build demo app |
| `bun run build:grammar` | Rebuild tree-sitter grammar |
| `bun run test:grammar` | Run grammar tests |

## Example

```css
:canvas {
  width: 800px;
  height: 600px;
  background: #1a1a2e;
}

#ball {
  shape: circle;
  cx: 100px;
  cy: 100px;
  r: 20px;
  fill: #e94560;
  animation: bounce 1s ease-in-out infinite alternate;
}

@keyframes bounce {
  from { transform: translateY(0); }
  to { transform: translateY(100px); }
}
```

## Project Structure

```
popcorn/
├── apps/
│   └── demo/                 # React demo app
├── packages/
│   ├── popcorn-parser/       # Parser + WASM binaries
│   └── tree-sitter-popcorn/  # Grammar definition
├── examples/                 # Example DSL files
└── docs/                     # Documentation
```

## Architecture

### tree-sitter-popcorn → popcorn-parser

```
┌─────────────────────────┐      build      ┌─────────────────────────┐
│  tree-sitter-popcorn    │ ──────────────► │    popcorn-parser       │
│                         │                 │                         │
│  grammar.js             │                 │  wasm/                  │
│  └─ defines syntax      │                 │  ├─ tree-sitter-popcorn.wasm
│                         │                 │  └─ web-tree-sitter.wasm
│  test/corpus/           │                 │                         │
│  └─ grammar tests       │                 │  src/                   │
│                         │                 │  ├─ tree-sitter-parser.ts
└─────────────────────────┘                 │  └─ ast.ts              │
                                            └─────────────────────────┘
```

**tree-sitter-popcorn** defines the grammar in `grammar.js` using tree-sitter's DSL. Running `bun run build:grammar`:

1. Generates the C parser from `grammar.js`
2. Compiles to WebAssembly (`tree-sitter-popcorn.wasm`)
3. Copies the WASM to `popcorn-parser/wasm/`

**popcorn-parser** provides the runtime:

- Loads the WASM binary via `web-tree-sitter`
- Transforms tree-sitter's CST into a typed AST
- Exports `parse()`, `initParser()`, and AST types

Apps import from `@popcorn/parser` and don't interact with tree-sitter directly.
