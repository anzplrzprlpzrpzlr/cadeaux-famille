-- Listes de cadeaux : schéma de la base Supabase.
-- Pas d'authentification pour l'instant : tout le monde (clé anon) peut lire et écrire.

create table public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index people_name_unique on public.people (lower(trim(name)));

create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.people (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (length(description) <= 2000),
  link text check (length(link) <= 2000),
  category text not null check (category in ('petit', 'abordable', 'gros')),
  created_at timestamptz not null default now()
);
create index gifts_owner_idx on public.gifts (owner_id);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null references public.gifts (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  percent int not null check (percent between 1 and 100),
  created_at timestamptz not null default now(),
  unique (gift_id, person_id)
);
create index contributions_person_idx on public.contributions (person_id);

-- Garantit qu'un cadeau n'est jamais offert en double, même si deux personnes cliquent en même temps :
-- le verrou sur la ligne du cadeau fait passer les participations l'une après l'autre.
create function public.check_contribution() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid;
  v_category text;
  v_others int;
begin
  select owner_id, category into v_owner, v_category
  from public.gifts where id = new.gift_id
  for update;

  if v_owner is null then
    raise exception 'Ce cadeau n''existe plus';
  end if;
  if v_owner = new.person_id then
    raise exception 'Tu ne peux pas t''offrir ton propre cadeau';
  end if;

  select coalesce(sum(percent), 0) into v_others
  from public.contributions
  where gift_id = new.gift_id and person_id <> new.person_id;

  if v_category <> 'gros' then
    if v_others > 0 then
      raise exception 'Quelqu''un offre déjà ce cadeau';
    end if;
    new.percent := 100;
  elsif v_others + new.percent > 100 then
    if v_others >= 100 then
      raise exception 'Ce cadeau est déjà entièrement financé';
    end if;
    raise exception 'Il ne reste que % %% à financer pour ce cadeau', 100 - v_others;
  end if;

  return new;
end;
$$;

create trigger contributions_check
before insert or update on public.contributions
for each row execute function public.check_contribution();

-- Accès ouvert (pas de connexion) : à resserrer le jour où on ajoute des mots de passe.
alter table public.people enable row level security;
alter table public.gifts enable row level security;
alter table public.contributions enable row level security;

create policy "acces ouvert" on public.people for all to anon, authenticated using (true) with check (true);
create policy "acces ouvert" on public.gifts for all to anon, authenticated using (true) with check (true);
create policy "acces ouvert" on public.contributions for all to anon, authenticated using (true) with check (true);
