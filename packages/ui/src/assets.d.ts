// Vite `?raw` imports of non-CSS text files in tests, e.g. the style guide and the wordmark master
// (`import md from '…/STYLE_GUIDE.md?raw'`). CSS is read from disk instead: Vitest blanks CSS
// modules, even with `?raw`, unless its `test.css` option includes them.
declare module '*?raw' {
  const content: string;
  export default content;
}
