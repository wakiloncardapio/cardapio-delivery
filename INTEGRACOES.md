# Integrações protegidas — Seu Delivery

O GitHub Pages publica somente a interface. Tokens da Meta e de gateways **nunca** devem ser colocados em HTML, JavaScript público ou no painel. As funções deste projeto usam Supabase Edge Functions para manter as credenciais protegidas.

## Armazenamento de imagens no Cloudflare R2

O painel envia imagens otimizadas ao Worker configurado em `assets/js/r2-config.js`. O Worker valida a sessão do administrador no Supabase, grava o arquivo no binding R2 `IMAGES` e devolve somente a URL pública. Tokens e chaves privadas do R2 não devem ser colocados no GitHub.

Na versão multiempresa, use o código de `cloudflare/r2-upload-worker.js`. Ele também verifica se a pessoa pertence à empresa informada e grava cada arquivo dentro da pasta `<store_id>/...`. No Worker, mantenha o binding `IMAGES` e configure:

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave pública/publicável do Supabase |
| `R2_PUBLIC_URL` | URL pública do bucket, sem barra no final |

Depois de atualizar o código, publique o Worker. Não coloque a `service_role` no Cloudflare.

## 1. Preparar o banco

Execute, nesta ordem, no SQL Editor do Supabase:

1. `database/migrations/002_integrations.sql`
2. `database/migrations/003_make_order_automation.sql`
3. `database/migrations/004_multi_tenant.sql`

A migração 003 cria as integrações e o histórico. A migração 004 preserva tudo na loja de demonstração, cria empresas, membros, páginas, domínios e auditoria, e troca as regras abertas por isolamento por empresa.

Depois da migração 004, execute em **GitHub → Actions** o workflow **Ativar base multiempresa**. Ele publica novamente todas as Edge Functions já preparadas para receber `storeId` e publica a função protegida `platform-admin`.

Em **Supabase → Authentication → URL Configuration**, adicione a URL `/sistema/convite/` do site à lista de redirects permitidos. A Central gera um link de convite para você copiar e enviar; o cadastro público continua desativado.

## Administração central

Acesse `/sistema/central/` com o usuário principal. A Central permite:

- criar uma empresa copiando a demonstração para um catálogo independente;
- liberar, suspender ou reativar usuários por empresa;
- abrir o painel e o cardápio de cada operação;
- registrar domínio próprio ou subdomínio para ativação futura;
- manter plano, vencimento e limites vazios, sem bloqueios nesta demonstração.

## 2. WhatsApp Cloud API da Meta

Crie um aplicativo na Meta for Developers, adicione o produto WhatsApp e obtenha o `Phone Number ID` e um token permanente de usuário do sistema. Depois configure os Secrets:

```bash
supabase secrets set META_WHATSAPP_TOKEN="TOKEN_PERMANENTE"
supabase secrets set META_PHONE_NUMBER_ID="PHONE_NUMBER_ID"
supabase secrets set META_ORDER_RECIPIENT="55DDDNUMERO"
supabase secrets set META_API_VERSION="v23.0"
supabase functions deploy whatsapp-order
```

No painel, abra **Configurações → WhatsApp Cloud API**, ative a integração e publique. A função sempre envia para o número protegido em `META_ORDER_RECIPIENT`; o cliente não escolhe o destinatário.

Observação: fora da janela de atendimento de 24 horas da Meta, mensagens ao cliente exigem template aprovado. Esta função envia a nota para o WhatsApp interno da loja.

## 3. Mercado Pago

A função `create-checkout` está preparada para PIX e cartão pelo Mercado Pago. Configure os Secrets somente no novo projeto Supabase:

```bash
supabase secrets set MERCADO_PAGO_ACCESS_TOKEN="TOKEN_DO_NOVO_ESTABELECIMENTO"
supabase secrets set MERCADO_PAGO_WEBHOOK_SECRET="ASSINATURA_DO_WEBHOOK"
supabase secrets set SITE_URL="https://seudominio.com.br/"
supabase secrets set PAYMENT_DESCRIPTOR="NOME DA LOJA"
supabase functions deploy create-checkout mercadopago-webhook payment-status --no-verify-jwt
```

Não reutilize o token ou o webhook de outro comércio. Depois de publicar as funções, ative **Mercado Pago** em **Configurações → Gateway e checkout** no painel.

<a id="make-mailgun"></a>

## 4. Make + Mailgun para e-mails automáticos

O fluxo é automático: o cardápio salva o pedido, a função protegida `order-email` envia os dados ao webhook do Make e o módulo Mailgun dispara o e-mail. O pedido continua salvo mesmo se a automação estiver temporariamente fora do ar.

### 4.1 Publicar a função protegida

No terminal conectado ao projeto Supabase:

```bash
supabase functions deploy order-email --no-verify-jwt
```

Essa função precisa aceitar o pedido público recém-criado. Por isso a verificação padrão do gateway é desativada somente nela; o próprio código limita a notificação inicial a pedidos recentes, impede duplicidade e exige uma sessão administrativa válida para teste e mudanças de status.

As variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas automaticamente pelo Supabase à Edge Function. Não coloque a chave `service_role` no GitHub nem no painel.

### 4.2 Criar o cenário no Make

1. No Make, crie um cenário novo.
2. Adicione **Webhooks → Custom webhook** e dê o nome `Seu Delivery - Pedidos`.
3. Copie a URL gerada. Ela começa com `https://hook...make.com/`.
4. Adicione o módulo **Mailgun → Send an Email** logo depois do webhook.
5. Conecte a conta Mailgun usando a chave privada da API.
6. Mapeie os campos recebidos desta forma:

| Campo no Mailgun | Campo recebido do webhook |
|---|---|
| From | `email.from` |
| To | `email.to` |
| Reply-To | `email.replyTo` |
| Subject | `email.subject` |
| HTML | `email.html` |
| Text | `email.text` |

7. Salve o cenário e deixe-o **ON**. Ative o processamento sequencial do webhook para preservar a ordem das mensagens em momentos de muitos pedidos.

Não é necessário criar vários cenários. O mesmo módulo usa o campo dinâmico `email.to`: em `order.created` ele envia a nota completa à loja; nas mudanças de status ele envia a atualização personalizada ao cliente.

### 4.3 Conectar pelo painel

1. Entre em `https://seudominio.com.br/sistema/admin/`.
2. Abra **Configurações → E-mails automáticos · Make + Mailgun**.
3. Cole a URL copiada do Make, ative a automação e clique em **Publicar alterações**.
4. Clique em **Testar webhook** e confira a execução no Make e o e-mail no Mailgun.

A URL fica em `private_settings`, protegida pelas regras do Supabase. Ela não é enviada ao navegador dos clientes e não faz parte do catálogo público.

### 4.4 Eventos enviados

| Evento | Destinatário | Quando acontece |
|---|---|---|
| `integration.test` | Loja | Botão Testar webhook |
| `order.created` | Loja | Cliente finaliza o pedido |
| `order.confirmed` | Cliente | Administrador confirma o pedido |
| `order.preparing` | Cliente | Pedido entra em preparo |
| `order.out_for_delivery` | Cliente | Pedido sai para entrega |
| `order.completed` | Cliente | Pedido é concluído |
| `order.cancelled` | Cliente | Pedido é cancelado |
| `order.payment_paid` | Cliente | Pagamento é confirmado separadamente |
| `order.payment_refunded` | Cliente | Pagamento é estornado |

Cada chamada também inclui `order`, `customer`, `address`, `items`, `totals`, a nota em texto e o e-mail pronto em HTML. O histórico em `order_webhook_events` impede duplicidade da mesma atualização e permite auditoria.

### 4.5 Configurar o domínio no Mailgun

Cadastre e valide o domínio do novo estabelecimento no Mailgun antes de usá-lo como remetente. Se estiver usando apenas o domínio sandbox do Mailgun, os destinatários também precisam estar autorizados no sandbox. Depois de validar o domínio, use em **E-mail dos pedidos** no painel um endereço pertencente a esse domínio.

## 5. Meta Conversions API sem servidor pago

A compra do navegador continua sendo disparada pelo GTM. A função `meta-conversions` envia o mesmo pedido pelo Supabase para a Conversions API da Meta, sem colocar o token no JavaScript público e sem depender de um contêiner server-side pago.

O envio só é permitido quando o cliente marca o consentimento de marketing. A integração envia `Purchase` com valor, moeda, número do pedido, produtos e dados de correspondência normalizados e criptografados com SHA-256. E-mail, telefone, nome e endereço nunca são enviados em texto aberto. IP, navegador e cookies técnicos `_fbp`/`_fbc` são enviados conforme o protocolo da Meta. Falha da Meta não cancela nem bloqueia o checkout.

### 5.1 Ativar somente pelo GitHub

1. No repositório, abra **Settings → Secrets and variables → Actions**.
2. Crie `SUPABASE_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN` e `SITE_URL` com os dados do novo projeto e domínio.
3. Crie `META_CAPI_ACCESS_TOKEN` e `META_CAPI_PIXEL_ID` com os dados da nova conta. Nunca coloque tokens em arquivo, commit ou mensagem.
4. Opcionalmente, durante o teste, crie `META_CAPI_TEST_EVENT_CODE` com o código exibido em **Testar eventos** da Meta.
5. Abra **Actions → Deploy Meta Conversions API → Run workflow**.
6. Depois do teste, exclua `META_CAPI_TEST_EVENT_CODE` e execute o workflow novamente para entrar em produção.

O workflow usa o `SUPABASE_ACCESS_TOKEN` que já está configurado, protege os segredos no Supabase e publica a função sem exigir terminal.

### 5.2 Consentimento e deduplicação

A camada de dados publica `event_id` com o mesmo valor de `transaction_id` e também `marketing_consent`.

No GTM:

1. Crie uma variável da camada de dados chamada `event_id` (Versão 2) e selecione essa variável no campo **Event ID** da tag Meta Pixel `Purchase`.
2. Crie outra variável da camada de dados chamada `marketing_consent` (Versão 2).
3. No acionador da tag Meta `Purchase`, mantenha o evento `purchase` e adicione a condição `marketing_consent é igual a true`.

Não use um identificador aleatório diferente no campo Event ID. Navegador e Servidor precisam chegar à Meta com o mesmo nome `Purchase` e o mesmo `event_id` para a deduplicação funcionar.

### 5.3 Banner, Consent Mode e origem da venda

O cardápio usa o cookie próprio `cardapio_consent_v1` para lembrar por 6 meses as escolhas Necessários, Analytics e Marketing. O Consent Mode começa negado para `analytics_storage`, `ad_storage`, `ad_user_data` e `ad_personalization`.

- **Somente necessários:** GTM, GA4 e Meta não são carregados.
- **Analytics autorizado:** GA4 mede a visita sem liberar a Meta.
- **Marketing autorizado:** o GTM é carregado com os sinais de consentimento e pode executar as tags publicitárias.
- **Compra Meta:** continua exigindo também a opção de ofertas do checkout. `marketing_consent` só fica `true` quando as duas autorizações existem.

O cookie próprio `cardapio_attribution_v1` guarda por até 90 dias, somente após autorização de Analytics ou Marketing, a primeira e a última origem. O pedido salva esses dados dentro de `customer.attribution`, sem enviar nome, telefone, e-mail ou endereço ao GA4.

A camada de dados do evento `purchase` também disponibiliza:

| Campo | Conteúdo |
|---|---|
| `utm_source` | Canal, como instagram, google ou whatsapp |
| `utm_medium` | Meio, como paid_social, cpc ou mensagem |
| `utm_campaign` | Nome da campanha |
| `utm_content` | Anúncio ou criativo |
| `utm_term` | Termo ou conjunto |
| `traffic_referrer` | Domínio de referência |
| `landing_page` | Página de entrada |
| `cookie_marketing_consent` | Escolha de Marketing no banner |
| `checkout_marketing_consent` | Opção de ofertas no checkout |

Para relatórios personalizados no GA4, crie no GTM variáveis da camada de dados com os mesmos nomes e envie os cinco parâmetros UTM na tag de evento `purchase`. Depois registre-os no GA4 como dimensões personalizadas com escopo de evento.

## 6. Teste seguro

Faça um pedido pequeno e confirme este roteiro:

1. O pedido aparece em **Pedidos → Hoje → Novos**.
2. O e-mail da nota chega à loja automaticamente.
3. Ao clicar em **Confirmar pedido**, o card pula para **Confirmados**.
4. O cliente recebe o e-mail personalizado de confirmação.
5. Ao marcar como pago, a identificação visual muda imediatamente.
6. A exclusão só acontece depois da confirmação no painel.

Para WhatsApp, verifique também `notification_status`. Para e-mail, verifique `store_email_status`, `customer_email_status` e `order_webhook_events`. Se WhatsApp, Make, Mailgun ou gateway falhar, o pedido continua salvo no painel.
