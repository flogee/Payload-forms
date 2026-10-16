export {}

declare global {
  interface CloudflareEnv {
    // Encrypted Worker secret; its value never belongs in versioned vars.
    ACCESS_SYNC_TOKEN?: string
  }
}
