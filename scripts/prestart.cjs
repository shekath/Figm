// Runs before `npm start`: checks Node, dependencies and build output, and builds what is missing.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const root = path.join(__dirname, '..');
const fail = (msg) => { console.error(`\n[figmy] ${msg}\n`); process.exit(1); };

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) fail(`Node.js ${process.versions.node} is too old. Install Node.js 20 or newer from https://nodejs.org and try again.`);
if (!fs.existsSync(path.join(root, 'node_modules'))) fail('Dependencies are not installed. Run:  npm install');
const run = (cmd) => { console.log(`[figmy] ${cmd}`); execSync(cmd, { cwd: root, stdio: 'inherit' }); };
try {
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) run('npx vite build');
  if (!fs.existsSync(path.join(root, 'server-dist', 'server.cjs'))) run('npm run build:server');
} catch {
  fail('Building Figmy failed (see the error above). Try:  npm install   then   npm run build');
}
