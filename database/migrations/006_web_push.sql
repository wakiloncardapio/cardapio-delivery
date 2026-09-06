-- Web Push: fila transacional, chaves privadas e inscrições isoladas por empresa.
begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.web_push_config (
  id boolean primary key default true check(id),
  dispatch_secret text not null default (gen_random_uuid()::text || gen_random_uuid()::text),
  public_key text,
  private_key text
);
insert into public.web_push_config(id) values(true) on conflict do nothing;

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check(length(endpoint) <= 2048),
  keys jsonb not null,
  origin text not null,
  created_at timestamptz not null default now(),
  last_test_at timestamptz not null default 'epoch',
  unique(store_id,user_id,endpoint)
);
create table if not exists public.web_push_queue (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  claimed_until timestamptz not null default 'epoch',
  delivered uuid[] not null default '{}'
);
create index if not exists web_push_due on public.web_push_queue(next_attempt_at) where completed_at is null;
alter table public.web_push_config enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.web_push_queue enable row level security;
revoke all on public.web_push_config, public.web_push_subscriptions, public.web_push_queue from public, anon, authenticated;
grant all on public.web_push_config, public.web_push_subscriptions, public.web_push_queue to service_role;

create or replace function public.dispatch_web_push() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare job record; secret text;
begin
  select dispatch_secret into secret from public.web_push_config where id = true;
  for job in select id from public.web_push_queue
    where completed_at is null and attempts < 5 and next_attempt_at <= now()
      and created_at > now() - interval '30 minutes'
    order by created_at limit 20 for update skip locked
  loop
    update public.web_push_queue set attempts = attempts + 1,
      next_attempt_at = now() + interval '2 minutes' where id = job.id;
    perform net.http_post(
      url := 'https://tamwadldvmspvmstqggc.supabase.co/functions/v1/web-push',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || secret),
      body := jsonb_build_object('action','dispatch','jobId',job.id), timeout_milliseconds := 60000
    );
  end loop;
  delete from public.web_push_queue where created_at < now() - interval '7 days';
end $$;
revoke all on function public.dispatch_web_push() from public,anon,authenticated;
grant execute on function public.dispatch_web_push() to service_role;

create or replace function public.enqueue_order_web_push() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- PIX/cartão on-line só avisam após aprovação; pagamento na entrega avisa ao criar.
  if new.status = 'cancelado' or new.payment_status in ('estornado','recusado') then return new; end if;
  if not (new.payment_status = 'pago' or new.payment_method in ('cash','card_delivery')) then return new; end if;
  if tg_op = 'UPDATE' then
    if old.payment_status = 'pago' or old.payment_method in ('cash','card_delivery') then return new; end if;
  end if;
  if not exists(select 1 from public.web_push_subscriptions where store_id = new.store_id) then return new; end if;
  insert into public.web_push_queue(order_id,store_id) values(new.id,new.store_id) on conflict do nothing;
  perform public.dispatch_web_push();
  return new;
exception when others then
  -- Uma falha do serviço de aviso não pode impedir a venda.
  raise warning 'Web Push enqueue failed: %', SQLSTATE;
  return new;
end $$;
revoke all on function public.enqueue_order_web_push() from public,anon,authenticated;
drop trigger if exists order_web_push on public.orders;
create trigger order_web_push after insert or update of payment_status on public.orders
for each row execute function public.enqueue_order_web_push();
select cron.schedule('seufood-web-push-retry','* * * * *','select public.dispatch_web_push();');
commit;
