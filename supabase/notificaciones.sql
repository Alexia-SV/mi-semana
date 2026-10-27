-- Notificaciones con la app cerrada (correr en Supabase → SQL Editor).
-- 1) Tabla con la suscripción de cada dispositivo; solo tu usuario ve y cambia las suyas.
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  creada timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "mis suscripciones" on public.push_subs;
create policy "mis suscripciones" on public.push_subs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 2) Horarios (hora del centro de México = UTC-6). Reemplaza CRON_SECRET por el valor de tu archivo de secretos.
--    11:00 p. m. rutina de noche · 12:30 a. m. "antes de dormir" · 10:00 a. m. obligatorios de hoy y mañana
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('mi-semana-noche', '0 5 * * *', $$
  select net.http_post(
    url := 'https://yuusedshkqztfzofcasq.supabase.co/functions/v1/recordatorios',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "CRON_SECRET"}'::jsonb,
    body := '{"tipo": "noche"}'::jsonb
  );
$$);

select cron.schedule('mi-semana-antes-de-dormir', '30 6 * * *', $$
  select net.http_post(
    url := 'https://yuusedshkqztfzofcasq.supabase.co/functions/v1/recordatorios',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "CRON_SECRET"}'::jsonb,
    body := '{"tipo": "noche", "segundo": true}'::jsonb
  );
$$);

select cron.schedule('mi-semana-manana', '0 16 * * *', $$
  select net.http_post(
    url := 'https://yuusedshkqztfzofcasq.supabase.co/functions/v1/recordatorios',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "CRON_SECRET"}'::jsonb,
    body := '{"tipo": "manana"}'::jsonb
  );
$$);
