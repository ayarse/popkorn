# Claude Code Notes

## Architecture

The DSL is a CSS subset parsed by a hand-rolled tokenizing recursive-descent
parser in `packages/popcorn-parser/src/parser.ts` — `parse(source)` returns the
AST synchronously, no dependencies, no build step. (An earlier version used
tree-sitter + WASM; it was removed as overkill for this grammar.) Parser tests
that pin the AST contract live in `src/parser.test.ts` (`bun run test`).

`@popcorn/player` consumes that AST: `buildSceneGraph` → scene graph → Canvas2D
renderer driven by `RenderLoop`.

## Package Manager

This project uses **bun** as the package manager, not npm.

- Use `bun install` for installing dependencies
- Use `bun run build` for building packages
- Use `bun run dev` for development server
- Use `bun --filter <package> <command>` for running commands in specific packages
