-- Idempotent Partner API writes (outcome / touches / feedback batch).

create table if not exists public.partner_idempotency_keys (
  partner_key_id uuid not null references public.partner_api_keys (id) on delete cascade,
  idempotency_key text not null,
  route text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (partner_key_id, idempotency_key)
);

create index if not exists idx_partner_idempotency_keys_created
  on public.partner_idempotency_keys (created_at);

alter table public.partner_idempotency_keys enable row level security;

revoke all on public.partner_idempotency_keys from anon, authenticated;
grant select, insert, update, delete on public.partner_idempotency_keys to service_role;
