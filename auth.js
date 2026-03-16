/**
 * One-time OAuth2 authorization script.
 *
 * Run this once with `node auth.js` to open a browser window where you log in
 * with your Google account. After granting access, the script prints the
 * refresh token — paste it into your .env file as GOOGLE_REFRESH_TOKEN.
 */

require('dotenv').config();

const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_PORT = 3001;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.\n' +
    'You can create them at https://console.cloud.google.com/apis/credentials'
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

console.log('\n=== Google OAuth2 Authorization ===\n');
console.log('Opening browser for authorization...\n');
console.log('If the browser does not open automatically, visit this URL:\n');
console.log(authUrl);
console.log();

const srv = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== '/oauth2callback') return;

  const code = parsed.query.code;
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Authorization failed — no code received.</h2>');
    srv.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<h2>Authorization successful!</h2>' +
      '<p>You can close this window and return to the terminal.</p>'
    );

    console.log('Authorization successful!\n');
    console.log('Add the following line to your .env file:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    srv.close();
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Token exchange failed.</h2><pre>' + err.message + '</pre>');
    console.error('Token exchange failed:', err.message);
    srv.close();
  }
});

srv.listen(REDIRECT_PORT, () => {
  // Try to open the browser automatically
  const { exec } = require('child_process');
  const cmd =
    process.platform === 'win32' ? `start "" "${authUrl}"` :
    process.platform === 'darwin' ? `open "${authUrl}"` :
    `xdg-open "${authUrl}"`;
  exec(cmd, () => {});
});
