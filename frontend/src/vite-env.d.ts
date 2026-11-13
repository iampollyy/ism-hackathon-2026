/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The HTTPS address phones can reach, for QR codes in local development. */
  readonly VITE_PUBLIC_URL?: string;
}
