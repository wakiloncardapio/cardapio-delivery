import { cpSync, mkdirSync, copyFileSync } from 'node:fs';

// Publish the same public files as GitHub Pages. Database scripts and orders stay out.
mkdirSync('_site', { recursive: true });
for (const file of ['index.html', 'politicas.html', 'manifest.json', 'robots.txt', 'sitemap.xml']) {
  copyFileSync(file, `_site/${file}`);
}
cpSync('assets', '_site/assets', { recursive: true });
for (const directory of ['config', 'categories', 'products']) {
  cpSync(`data/${directory}`, `_site/data/${directory}`, { recursive: true });
}
for (const [directory, files] of Object.entries({
  admin: ['index.html', 'admin.css', 'github-admin.js'],
  central: ['index.html', 'central.css', 'central-enhancements.css', 'central.js'],
  convite: ['index.html', 'invite.js']
})) {
  mkdirSync(`_site/sistema/${directory}`, { recursive: true });
  for (const file of files) copyFileSync(`sistema/${directory}/${file}`, `_site/sistema/${directory}/${file}`);
}
