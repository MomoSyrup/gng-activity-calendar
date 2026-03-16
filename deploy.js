const { Client } = require('ssh2');

const SERVER = {
  host: '47.84.103.80',
  port: 22,
  username: 'root',
  password: 'Wwp721205',
};

const commands = process.argv.slice(2);
if (commands.length === 0) {
  console.error('Usage: node deploy.js "command1" "command2" ...');
  process.exit(1);
}

const conn = new Client();

function runCommand(conn, cmd) {
  return new Promise((resolve, reject) => {
    console.log(`\n>>> ${cmd}`);
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '', stderr = '';
      stream.on('data', (d) => { const s = d.toString(); stdout += s; process.stdout.write(s); });
      stream.stderr.on('data', (d) => { const s = d.toString(); stderr += s; process.stderr.write(s); });
      stream.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  });
}

async function main() {
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect(SERVER);
  });
  console.log('Connected to server.');

  for (const cmd of commands) {
    const result = await runCommand(conn, cmd);
    if (result.code !== 0 && !cmd.includes('|| true')) {
      console.error(`Command failed with code ${result.code}`);
    }
  }

  conn.end();
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
