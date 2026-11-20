-- Questions imported from an uploaded PDF (the /upload page).
--
-- Any signed-in user can import questions. They are stored as unpublished
-- problems owned by that user, tagged with the paper they came from, so only
-- the owner (and admins) can see them. Publishing stays admin-only.

alter table public.problems
  add column if not exists paper text check (paper is null or char_length(paper) between 1 and 120);

create policy "Users read their own imported problems"
  on public.problems for select to authenticated
  using (created_by = (select auth.uid()));

create policy "Users import their own private problems"
  on public.problems for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and not published
    and paper is not null
    and hidden_tests <= 10
  );

create policy "Users delete their own imported problems"
  on public.problems for delete to authenticated
  using (created_by = (select auth.uid()) and paper is not null);
