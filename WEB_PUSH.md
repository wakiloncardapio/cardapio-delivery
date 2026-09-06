# Web Push de pedidos

O workflow **Ativar Web Push** aplica `006_web_push.sql` e publica a função usando o secret `SUPABASE_ACCESS_TOKEN` já usado no projeto. Também pode ser executado manualmente em Actions. O build Cloudflare publica o worker, o manifesto e os controles do painel.

No painel de cada empresa, em Avisos de novos pedidos, clique em **Ativar Web Push neste aparelho**, autorize o navegador e use **Testar aviso**. A ativação é salva imediatamente por empresa, usuário e aparelho. Não depende do botão Publicar. Para outra empresa ou aparelho, ative novamente.

No iPhone/iPad (iOS/iPadOS 16.4 ou posterior), adicione o painel à Tela de Início e abra por esse ícone. Notificações dependem das permissões, conexão e regras do sistema operacional; fechamento forçado do navegador e economia de bateria podem impedir ou atrasar a entrega. Som personalizado funciona com o painel aberto; no push vale o som do sistema.

Pedidos com pagamento na entrega avisam ao serem criados. PIX/cartão on-line avisam quando `payment_status` vira `pago`; o webhook de pagamento precisa estar funcionando. Pedidos cancelados/recusados/estornados não disparam. Abrir o aviso leva ao painel da empresa. O conteúdo não inclui dados pessoais do comprador.

As inscrições e chaves privadas têm RLS e acesso somente pelo serviço. O endpoint verifica sessão e permissão de gestão; a cada envio verifica novamente acesso, empresa ativa e validade. As chaves VAPID são geradas uma única vez no servidor. Não as coloque no frontend. Troca do domínio principal exige atualizar `PLATFORM_URL` na função; domínios próprios precisam constar como ativos em `store_domains`.

A fila registra entregas aceitas pelo provedor e tenta novamente até cinco vezes, com intervalo de dois minutos, por no máximo 30 minutos. A limpeza ocorre após sete dias. `completed_at` vazio com `attempts = 5` indica esgotamento das tentativas; aceite do provedor não comprova exibição ou leitura no aparelho. Inscrições expiradas são removidas. O teste envia somente ao aparelho solicitante, limitado a uma tentativa por minuto.
