'use strict';
// Preserve npm-distributed notices before Vite bundles the browser code.
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const sections = ['ShengJi — third-party npm package notices\nGenerated from package-lock.json.\nElectron/Chromium and model notices are distributed separately.'];
  let packages = 0;
  for (const [location, info] of Object.entries(lock.packages)) {
    if (!location.startsWith('node_modules/') || info.dev === true) continue;
    const directory = path.join(root, location);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { continue; } // Optional platform packages may not be installed.
    const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const notices = entries.filter(entry => entry.isFile() && /^(licen[sc]e|copying|notice|third[-_]?party)/i.test(entry.name));
    const lines = [`\n${'='.repeat(72)}\n${pkg.name}@${pkg.version}\nLicense: ${pkg.license || info.license || 'see upstream'}\nSource: ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || pkg.homepage || ''}`];
    for (const notice of notices) lines.push(`\n--- ${notice.name} ---\n${await fs.readFile(path.join(directory, notice.name), 'utf8')}`);
    if (!notices.length) lines.push('\nThis npm package does not ship a root license file. Refer to its source repository and the separately distributed component notices.');
    sections.push(lines.join('\n'));
    packages++;
  }
  const output = path.join(root, 'public', 'licenses');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'NPM-NOTICES.txt'), sections.join('\n'), 'utf8');
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(output, 'SHENGJI-LICENSE.txt'));
  console.log(`Preserved notices for ${packages} installed production npm packages.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
