import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const P = {
  bg: '#0c0f14',
  text: '#dce3ec',
  kw: '#f28fad',
  type: '#7cc7ff',
  str: '#b5e88a',
  num: '#ffb86b',
  fn: '#f5d76e',
  pre: '#b49cff',
  com: '#7a8699',
  punct: '#93a4b8',
  accent: '#c8f031',
};

const view = EditorView.theme(
  {
    '&': {
      height: '100%',
      color: P.text,
      backgroundColor: P.bg,
      fontSize: '13.5px',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      fontVariantLigatures: 'none',
      lineHeight: '22px',
      padding: '10px 0',
    },
    '.cm-content': { caretColor: P.accent },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: P.accent, borderLeftWidth: '2px' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(200, 240, 49, 0.18) !important',
    },
    '.cm-activeLine': { backgroundColor: '#121721' },
    '.cm-gutters': {
      backgroundColor: P.bg,
      color: '#4a5261',
      border: 'none',
      paddingLeft: '8px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c4cad4' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 14px 0 6px', minWidth: '36px' },
    '.cm-foldGutter .cm-gutterElement': { color: '#3a4250' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(200, 240, 49, 0.12)',
      outline: '1px solid rgba(200, 240, 49, 0.4)',
      color: 'inherit',
    },
    '.cm-selectionMatch': { backgroundColor: 'rgba(124, 199, 255, 0.12)' },
    '.cm-tooltip': {
      backgroundColor: '#11141a',
      border: '1px solid #262c36',
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: '0 16px 40px -12px rgba(0,0,0,.7)',
    },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '12.5px' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px !important' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#1e2416', color: P.accent },
    '.cm-panels': { backgroundColor: '#0d1015', color: P.text, borderColor: '#1a1f27' },
    '.cm-panel input, .cm-panel button': { fontFamily: 'var(--font-body)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(251, 191, 36, 0.2)' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.self, t.modifier], color: P.kw },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: P.type },
  { tag: [t.string, t.character, t.special(t.string), t.regexp], color: P.str },
  { tag: [t.number, t.bool, t.null, t.atom], color: P.num },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: P.fn },
  { tag: [t.processingInstruction, t.meta, t.macroName], color: P.pre },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: P.com, fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: P.punct },
  { tag: [t.variableName, t.propertyName, t.labelName], color: P.text },
  { tag: [t.definition(t.variableName)], color: '#e8eaed' },
  { tag: t.invalid, color: '#f87171' },
]);

export const codeplusTheme: Extension = [view, syntaxHighlighting(highlight)];
