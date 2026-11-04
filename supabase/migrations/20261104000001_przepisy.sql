-- Przepisy Mamy: jedna rodzina, wspólne przepisy i lista zakupów.
-- Każdy przepis i każda pozycja zakupów to osobny wiersz.

-- Rodziny i członkostwo ----------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Moja rodzina',
  join_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (household_id, user_id)
);
-- Jedno konto należy do jednej rodziny.
create unique index household_members_one_family on public.household_members (user_id);

create function public.my_household() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select household_id from household_members where user_id = auth.uid()
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
create policy "members read household" on public.households
  for select to authenticated using (id = public.my_household());
create policy "members read members" on public.household_members
  for select to authenticated using (household_id = public.my_household());

-- Założenie rodziny lub dołączenie kodem (bez ręcznego SQL).
create function public.create_family(p_name text default 'Moja rodzina') returns public.households
language plpgsql security definer set search_path = public, pg_temp as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if public.my_household() is not null then raise exception 'already in family'; end if;
  insert into households (name) values (left(coalesce(nullif(trim(p_name), ''), 'Moja rodzina'), 80)) returning * into h;
  insert into household_members values (h.id, auth.uid());
  return h;
end $$;

create function public.join_family(p_code text) returns public.households
language plpgsql security definer set search_path = public, pg_temp as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if public.my_household() is not null then raise exception 'already in family'; end if;
  select * into h from households where join_code = upper(trim(p_code));
  if not found then raise exception 'wrong code'; end if;
  insert into household_members values (h.id, auth.uid());
  return h;
end $$;

revoke all on function public.create_family(text), public.join_family(text), public.my_household() from public, anon;
grant execute on function public.create_family(text), public.join_family(text), public.my_household() to authenticated;

-- Przepisy i zakupy ----------------------------------------------------------

create table public.recipes (
  id uuid primary key,
  household_id uuid not null references public.households on delete cascade default public.my_household(),
  title text not null check (length(title) between 1 and 200),
  minutes integer not null default 0 check (minutes between 0 and 10080),
  minutes_estimated boolean not null default false,
  ingredients jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array'),
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
  tags text[] not null default '{}',
  link text not null default '' check (length(link) <= 2048),
  images text[] not null default '{}' check (cardinality(images) <= 10),
  emoji text not null default '🍽️',
  bg text not null default 't2',
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table public.shopping_items (
  id uuid primary key,
  household_id uuid not null references public.households on delete cascade default public.my_household(),
  name text not null check (length(name) between 1 and 300),
  from_title text not null default '' check (length(from_title) <= 200),
  recipe_id uuid,
  done boolean not null default false,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create index recipes_sync on public.recipes (household_id, updated_at);
create index shopping_items_sync on public.shopping_items (household_id, updated_at);

-- Serwer zawsze ustawia czas zmiany, więc telefony z różnym zegarem się nie mylą.
create function public.touch() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger recipes_touch before insert or update on public.recipes for each row execute function public.touch();
create trigger shopping_touch before insert or update on public.shopping_items for each row execute function public.touch();

alter table public.recipes enable row level security;
alter table public.shopping_items enable row level security;
create policy "family recipes" on public.recipes for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());
create policy "family shopping" on public.shopping_items for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());
-- Supabase domyślnie daje pełne prawa; usuwanie jest tylko „miękkie” (deleted=true), żeby dotarło do drugiego telefonu.
revoke all on public.recipes, public.shopping_items, public.households, public.household_members from anon;
revoke delete, truncate on public.recipes, public.shopping_items from authenticated;
grant select, insert, update on public.recipes, public.shopping_items to authenticated;

-- Przepisy ze skrótu iOS czekające na sprawdzenie --------------------------

create table public.inbox (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  created_by uuid references auth.users on delete set null,
  draft jsonb not null,
  link text not null default '',
  images text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.inbox enable row level security;
create policy "family inbox read" on public.inbox for select to authenticated using (household_id = public.my_household());
create policy "family inbox delete" on public.inbox for delete to authenticated using (household_id = public.my_household());
revoke all on public.inbox from anon;
revoke insert, update, truncate on public.inbox from authenticated;
grant select, delete on public.inbox to authenticated;
revoke insert, update, delete, truncate on public.households, public.household_members from authenticated;

-- Tokeny skrótu (tylko skrót, nic więcej). Przechowujemy wyłącznie hash.
create table public.shortcut_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.shortcut_tokens enable row level security;
revoke all on public.shortcut_tokens from anon, authenticated;
-- Brak polityk: dostęp ma tylko funkcja serwerowa (service role).

-- Zmiany na żywo (lista zakupów odświeża się na drugim telefonie).
alter publication supabase_realtime add table public.recipes, public.shopping_items, public.inbox;

-- Zdjęcia: prywatny schowek, folder = id rodziny ------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "family images read" on storage.objects for select to authenticated
  using (bucket_id = 'recipe-images' and (storage.foldername(name))[1] = public.my_household()::text);
create policy "family images add" on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-images' and (storage.foldername(name))[1] = public.my_household()::text);
