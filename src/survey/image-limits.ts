// Shared by the Next application and scheduled Worker; keep this module free
// of framework imports so the cron handler does not bundle the Payload server.
export const IMAGE_LIMITS = Object.freeze({ fileBytes: 2 * 1024 * 1024, storageBytes: 128 * 1024 * 1024, objects: 256, monthlyWrites: 256, monthlyReads: 100000 })
export const IMAGE_PREFIX = 'forms-images'
