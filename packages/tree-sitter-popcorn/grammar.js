/**
 * @file Popcorn DSL grammar for tree-sitter
 * @description CSS-like language for defining scene graphs and animations
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: 'popcorn',

  // Tokens that can appear anywhere (whitespace and comments)
  extras: $ => [
    /\s+/,
    $.comment,
  ],

  // Word token for keyword extraction
  word: $ => $.identifier,

  rules: {
    // Root rule - a stylesheet contains rules and keyframes
    stylesheet: $ => repeat($._item),

    _item: $ => choice(
      $.rule,
      $.keyframes_rule,
    ),

    // =========================================
    // Rules and Selectors
    // =========================================

    rule: $ => seq(
      $.selector,
      $.block,
    ),

    selector: $ => choice(
      $.id_selector,
      $.class_selector,
      $.canvas_selector,
      $.root_selector,
    ),

    id_selector: $ => seq(
      '#',
      $.identifier,
    ),

    class_selector: $ => seq(
      '.',
      $.identifier,
    ),

    canvas_selector: $ => seq(
      ':',
      'canvas',
    ),

    root_selector: $ => seq(
      ':',
      'root',
    ),

    // =========================================
    // Blocks
    // =========================================

    block: $ => seq(
      '{',
      repeat($._block_item),
      '}',
    ),

    _block_item: $ => choice(
      $.declaration,
      $.child_rule,
      $.pseudo_rule,
    ),

    // Pseudo-class rules: &:hover { } and &:active { }
    pseudo_rule: $ => seq(
      '&',
      $.pseudo_selector,
      $.declaration_block,
    ),

    pseudo_selector: $ => choice(
      $.hover_pseudo,
      $.active_pseudo,
    ),

    hover_pseudo: $ => seq(':', 'hover'),
    active_pseudo: $ => seq(':', 'active'),

    // Nested child rules use > combinator
    child_rule: $ => seq(
      '>',
      $.rule,
    ),

    // =========================================
    // Declarations
    // =========================================

    declaration: $ => seq(
      $.property,
      ':',
      $._value_list,
      optional(';'),
    ),

    property: $ => choice(
      $.custom_property,
      $.identifier,
    ),

    // CSS custom properties: --cursor-x, --my-var
    custom_property: $ => /--[a-zA-Z_][a-zA-Z0-9_\-]*/,

    // =========================================
    // Values
    // =========================================

    // A value list is one or more values (for shorthand properties)
    _value_list: $ => prec.right(repeat1($._value)),

    _value: $ => choice(
      $.number,
      $.dimension,
      $.percentage,
      $.color,
      $.string,
      $.var_function,
      $.function_call,
      $.keyword,
    ),

    // var(--custom-property) for CSS variable references
    var_function: $ => seq(
      'var',
      '(',
      $.custom_property,
      ')',
    ),

    // Numbers: 0, 123, -45, 3.14, -0.5
    number: $ => /\-?[0-9]+(\.[0-9]+)?/,

    // Dimensions: 100px, 45deg, 2em, 1.5rem, 500ms, 2s
    dimension: $ => seq(
      /\-?[0-9]+(\.[0-9]+)?/,
      $.unit,
    ),

    unit: $ => choice(
      'px',
      'deg',
      'em',
      'rem',
      's',
      'ms',
      '%',
    ),

    // Percentages: 50%, -25%, 100%
    percentage: $ => /\-?[0-9]+(\.[0-9]+)?%/,

    // Colors: #fff, #ffffff, #rrggbbaa
    color: $ => /#[0-9a-fA-F]{3,8}/,

    // Strings: "hello", 'world'
    string: $ => choice(
      seq('"', /[^"]*/, '"'),
      seq("'", /[^']*/, "'"),
    ),

    // Function calls: rgb(255, 0, 0), translate(10px, 20px)
    function_call: $ => seq(
      $.identifier,
      '(',
      optional($.arguments),
      ')',
    ),

    arguments: $ => seq(
      $._value_list,
      repeat(seq(',', $._value_list)),
    ),

    // Keywords: ease-in-out, center, none, etc.
    keyword: $ => choice(
      $.member_expression,
      $.identifier,
    ),

    // Member expressions: cursor.x, object.property
    member_expression: $ => seq(
      $.identifier,
      '.',
      $.identifier,
    ),

    // =========================================
    // @keyframes
    // =========================================

    keyframes_rule: $ => seq(
      '@keyframes',
      $.keyframes_name,
      $.keyframes_block,
    ),

    keyframes_name: $ => $.identifier,

    keyframes_block: $ => seq(
      '{',
      repeat($.keyframe),
      '}',
    ),

    keyframe: $ => seq(
      $.keyframe_selector_list,
      $.declaration_block,
    ),

    keyframe_selector_list: $ => seq(
      $._keyframe_selector,
      repeat(seq(',', $._keyframe_selector)),
    ),

    _keyframe_selector: $ => choice(
      'from',
      'to',
      $.percentage,
      $.number,
    ),

    declaration_block: $ => seq(
      '{',
      repeat($.declaration),
      '}',
    ),

    // =========================================
    // Primitives
    // =========================================

    // Identifiers: property names, function names, etc.
    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_\-]*/,

    // Comments: /* ... */
    comment: $ => seq(
      '/*',
      /[^*]*\*+([^/*][^*]*\*+)*/,
      '/',
    ),
  },
});
