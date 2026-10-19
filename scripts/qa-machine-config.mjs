const failure = () => { throw new Error('QA machine configuration is incomplete or conflicts with the selected installation.') }
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
const record = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const audience = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value)
export const qaMachineVariables = ['QA_MACHINE_ENABLED', 'QA_MACHINE_APP_ID', 'QA_MACHINE_POLICY_ID',
  'QA_MACHINE_AUD', 'QA_MACHINE_CLIENTS', 'QA_MACHINE_SERVICE_TOKEN_IDS']

// Configuration must not hide duplicate (including escaped-equivalent) keys
// behind JSON.parse's last-key-wins behavior. No input or parse error is logged.
export function parseQAJSON(source, maximum = 16384) {
  try {
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > maximum) failure()
    const parsed = JSON.parse(source)
    const tokens = source.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? []
    let index = 0
    function value(depth) {
      if (depth > 16) failure()
      const token = tokens[index++]
      if (token === '{') {
        const seen = new Set()
        if (tokens[index] !== '}') do {
          const key = JSON.parse(tokens[index++])
          if (seen.has(key) || tokens[index++] !== ':') failure()
          seen.add(key); value(depth + 1)
        } while (tokens[index] === ',' && ++index)
        if (tokens[index++] !== '}') failure()
      } else if (token === '[') {
        if (tokens[index] !== ']') do { value(depth + 1) } while (tokens[index] === ',' && ++index)
        if (tokens[index++] !== ']') failure()
      }
    }
    value(0)
    if (index !== tokens.length) failure()
    return parsed
  } catch { failure() }
}

/** Nonsecret, explicitly selected settings. Never reads process.env or a file.
 * A complete retained mapping with flag=0 allows a safe code shutdown while
 * the exact Access app remains installed; inactive credentials are not grants.
 */
export function qaMachineInstallSettings(vars) {
  try {
    if (!record(vars)) failure()
    if (Object.keys(vars).some(key => key.startsWith('QA_MACHINE_') && !qaMachineVariables.includes(key))) failure()
    const flag = vars.QA_MACHINE_ENABLED
    if (flag !== undefined && flag !== '0' && flag !== '1') failure()
    const supplied = qaMachineVariables.slice(1).some(key => Object.hasOwn(vars, key))
    if (!supplied && flag !== '1') return null
    if (flag === undefined || qaMachineVariables.some(key => typeof vars[key] !== 'string')) failure()
    if (!uuid(vars.QA_MACHINE_APP_ID) || !uuid(vars.QA_MACHINE_POLICY_ID)
      || vars.QA_MACHINE_APP_ID === vars.ACCESS_APP_ID || vars.QA_MACHINE_POLICY_ID === vars.ACCESS_POLICY_ID
      || !audience(vars.QA_MACHINE_AUD) || vars.QA_MACHINE_AUD === vars.ACCESS_AUD) failure()
    const clients = parseQAJSON(vars.QA_MACHINE_CLIENTS)
    const tokens = parseQAJSON(vars.QA_MACHINE_SERVICE_TOKEN_IDS, 4096)
    if (!Array.isArray(clients) || clients.length < 1 || clients.length > 8 || !record(tokens)) failure()
    for (const client of clients) {
      if (!record(client) || Object.keys(client).sort().join(',') !== 'accessClientID,key,surveyVersions'
        || !uuid(client.key) || !/^[a-f0-9]{32}\.access$/.test(client.accessClientID)
        || !Array.isArray(client.surveyVersions) || client.surveyVersions.length < 1 || client.surveyVersions.length > 16
        || client.surveyVersions.some(version => typeof version !== 'string' || !version.trim() || version.length > 100 || /[\x00-\x1f\x7f]/.test(version))
        || new Set(client.surveyVersions).size !== client.surveyVersions.length || !uuid(tokens[client.key])) failure()
    }
    if (Object.keys(tokens).length !== clients.length || Object.keys(tokens).some(key => !clients.some(client => client.key === key))) failure()
    for (const values of [clients.map(client => client.key), clients.map(client => client.accessClientID), Object.values(tokens)]) {
      if (new Set(values).size !== values.length) failure()
    }
    return { enabled: flag === '1', applicationID: vars.QA_MACHINE_APP_ID, policyID: vars.QA_MACHINE_POLICY_ID,
      audience: vars.QA_MACHINE_AUD, clients: clients.map(client => ({ ...client, serviceTokenID: tokens[client.key] })) }
  } catch { failure() }
}
