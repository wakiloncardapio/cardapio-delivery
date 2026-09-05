# Cardápio Delivery — versão independente

Modelo derivado do cardápio original, mantendo layout, cores e funcionalidades. Esta cópia não contém nome, domínio, telefone, e-mail, IDs de rastreamento ou conexão com o Supabase do estabelecimento original.

## Antes de publicar

1. Crie um projeto novo no Supabase.
2. Execute `database/supabase.sql` no SQL Editor.
3. Crie o usuário administrador em **Authentication > Users** e desative cadastros públicos.
4. Preencha `assets/js/supabase-config.js` somente com a URL e a chave pública/publicável do novo projeto.
5. Edite os dados iniciais de `data/config/store.json` ou faça isso pelo painel.
6. Revise `politicas.html`, `robots.txt` e `sitemap.xml` para o domínio do novo estabelecimento.

Nunca coloque a chave `service_role`, token do Mercado Pago, token da Meta ou senha no código público.

## Integrações opcionais

Todas começam desconectadas. Configure apenas as que o novo estabelecimento usar:

- Mercado Pago;
- GA4 e Google Tag Manager;
- Meta Pixel e Conversions API;
- WhatsApp Cloud API;
- Make + Mailgun para e-mails;
- redirecionamento após o pedido.

As instruções estão em `INTEGRACOES.md`. Os workflows esperam Secrets próprios do novo repositório, inclusive `SUPABASE_PROJECT_ID` e `SITE_URL`.

## Publicação

O código pode ser publicado pelo GitHub Actions ou conectado ao Cloudflare Pages. O GitHub continua sendo o local do código, sem compartilhar banco ou credenciais com o estabelecimento original.
