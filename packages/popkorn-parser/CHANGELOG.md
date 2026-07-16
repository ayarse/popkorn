# @popkorn/parser

## 0.2.0

### Minor Changes

- 0c68292: Namespace player DOM events under `popkorn:` and add pointer interactivity.

  Events now dispatch as `popkorn:click`, `popkorn:load`, `popkorn:complete` and
  friends instead of their bare names, so a host page can tell a player event from
  a native one. Click resolution walks the full tree rather than only top-level
  nodes, and the new `cursor: pointer` property lets a node advertise itself as
  clickable.

  Breaking: listeners bound to the old un-namespaced event names must be renamed.

## 0.1.1

### Patch Changes

- 38bde24: Add repository/homepage/bugs metadata so npm pages link back to the source repo.
