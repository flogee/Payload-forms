// Share only the public participation path, never a response or evaluation grant.
export function participantShareURL(origin: string, homeURL: string): string | undefined {
  try {
    const base = new URL(origin)
    const target = new URL(homeURL, base)
    if (!['http:', 'https:'].includes(base.protocol) || target.origin !== base.origin
      || !/^\/f\/[a-z][a-z0-9-]{0,79}$/.test(target.pathname)) return undefined
    return new URL(target.pathname, base.origin).href
  } catch { return undefined }
}

export function participantInvitation(title: string, url: string): string {
  return `Ich habe an der Befragung „${title}“ teilgenommen. Vielleicht ist sie auch für dich oder deine Organisation interessant:\n\n${url}`
}
