/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public address of the API when it is on another host than the page (build time; not a secret). Unset = same origin. */
  readonly VITE_API_ORIGIN?: string;
}
