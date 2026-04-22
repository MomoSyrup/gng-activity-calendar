'use strict';

const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'gng_auth_session';

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4 || 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLength), 'base64').toString('utf8');
}

function signValue(encodedPayload, secret) {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(encodedPayload).digest());
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSignedToken(payload, secret) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload || {}));
  const signature = signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function verifySignedToken(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;

  const encodedPayload = parts[0];
  const signature = parts[1];
  const expectedSignature = signValue(encodedPayload, secret);
  if (!timingSafeEqualString(signature, expectedSignature)) return null;

  try {
    return JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return null;
  }
}

function parseCookieHeader(header) {
  const cookies = {};
  String(header || '')
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .forEach((chunk) => {
      const separator = chunk.indexOf('=');
      if (separator === -1) return;
      const key = chunk.slice(0, separator).trim();
      const value = chunk.slice(separator + 1).trim();
      cookies[key] = decodeURIComponent(value);
    });
  return cookies;
}

function serializeCookie(name, value, options) {
  const settings = options || {};
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (settings.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(settings.maxAge)}`);
  if (settings.expires instanceof Date) parts.push(`Expires=${settings.expires.toUTCString()}`);
  parts.push(`Path=${settings.path || '/'}`);
  if (settings.httpOnly !== false) parts.push('HttpOnly');
  if (settings.sameSite) parts.push(`SameSite=${settings.sameSite}`);
  if (settings.secure) parts.push('Secure');
  if (settings.domain) parts.push(`Domain=${settings.domain}`);

  return parts.join('; ');
}

function sanitizeNextPath(value) {
  const fallback = '/';
  if (!value || typeof value !== 'string') return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  return value;
}

function isExpired(payload) {
  return !payload || !payload.exp || Number(payload.exp) <= Date.now();
}

function normalizeAllowedEmailDomains(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedGoogleEmail(email, allowedDomains) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return false;
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) return true;
  const atIndex = normalizedEmail.lastIndexOf('@');
  if (atIndex === -1) return false;
  return allowedDomains.includes(normalizedEmail.slice(atIndex + 1));
}

module.exports = {
  SESSION_COOKIE_NAME,
  base64UrlDecode,
  base64UrlEncode,
  createSignedToken,
  isAllowedGoogleEmail,
  isExpired,
  normalizeAllowedEmailDomains,
  parseCookieHeader,
  sanitizeNextPath,
  serializeCookie,
  verifySignedToken,
};
