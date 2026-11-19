-- rpad() truncates strings longer than the target length, which cut every username to 3 characters.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  base text;
  candidate text;
  n integer := 0;
begin
  base := coalesce(
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^A-Za-z0-9_]', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username', ''), '[^A-Za-z0-9_]', '', 'g'), ''),
    nullif(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^A-Za-z0-9_]', '', 'g'), ''),
    'coder'
  );
  base := left(base, 16);
  if length(base) < 3 then
    base := rpad(base, 3, '0');
  end if;
  candidate := base;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    n := n + 1;
    candidate := base || n::text;
  end loop;
  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
