import { APIError, type CollectionConfig, type Field, type PayloadRequest } from 'payload'
import { fromStored } from '../survey/storage'
import { validSurveySlug } from '../survey/sharing'
import { staff } from './Users'
import { privacyFields } from './privacy-fields'
import { readPrivacySettings, privacyMissing } from '../survey/privacy'
import { readNotificationSettings } from '../survey/notifications'
import { canonicalJSON } from '../survey/privacy-crypto'
import { introContentField, sectionContentField } from './content-fields'
import { readBranding, surveyImageIDs } from '../survey/branding'
import { answerFormats } from '../components/SurveyEditor.helpers'
import { livePrivacyReady, realSurveysEnabled } from '../survey/participation'
import { managesTeam } from '../auth/team'
import { rememberSurveyArrays } from '../survey/persist-update'
// MCP impersonates its owning team account; operational addresses stay private.
const notificationAccess = ({ req }: { req: PayloadRequest }) => staff({ req }) &&
  !(req.user && '_strategy' in req.user && req.user._strategy === 'mcp-api-key')
const questionFields: Field[] = [
  { type: 'row', fields: [{ name: 'code', label: 'Stabile Fragekennung', type: 'text', required: true }, { name: 'block', label: 'Frageblock', type: 'text', required: true }] },
  { name: 'label', label: 'Fragetext', type: 'textarea', required: true },
  { name: 'kind', label: 'Antwortformat', type: 'select', required: true, options: Object.entries(answerFormats).map(([value, format]) => ({ value, label: format.label })), admin: { components: { Description: '/components/SurveyEditorGuide#SurveyEditorFormatDescription' } } },
  { name: 'help', label: 'Erläuterung', type: 'textarea' },
  { name: 'optional', label: 'Im Entwurf ausdrücklich optional', type: 'checkbox' },
  { name: 'options', label: 'Antwortoptionen', labels: { singular: 'Antwortoption', plural: 'Antwortoptionen' }, type: 'array', fields: [{ name: 'value', label: 'Stabiler Wert', type: 'text', required: true }, { name: 'label', label: 'Beschriftung', type: 'text', required: true }, { name: 'exclusive', label: 'Schließt andere Auswahl aus', type: 'checkbox' }], admin: { initCollapsed: true, components: { RowLabel: '/components/SurveyEditorRowLabels#SurveyEditorOptionLabel' }, condition: (_, q) => ['single', 'multiple', 'matrix', 'ranking'].includes(q.kind) } },
  { name: 'rows', label: 'Bewertungs- oder Zahlenzeilen', labels: { singular: 'Zeile', plural: 'Zeilen' }, type: 'array', fields: [{ name: 'key', label: 'Stabile Zeilenkennung', type: 'text', required: true }, { name: 'label', label: 'Beschriftung', type: 'text', required: true }], admin: { initCollapsed: true, components: { RowLabel: '/components/SurveyEditorRowLabels#SurveyEditorAnswerRowLabel' }, condition: (_, q) => ['matrix', 'counts'].includes(q.kind) } },
  { name: 'allowNA', label: '„Nicht zutreffend“ für Zahlen zulassen', type: 'checkbox', admin: { condition: (_, q) => ['count', 'counts'].includes(q.kind) } },
  { type: 'row', admin: { condition: (_, q) => ['count', 'counts', 'slider'].includes(q.kind) }, fields: [{ name: 'min', label: 'Kleinste Zahl (Slider: Standard 0)', type: 'number', min: 0 }, { name: 'max', label: 'Größte Zahl (Slider: Standard 10)', type: 'number', min: 0 }] },
  { name: 'step', label: 'Slider-Schrittweite (Standard 1)', type: 'number', min: 1, max: 100, admin: { condition: (_, q) => q.kind === 'slider', description: 'Ganze Schritte; der Zahlenbereich muss gleichmäßig teilbar sein. Beispiel: 0–100 mit Schrittweite 10.' } },
  { type: 'row', admin: { condition: (_, q) => ['slider', 'stars', 'smiley'].includes(q.kind) }, fields: [{ name: 'lowLabel', label: 'Beschriftung am unteren Ende', type: 'text', maxLength: 200 }, { name: 'highLabel', label: 'Beschriftung am oberen Ende', type: 'text', maxLength: 200 }] },
  { name: 'showIf', label: 'Sprungregel (optional)', type: 'json', admin: { description: 'Für Agenten: {"field":"F19_dates","values":["1","2"]}. Nur vorherige Einfachauswahl als Bedingung zulässig.' } }
]
export const Surveys: CollectionConfig = {
  slug: 'surveys', labels: { singular: 'Fragebogen', plural: 'Fragebögen' }, admin: {
    useAsTitle: 'title', defaultColumns: ['title', 'version', 'phase'],
    // List rows need only their visible columns; edit views still load the full instrument.
    enableListViewSelectAPI: true,
  }, disableDuplicate: true,
  access: { read: ({ req }) => staff({ req }) ? req.user && '_strategy' in req.user && req.user._strategy === 'mcp-api-key' ? { phase: { in: ['draft', 'pretest'] } } : true : false, create: staff, update: staff, delete: () => false },
  hooks: { beforeChange: [async ({ data, originalDoc, operation, req }) => {
    if (operation === 'update' && originalDoc?.phase !== 'draft') {
      const instrument = ['title', 'slug', 'version', 'introduction', 'introContent', 'sections', 'privacy']
      if (instrument.some(k => data[k] !== undefined && canonicalJSON(data[k]) !== canonicalJSON(originalDoc[k]))) throw new APIError('Diese Erhebungsfassung ist eingefroren. Für Änderungen bitte einen neuen Entwurf mit neuer Versionskennung anlegen.', 400)
      if (data.phase && ![originalDoc.phase, 'closed'].includes(data.phase)) throw new APIError('Eine gestartete Fassung kann nur geschlossen werden.', 400)
    }
    const merged = { ...originalDoc, ...data }
    if (data.notifications !== undefined) try {
      if (data.notifications != null && (typeof data.notifications !== 'object' || Array.isArray(data.notifications))) throw new Error('Benachrichtigungseinstellungen prüfen.')
      const settings = readNotificationSettings({ ...originalDoc?.notifications, ...data.notifications })
      data.notifications = { enabled: settings.enabled, recipients: settings.recipients.join('\n') }
    } catch (error) { throw new APIError(error instanceof Error ? error.message : 'Benachrichtigungseinstellungen prüfen.', 400) }
    let definition
    try { definition = fromStored(merged) } catch (error) { throw new APIError(error instanceof Error ? error.message : 'Ungültige Fragebogenfassung.', 400) }
    let branding
    try {
      if (data.branding != null && (typeof data.branding !== 'object' || Array.isArray(data.branding))) throw new Error('Ungültige Kopfzeile')
      branding = readBranding(data.branding === null ? null : data.branding !== undefined ? { ...originalDoc?.branding, ...data.branding } : originalDoc?.branding)
      if (data.branding !== undefined) data.branding = { text: null, logo: null, ...branding }
    } catch { throw new APIError('Bitte für die Kopfzeile einen Namen (höchstens 100 Zeichen) und bei „Logo“ ein vorhandenes Bild auswählen.', 400) }
    const images = surveyImageIDs(definition, branding)
    if (images.length) {
      const found = await req.payload.find({ collection: 'media', where: { id: { in: images } }, limit: 256, depth: 0, overrideAccess: true, req })
      if (found.docs.length !== images.length) throw new APIError('Bitte für Bildblöcke und Kopfzeilen-Logo vorhandene Bilder auswählen.', 400)
    }
    let privacy: ReturnType<typeof readPrivacySettings>
    try { privacy = readPrivacySettings(merged.privacy) }
    catch { throw new APIError('Bitte die Datenschutzeinstellungen prüfen. Die Frist muss eine ganze Zahl zwischen 0 und 20 Kalenderjahren sein.', 400) }
    if (data.retentionReminders != null && (typeof data.retentionReminders !== 'object' || Array.isArray(data.retentionReminders)
      || (data.retentionReminders.enabled != null && typeof data.retentionReminders.enabled !== 'boolean'))) throw new APIError('Bitte die Fristerinnerungseinstellungen prüfen.', 400)
    const retentionReminders = { ...originalDoc?.retentionReminders, ...data.retentionReminders }
    if (retentionReminders.enabled && (!privacy.enabled || !privacy.retentionYears)) throw new APIError('Für Fristerinnerungen zuerst Datenschutzinformation und eine Frist in ganzen Kalenderjahren vorbereiten.', 400)
    if (privacy.reviewed && privacyMissing(privacy).length) throw new APIError('Vor der fachlichen Bestätigung alle Datenschutzangaben ergänzen.', 400)
    if (merged.phase === 'pretest' && privacy.enabled && privacyMissing(privacy).length) throw new APIError('Vor dem Pretest mit Datenschutzinformation alle fehlenden Angaben ergänzen.', 400)
    if (merged.phase === 'live' && (operation === 'create' || originalDoc?.phase !== 'live')) {
      if (!managesTeam(req.user)) throw new APIError('Nur Administratoren können echte Erhebungen freigeben.', 403)
      if (!realSurveysEnabled()) throw new APIError('Echte Erhebungen sind durch den Betreiber nicht freigegeben.', 400)
      if (!livePrivacyReady(merged.privacy)) throw new APIError('Vor der echten Erhebung vollständige Datenschutzangaben fachlich prüfen und bestätigen.', 400)
    }
    // Freeze the same normalized profile used by the participant receipt and
    // atomic SQL guard; textarea whitespace must not make a reviewed form unusable.
    if ((operation === 'create' || originalDoc?.phase === 'draft') && (data.privacy !== undefined || merged.phase === 'live')) data.privacy = privacy
    if (operation === 'update' && originalDoc?.id != null) rememberSurveyArrays(req, originalDoc.id, originalDoc)
    return data
  }] },
  fields: [
    { name: 'title', label: 'Titel', type: 'text', required: true },
    { type: 'row', fields: [
        { name: 'version', label: 'Erhebungsfassung', type: 'text', required: true, unique: true },
        { name: 'phase', label: 'Status', type: 'select', required: true, defaultValue: 'draft', options: [{ label: 'Entwurf', value: 'draft' }, { label: 'Pretest mit Testdaten', value: 'pretest' }, { label: 'Echte Erhebung (Betreiberfreigabe erforderlich)', value: 'live' }, { label: 'Geschlossen', value: 'closed' }] },
    ] },
    // Keep tabs unnamed: names would nest stored fields and change the schema.
    { type: 'tabs', tabs: [
      { label: 'Fragen und Inhalte', fields: [
        { name: 'editorGuide', type: 'ui', admin: { components: { Field: '/components/SurveyEditorGuide#SurveyEditorGuide' } } },
        { name: 'introduction', label: 'Einleitung', type: 'array', labels: { singular: 'Absatz', plural: 'Absätze' }, admin: { initCollapsed: true, className: 'survey-editor__outline', components: { RowLabel: '/components/SurveyEditorRowLabels#SurveyEditorIntroductionLabel' } }, fields: [{ name: 'text', label: 'Absatz', type: 'textarea', required: true }] },
        introContentField,
        { name: 'sections', label: 'Abschnitte', labels: { singular: 'Abschnitt', plural: 'Abschnitte' }, type: 'array', admin: { initCollapsed: true, className: 'survey-editor__outline', components: { RowLabel: '/components/SurveyEditorRowLabels#SurveyEditorSectionLabel' } }, required: true, fields: [{ name: 'key', label: 'Abschnittkennung', type: 'text', required: true }, { name: 'title', label: 'Titel', type: 'text', required: true }, { name: 'description', label: 'Hinweis', type: 'textarea' }, { name: 'questions', label: 'Fragen', labels: { singular: 'Frage', plural: 'Fragen' }, type: 'array', admin: { initCollapsed: true, components: { RowLabel: '/components/SurveyEditorRowLabels#SurveyEditorQuestionLabel' } }, fields: questionFields, required: true }, sectionContentField] },
      ] },
      { label: 'Datenschutz', fields: [
        { name: 'privacyStatus', label: 'Stand der Datenschutzangaben', type: 'ui', admin: { components: { Field: '/components/SurveyPrivacyStatus#SurveyPrivacyStatus' } } },
        { name: 'privacy', label: 'Datenschutz und Teilnahme', type: 'group', fields: privacyFields },
      ] },
      { label: 'Veröffentlichen', description: 'Teilnahmelink, Vorschau und Downloads verwenden den gespeicherten Stand. Den Status oberhalb der Reiter ändern.', fields: [
        { name: 'branding', label: 'Kopfzeile', type: 'group', admin: { description: 'Ersetzt die Marke oben links im Teilnahmeformular. Auch nach Beginn der Fassung änderbar; Fragen und Datenschutz bleiben eingefroren.' }, fields: [
          { name: 'mode', label: 'Anzeige oben links', type: 'select', defaultValue: 'default', options: [
            { value: 'default', label: 'Standard (Payload Forms / Sample)' }, { value: 'text', label: 'Eigener Text' }, { value: 'logo', label: 'Logo' },
          ] },
          { name: 'text', label: 'Name in der Kopfzeile', type: 'text', maxLength: 100, admin: { condition: (_, group) => ['text', 'logo'].includes(group.mode), description: 'Bei einem Logo dient dieser Name als Alternativtext und Ersatz, falls das Bild nicht geladen werden kann.' } },
          { name: 'logo', label: 'Logo hochladen oder auswählen', type: 'upload', relationTo: 'media', admin: { condition: (_, group) => group.mode === 'logo', description: 'PNG, JPG oder WebP, höchstens 2 MiB. Transparente PNG- oder WebP-Dateien eignen sich besonders gut.' } },
        ] },
        { name: 'slug', label: 'Linkkennung', type: 'text', required: true, unique: true, validate: (value: unknown) => validSurveySlug(value) || 'Bitte mit einem Kleinbuchstaben beginnen und nur Kleinbuchstaben, Ziffern und Bindestriche verwenden (höchstens 80 Zeichen).', admin: { description: 'Bestimmt die Teilnahmelink-Adresse, z. B. seminarfeedback-2026. Nach Freigabe bleibt sie unveränderlich.' } },
        { name: 'participationSharing', label: 'Teilnahmelink und QR-Code', type: 'ui', admin: { components: { Field: '/components/SurveySharing#SurveySharing' } } },
        { name: 'surveyTools', label: 'Downloads und neuer Entwurf', type: 'ui', admin: { components: { Field: '/components/SurveyTools#SurveyTools' } } },
      ] },
      { label: 'E-Mail und Fristen', description: 'Betriebliche Einstellungen bleiben auch nach dem Start der Fassung änderbar.', fields: [
        { name: 'notifications', label: 'E-Mail bei neuen Einsendungen', type: 'group', access: { read: notificationAccess, create: notificationAccess, update: notificationAccess }, fields: [
          { name: 'enabled', label: 'Eingangshinweise per E-Mail senden', type: 'checkbox', defaultValue: false },
          { name: 'recipients', label: 'Empfängeradressen', type: 'textarea', admin: { description: 'Eine E-Mail-Adresse je Zeile, höchstens zehn. Adressen müssen zuvor bei Cloudflare bestätigt und für diesen Versand registriert werden. Auch nach Beginn der Fassung änderbar.' } },
        ] },
        { name: 'notificationStatus', label: 'Versandstatus', type: 'ui', admin: { components: { Field: '/components/SurveyNotificationStatus#SurveyNotificationStatus' } } },
        { name: 'retentionReminders', label: 'Erinnerungen zur Aufbewahrungsfrist', type: 'group', access: { read: notificationAccess, create: notificationAccess, update: notificationAccess }, fields: [
          { name: 'enabled', label: 'Wöchentliche Fristerinnerungen an den Betriebskontakt senden', type: 'checkbox', defaultValue: false,
            admin: { description: 'Ein zusammengefasster Hinweis pro Formular und UTC-Woche für gespeicherte Fristen innerhalb von 90 Tagen, innerhalb von 30 Tagen und abgelaufene Fristen. Auch nach Beginn der Fassung abschaltbar. Keine automatische Bereinigung.' } },
        ] },
        { name: 'retentionStatus', label: 'Fristprüfung und Erinnerungsstatus', type: 'ui', admin: { components: { Field: '/components/SurveyRetentionStatus#SurveyRetentionStatus' } } },
      ] },
    ] },
  ]
}
