import { realAddress } from './check-mail-config.mjs'

export function verifyImageConfig(internal) {
  if (internal?.vars?.MAIL_ENABLED !== '1' || !realAddress(internal.vars.OPS_ALERT_RECIPIENT)) {
    throw new Error('Bildspeicher benötigt den aktivierten und konfigurierten Kontingent-Warnversand.')
  }
  const bucket = internal?.r2_buckets?.[0]
  if (internal?.r2_buckets?.length !== 1 || bucket?.binding !== 'MEDIA' ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket.bucket_name || '') || bucket.jurisdiction !== 'eu' || bucket.remote !== true) {
    throw new Error('Formularbilder benötigen genau einen eigenen privaten EU-Bucket als MEDIA-Bindung.')
  }
}
