#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const execFileAsync = promisify(execFile);
const seatalkBot = require('../seatalk-bot');

async function runHtmlRender(outPath, apiUrl, webUrl) {
  const scriptPath = path.join(__dirname, 'render-calendar-image-html.js');
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [scriptPath, outPath, apiUrl, webUrl],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
      env: process.env,
      timeout: 120000,
    }
  );
  if (stderr && stderr.trim()) {
    console.warn('[render] stderr:', stderr.trim());
  }
  return stdout;
}

async function main() {
  const groupId = process.argv[2];
  if (!groupId) {
    throw new Error('Usage: node scripts/send-group-calendar-image-push.js <group_id>');
  }

  const outPath = process.env.CALENDAR_IMAGE_OUTPUT_PATH || '/opt/gng-activity-calendar/public/generated/calendar-push-latest.png';
  const apiUrl  = process.env.CALENDAR_IMAGE_API_URL    || 'http://127.0.0.1:3000/api/calendar';
  const webUrl  = String(process.env.CALENDAR_PUBLIC_URL || 'http://101.133.141.32').replace(/\/$/, '');

  await runHtmlRender(outPath, apiUrl, webUrl);

  const raw = fs.readFileSync(outPath);
  const b64 = raw.toString('base64');
  const imageResp = await seatalkBot.sendGroupImageMessageBase64(groupId, b64);
  if (!imageResp || imageResp.code !== 0) {
    throw new Error(`group image send failed: ${JSON.stringify(imageResp || {})}`);
  }

  const linkResp = await seatalkBot.sendGroupMessage(
    groupId,
    `🔗 [查看网页日历](${webUrl})`,
    true
  );
  if (!linkResp || linkResp.code !== 0) {
    throw new Error(`group link send failed: ${JSON.stringify(linkResp || {})}`);
  }

  console.log(
    JSON.stringify(
      {
        groupId,
        imageMessageId: imageResp.message_id,
        linkMessageId: linkResp.message_id,
        webUrl,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
