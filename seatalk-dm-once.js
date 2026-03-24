'use strict';
require('dotenv').config();
const seatalk = require('./seatalk-bot');

const code = process.argv[2];
const text =
  process.argv.slice(3).join(' ') ||
  '**GNG 活动日历**\n\n代理订阅已开启自动更新（每 30 分钟），本次为手动测试私聊。\n\n🔗 [打开日历](http://101.133.141.32)';

if (!code) {
  console.error('Usage: node seatalk-dm-once.js <employee_code> [message...]');
  process.exit(1);
}

seatalk
  .sendTextMessage(code, text, true)
  .then((r) => {
    console.log(JSON.stringify(r));
    process.exit(r.code === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
