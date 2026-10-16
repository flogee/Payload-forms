import { APIError, type CollectionConfig, type PayloadRequest } from 'payload'
import { accessSettings, accessStrategy, type AccessEnvironment } from '../auth/access'
import { isTeamUser, managesTeam, normalizeTeamEmail } from '../auth/team'
export const staff = ({ req }: { req: PayloadRequest }): boolean => isTeamUser(req.user)
const manager = ({ req }: { req: PayloadRequest }) => managesTeam(req.user)
export function configureUsers(env: AccessEnvironment): CollectionConfig {
  const access = accessSettings(env)
  return {
    slug: 'users', labels: { singular: 'Teamzugang', plural: 'Teamzugänge' },
    auth: access ? { disableLocalStrategy: { enableFields: true }, strategies: [accessStrategy(env)] } : true,
    admin: { useAsTitle: 'email', defaultColumns: ['name', 'email', 'role', 'enabled'],
      description: 'Aktive Teamkonten werden automatisch für die Anmeldung freigegeben. Neue Freigaben können bis zu fünf Minuten dauern. Sperren gelten im Backend sofort.' },
    access: { create: manager, read: ({ req }) => manager({ req }) ? true : staff({ req }) ? { id: { equals: req.user!.id } } : false,
      update: manager, delete: () => false, admin: staff },
    endpoints: access ? [{ path: '/refresh-token', method: 'post', handler: async req => isTeamUser(req.user)
      ? Response.json({ user: req.user }, { headers: { 'Cache-Control': 'no-store' } })
      : Response.json({ user: null }, { status: 401, headers: { 'Cache-Control': 'no-store' } }) }] : [],
    hooks: {
      me: [({ user }) => access ? { user, exp: undefined } : undefined],
      beforeValidate: [async ({ data, operation, req }) => {
        if (data?.email != null) {
          const email = normalizeTeamEmail(data.email)
          if (!email) throw new APIError('Bitte eine gültige E-Mail-Adresse verwenden.', 400)
          data.email = email
        }
        if (operation === 'create') {
          const count = await req.payload.count({ collection: 'users', overrideAccess: true, req })
          if (count.totalDocs >= 40) throw new APIError('Maximal 40 Teamkonten sind für diese Installation vorgesehen.', 409)
          if (count.totalDocs === 0) data.role = 'admin'
        }
        return data
      }],
      beforeChange: [({ data, originalDoc, operation, req }) => {
        if (operation === 'update' && String(originalDoc.id) === String(req.user?.id)
          && ((Object.hasOwn(data, 'enabled') && data.enabled !== true) || (data.role != null && data.role !== 'admin') || (data.email && data.email !== originalDoc.email))) {
          throw new APIError('Den eigenen Verwaltungszugang nicht sperren, umbenennen oder herabstufen. Dafür einen zweiten Administrator verwenden.', 409)
        }
        return data
      }],
      beforeLogin: [({ user }) => { if (user.enabled !== true) throw new APIError('Teamzugang gesperrt.', 403); return user }],
    },
    fields: [
      { name: 'teamAccessStatus', type: 'ui', admin: { components: { Field: '/components/TeamAccessStatus#TeamAccessStatus' } } },
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'role', label: 'Berechtigung', type: 'select', required: true, defaultValue: 'editor',
        options: [{ value: 'editor', label: 'Formulare und Einsendungen bearbeiten' }, { value: 'admin', label: 'Administration einschließlich Teamzugängen' }] },
      { name: 'enabled', label: 'Zugang aktiv', type: 'checkbox', required: true, defaultValue: true,
        admin: { description: 'Ausschalten sperrt den Backend-Zugang sofort. Der Access-Abgleich entfernt die E-Mail anschließend aus der Freigabeliste.' } },
    ],
  }
}
