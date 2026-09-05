# Seu Food — cardápio multiempresa

Base de demonstração para operar vários cardápios independentes com um único código. Cada empresa possui seu próprio catálogo, pedidos, configurações, pessoas autorizadas, páginas e domínios. A loja atual permanece como demonstração e não existe cobrança, vencimento ou limite automático nesta fase.

A fundação multiempresa está publicada no código. A ativação no banco só acontece depois da execução manual da migração 004, preservando o ambiente atual até essa etapa.

## Endereços da plataforma

- Cardápio de demonstração: `/` ou `/?loja=demonstracao`
- Painel de uma empresa: `/sistema/admin/?loja=slug-da-empresa`
- Administração central: `/sistema/central/`
- Convites: `/sistema/convite/`

Quando o domínio principal for conectado, o resolvedor já aceita `seufood.com/empresa`, `empresa.seufood.com` e domínios personalizados ativos. No GitHub Pages, as empresas usam temporariamente `?loja=empresa`.

## Antes de publicar

1. Crie um projeto novo no Supabase.
2. Execute `database/supabase.sql` no SQL Editor.
3. Em uma instalação já existente, execute `database/migrations/004_multi_tenant.sql` e depois `database/migrations/005_commerce_intelligence.sql`, após as migrações 002 e 003.
4. Crie o usuário administrador em **Authentication > Users** e desative cadastros públicos. A migração transforma o usuário mais antigo no administrador central.
5. Preencha `assets/js/supabase-config.js` somente com a URL e a chave pública/publicável do novo projeto.
6. Configure `assets/js/r2-config.js` com a URL do Worker protegido que envia imagens ao Cloudflare R2.
7. Publique as funções pelo workflow **Ativar base multiempresa**.
8. Edite a demonstração pelo painel e crie as demais empresas na Central Seu Food.

Nunca coloque a chave `service_role`, token do Mercado Pago, token da Meta ou senha no código público. A migração 005 usa o Vault do Supabase para criptografar as credenciais de pagamento individuais de cada empresa.

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

O código pode continuar gratuitamente no GitHub Pages durante a demonstração. Para usar caminhos, subdomínios e domínios próprios em produção, a mesma base pode ser publicada em Cloudflare Workers/Pages. GitHub guarda o código; Supabase separa dados e acessos; Cloudflare R2 guarda as imagens.
