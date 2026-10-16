export function AccessLoginHelp({ enabled }: { enabled?: boolean }) {
  if (!enabled) return null
  return <div style={{ textAlign: 'center' }}>
    <h1>Bei Payload Forms anmelden</h1>
    <p>Die Anmeldung erfolgt mit einem Einmalcode an deine freigegebene E-Mail-Adresse.</p>
    <p>Falls die Sitzung abgelaufen ist, melde dich erneut an. Ein aktiver Teamzugang ist erforderlich.</p>
    <a className="btn btn--style-primary btn--size-medium" href="/auth/restart">Anmeldung erneuern</a>
    <p>Bleibt der Zugang gesperrt, kontaktiere die Teamverwaltung.</p>
  </div>
}
