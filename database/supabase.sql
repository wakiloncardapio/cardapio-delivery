-- Seu Delivery: banco para GitHub Pages + Supabase
-- Execute todo este arquivo no SQL Editor do seu projeto Supabase.

create extension if not exists pgcrypto;

create table if not exists public.catalogs (
  id text primary key check (id in ('settings', 'categories', 'products')),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer jsonb not null,
  fulfillment text not null check (fulfillment in ('delivery', 'pickup')),
  address jsonb not null default '{}'::jsonb,
  payment_method text not null,
  change_for text not null default '',
  notes text not null default '',
  items jsonb not null,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  total numeric(12,2) not null check (total >= 0),
  status text not null default 'novo' check (status in ('novo','confirmado','preparando','saiu_entrega','concluido','cancelado')),
  payment_status text not null default 'pendente' check (payment_status in ('pendente','pago','estornado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);

alter table public.catalogs enable row level security;
alter table public.orders enable row level security;

drop policy if exists "catalogo publico pode ler" on public.catalogs;
create policy "catalogo publico pode ler"
  on public.catalogs for select
  to anon, authenticated
  using (true);

drop policy if exists "administrador gerencia catalogo" on public.catalogs;
create policy "administrador gerencia catalogo"
  on public.catalogs for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "cliente cria pedido" on public.orders;
create policy "cliente cria pedido"
  on public.orders for insert
  to anon, authenticated
  with check (status = 'novo' and payment_status = 'pendente');

drop policy if exists "administrador le pedidos" on public.orders;
create policy "administrador le pedidos"
  on public.orders for select
  to authenticated
  using (true);

drop policy if exists "administrador atualiza pedidos" on public.orders;
create policy "administrador atualiza pedidos"
  on public.orders for update
  to authenticated
  using (true)
  with check (true);

grant select on public.catalogs to anon, authenticated;
grant insert, update, delete on public.catalogs to authenticated;
grant insert on public.orders to anon, authenticated;
grant select, update, delete on public.orders to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "imagens do cardapio sao publicas" on storage.objects;
create policy "imagens do cardapio sao publicas"
  on storage.objects for select
  to public
  using (bucket_id = 'menu-images');

drop policy if exists "administrador envia imagens" on storage.objects;
create policy "administrador envia imagens"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'menu-images');

drop policy if exists "administrador atualiza imagens" on storage.objects;
create policy "administrador atualiza imagens"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'menu-images')
  with check (bucket_id = 'menu-images');

drop policy if exists "administrador remove imagens" on storage.objects;
create policy "administrador remove imagens"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'menu-images');

-- Segurança importante:
-- Em Authentication > Providers > Email, desative novos cadastros públicos.
-- Crie somente o usuário administrador pelo painel do Supabase.

-- Campos opcionais para integrações protegidas (seguro executar novamente).
alter table public.orders add column if not exists notification_status text not null default 'nao_enviado';
alter table public.orders add column if not exists notification_error text not null default '';
alter table public.orders add column if not exists notified_at timestamptz;
alter table public.orders add column if not exists payment_provider text not null default '';
alter table public.orders add column if not exists payment_reference text not null default '';
alter table public.orders add column if not exists checkout_url text not null default '';

-- CRM, exclusão segura e automação de e-mail via Make/Mailgun.
alter table public.orders add column if not exists store_email_status text not null default 'nao_enviado';
alter table public.orders add column if not exists customer_email_status text not null default 'nao_enviado';
alter table public.orders add column if not exists email_error text not null default '';
alter table public.orders add column if not exists last_email_at timestamptz;

create table if not exists public.private_settings (
  id text primary key check (id in ('integrations')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.order_webhook_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  source_updated_at timestamptz not null,
  status text not null default 'processando' check (status in ('processando','enviado','erro')),
  response_status integer,
  error_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, event_type, source_updated_at)
);

create index if not exists order_webhook_events_order_idx
  on public.order_webhook_events (order_id, created_at desc);

alter table public.private_settings enable row level security;
alter table public.order_webhook_events enable row level security;

drop policy if exists "administrador gerencia configuracoes privadas" on public.private_settings;
create policy "administrador gerencia configuracoes privadas"
  on public.private_settings for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "administrador le historico de webhooks" on public.order_webhook_events;
create policy "administrador le historico de webhooks"
  on public.order_webhook_events for select
  to authenticated
  using (true);

drop policy if exists "administrador exclui pedidos" on public.orders;
create policy "administrador exclui pedidos"
  on public.orders for delete
  to authenticated
  using (true);

grant select, insert, update, delete on public.private_settings to authenticated;
grant select on public.order_webhook_events to authenticated;
grant select, insert, update, delete on public.private_settings to service_role;
grant select, insert, update, delete on public.order_webhook_events to service_role;
grant select, update on public.orders to service_role;

insert into public.private_settings (id, data)
values ('integrations', '{"makeWebhookEnabled":false,"makeWebhookUrl":""}'::jsonb)
on conflict (id) do nothing;
