/**
 * TypeScript declarations for Vite's ?raw import suffix.
 *
 * This allows importing files as raw strings, which is used to load
 * the MWC wallet JS files.
 */

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*.js?raw' {
  const content: string;
  export default content;
}
