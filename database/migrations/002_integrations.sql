-- Execute no SQL Editor do Supabase para habilitar notificações e checkout.
alter table public.orders add column if not exists notification_status text not null default 'nao_enviado';
alter table public.orders add column if not exists notification_error text not null default '';
alter table public.orders add column if not exists notified_at timestamptz;
alter table public.orders add column if not exists payment_provider text not null default '';
alter table public.orders add column if not exists payment_reference text not null default '';
alter table public.orders add column if not exists checkout_url text not null default '';

