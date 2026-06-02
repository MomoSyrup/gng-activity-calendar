'use strict';

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function readString(source, name, options) {
  const settings = options || {};
  const raw = source[name];
  if (!hasValue(raw)) {
    if (settings.required) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return settings.defaultValue === undefined ? '' : settings.defaultValue;
  }
  return String(raw).trim();
}

function readInteger(source, name, options) {
  const settings = options || {};
  const raw = source[name];
  if (!hasValue(raw)) {
    if (settings.required) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return settings.defaultValue;
  }

  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  if (settings.min !== undefined && parsed < settings.min) {
    throw new Error(`Environment variable ${name} must be >= ${settings.min}`);
  }
  if (settings.max !== undefined && parsed > settings.max) {
    throw new Error(`Environment variable ${name} must be <= ${settings.max}`);
  }
  return parsed;
}

function readBoolean(source, name, options) {
  const settings = options || {};
  const raw = source[name];
  if (!hasValue(raw)) {
    if (settings.required) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return settings.defaultValue === undefined ? false : settings.defaultValue;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Environment variable ${name} must be a boolean`);
}

function validateCompleteFeature(source, featureName, variables, errors) {
  const present = variables.filter((name) => hasValue(source[name]));
  if (present.length > 0 && present.length !== variables.length) {
    errors.push(
      `${featureName} requires ${variables.join(', ')} to be configured together`
    );
  }
}

function validateEnv(source) {
  const errors = [];
  const warnings = [];

  let env;
  try {
    env = {
      NODE_ENV: readString(source, 'NODE_ENV', { defaultValue: 'development' }),
      PORT: readInteger(source, 'PORT', { defaultValue: 3000, min: 1, max: 65535 }),
      POLL_INTERVAL: readInteger(source, 'POLL_INTERVAL', { defaultValue: 30000, min: 30000 }),
      GOOGLE_CLIENT_ID: readString(source, 'GOOGLE_CLIENT_ID', { required: true }),
      GOOGLE_CLIENT_SECRET: readString(source, 'GOOGLE_CLIENT_SECRET', { required: true }),
      GOOGLE_REFRESH_TOKEN: readString(source, 'GOOGLE_REFRESH_TOKEN', { required: true }),
      GOOGLE_SHEET_ID: readString(source, 'GOOGLE_SHEET_ID'),
      GOOGLE_SHEET_ID_2: readString(source, 'GOOGLE_SHEET_ID_2'),
      EVENT_EXCEL_PATH: readString(source, 'EVENT_EXCEL_PATH'),
      GOOGLE_API_PROXY: readString(source, 'GOOGLE_API_PROXY'),
      GOOGLE_API_PROXY_KEY: readString(source, 'GOOGLE_API_PROXY_KEY'),
      CALENDAR_PUBLIC_URL: readString(source, 'CALENDAR_PUBLIC_URL'),
      HTTPS_PROXY: readString(source, 'HTTPS_PROXY') || readString(source, 'https_proxy'),
      HTTP_PROXY: readString(source, 'HTTP_PROXY') || readString(source, 'http_proxy'),
      SEATALK_APP_ID: readString(source, 'SEATALK_APP_ID'),
      SEATALK_APP_SECRET: readString(source, 'SEATALK_APP_SECRET'),
      SEATALK_SIGNING_SECRET: readString(source, 'SEATALK_SIGNING_SECRET'),
      SEATALK_GROUP_ID: readString(source, 'SEATALK_GROUP_ID'),
      PUSH_HOLIDAYS: readString(source, 'PUSH_HOLIDAYS'),
      PUSH_MAKEUP_WORKDAYS: readString(source, 'PUSH_MAKEUP_WORKDAYS'),
      ALPHA_KNOWLEDGE_API_KEY: readString(source, 'ALPHA_KNOWLEDGE_API_KEY'),
      ALPHA_KNOWLEDGE_EXPERT_ID: readString(source, 'ALPHA_KNOWLEDGE_EXPERT_ID', { defaultValue: '7420' }),
      ALPHA_KNOWLEDGE_CITATION_URL: readString(source, 'ALPHA_KNOWLEDGE_CITATION_URL'),
      PUPPETEER_EXECUTABLE_PATH: readString(source, 'PUPPETEER_EXECUTABLE_PATH'),
      GOOGLE_LOGIN_ENABLED: readBoolean(source, 'GOOGLE_LOGIN_ENABLED', { defaultValue: false }),
      GOOGLE_LOGIN_CLIENT_ID: readString(source, 'GOOGLE_LOGIN_CLIENT_ID', {
        defaultValue: hasValue(source.GOOGLE_CLIENT_ID) ? String(source.GOOGLE_CLIENT_ID).trim() : '',
      }),
      GOOGLE_LOGIN_ALLOWED_EMAIL_DOMAINS: readString(source, 'GOOGLE_LOGIN_ALLOWED_EMAIL_DOMAINS', {
        defaultValue: 'garena.com,garena-external.com',
      }),
      APP_OWNER_EMAILS: readString(source, 'APP_OWNER_EMAILS'),
      APP_SESSION_TTL_HOURS: readInteger(source, 'APP_SESSION_TTL_HOURS', { defaultValue: 24, min: 1, max: 24 * 30 }),
      APP_SESSION_SECRET: readString(source, 'APP_SESSION_SECRET'),
    };
  } catch (error) {
    errors.push(error.message);
  }

  validateCompleteFeature(
    source,
    'SeaTalk bot integration',
    ['SEATALK_APP_ID', 'SEATALK_APP_SECRET', 'SEATALK_SIGNING_SECRET'],
    errors
  );

  if (hasValue(source.SEATALK_GROUP_ID) && !hasValue(source.SEATALK_SIGNING_SECRET)) {
    warnings.push('SEATALK_GROUP_ID is set but SEATALK_SIGNING_SECRET is missing; internal push endpoints will reject requests.');
  }

  if (env && env.GOOGLE_SHEET_ID === 'your_google_sheet_id_here') {
    errors.push('GOOGLE_SHEET_ID is still using the placeholder value from .env.example');
  }

  if (hasValue(source.GOOGLE_API_PROXY) && !hasValue(source.GOOGLE_API_PROXY_KEY)) {
    warnings.push('GOOGLE_API_PROXY is set without GOOGLE_API_PROXY_KEY; proxied Google API requests may be rejected.');
  }

  if (
    (hasValue(source.ALPHA_KNOWLEDGE_EXPERT_ID) || hasValue(source.ALPHA_KNOWLEDGE_CITATION_URL)) &&
    !hasValue(source.ALPHA_KNOWLEDGE_API_KEY)
  ) {
    warnings.push('Alpha Knowledge metadata is configured without ALPHA_KNOWLEDGE_API_KEY; sync is currently disabled.');
  }

  if (env && env.GOOGLE_LOGIN_ENABLED) {
    validateCompleteFeature(
      source,
      'Google login',
      [
        'GOOGLE_LOGIN_CLIENT_ID',
        'APP_SESSION_SECRET',
      ],
      errors
    );
  }

  if (errors.length > 0) {
    const err = new Error(errors.join('\n'));
    err.validationErrors = errors;
    throw err;
  }

  return { env, warnings };
}

let cachedValidation = null;

function getValidatedEnv() {
  if (!cachedValidation) {
    cachedValidation = validateEnv(process.env);
  }
  return cachedValidation;
}

module.exports = {
  get env() {
    return getValidatedEnv().env;
  },
  get envWarnings() {
    return getValidatedEnv().warnings;
  },
  validateEnv,
};
