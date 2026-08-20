/// <reference types="vite/client" />
/// <reference types="electron-vite/node" />

declare module '*.html?asset' {
  const src: string
  export default src
}

declare module '*.png?asset' {
  const src: string
  export default src
}
