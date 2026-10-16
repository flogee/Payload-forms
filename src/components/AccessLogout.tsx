import { Logout } from '@payloadcms/ui'
import type { User } from '../payload-types'
export function AccessLogout({ user }: { user?: User & { _strategy?: string } }) {
  return user?._strategy === 'cloudflare-access'
    ? <a className="nav__log-out" href="/cdn-cgi/access/logout" aria-label="Abmelden">Abmelden</a>
    : <Logout />
}
