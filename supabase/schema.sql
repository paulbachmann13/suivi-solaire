-- Suivi solaire : schéma Supabase (à coller une fois dans SQL Editor, puis Run).
-- Une ligne par document (un mois, un équipement, un réglage), rangée par utilisateur.

create table if not exists public.docs (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  col        text not null check (col in ('months','parc','settings')),
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, col, id)
);

-- Chaque compte ne voit et ne modifie que ses propres lignes.
alter table public.docs enable row level security;

drop policy if exists "docs lecture perso" on public.docs;
drop policy if exists "docs ajout perso" on public.docs;
drop policy if exists "docs modif perso" on public.docs;
drop policy if exists "docs suppression perso" on public.docs;
create policy "docs lecture perso" on public.docs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "docs ajout perso" on public.docs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "docs modif perso" on public.docs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "docs suppression perso" on public.docs for delete to authenticated
  using (user_id = (select auth.uid()));

-- Accès via l'API seulement pour les comptes connectés (rien pour anon).
revoke all on public.docs from anon;
grant select, insert, update, delete on public.docs to authenticated;

-- Date de dernière modification.
create or replace function public.docs_touch() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs
  for each row execute function public.docs_touch();

-- Temps réel : un changement sur l'iPhone apparaît sur l'iPad.
do $$
begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null;
end $$;

-- Maintien en activité : appelée tous les 3 jours par GitHub Actions.
-- Ne lit aucune donnée.
create or replace function public.ping() returns text
  language sql stable set search_path = '' as $$ select 'ok'::text $$;
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
