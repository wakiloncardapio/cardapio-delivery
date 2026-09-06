import { cpSync, mkdirSync, copyFileSync } from 'node:fs';

// Publica apenas os arquivos públicos. Migrações, funções e dados internos
// continuam fora do pacote servido pela Cloudflare Pages.
mkdirSync('_site', { recursive: true });
for (const file of ['service-worker.js', 'index.html', 'politicas.html', 'manifest.json', 'robots.txt', 'sitemap.xml']) {
  copyFileSync(file, `_site/${file}`);
}
cpSync('assets', '_site/assets', { recursive: true });
for (const directory of ['config', 'categories', 'products']) {
  cpSync(`data/${directory}`, `_site/data/${directory}`, { recursive: true });
}
for (const [directory, files] of Object.entries({
  admin: ['manifest.webmanifest', 'index.html', 'admin.css', 'admin-commerce.css', 'panel-ux.css', 'github-admin.js', 'panel-ux.js'],
  central: ['index.html', 'central.css', 'central-enhancements.css', 'central-commerce.css', 'central.js', 'central-ux.js'],
  convite: ['index.html', 'invite.js']
})) {
  mkdirSync(`_site/sistema/${directory}`, { recursive: true });
  for (const file of files) copyFileSync(`sistema/${directory}/${file}`, `_site/sistema/${directory}/${file}`);
}
