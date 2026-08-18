-- wyrkbook: private storage buckets
-- Path convention is <org_id>/<owner_id>/<file>, so the first path segment is the
-- tenant boundary and every policy checks it against wb_org().

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('assignment-sources', 'assignment-sources', false, 26214400,
   array['image/jpeg','image/png','image/webp','image/heic','application/pdf']),
  ('student-work', 'student-work', false, 26214400,
   array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

-- ------------------------------------------------ assignment-sources (admins only)

create policy sources_admin_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'assignment-sources'
    and wb_is_admin()
    and (storage.foldername(name))[1] = wb_org()::text
  )
  with check (
    bucket_id = 'assignment-sources'
    and wb_is_admin()
    and (storage.foldername(name))[1] = wb_org()::text
  );

-- ------------------------------------------------ student-work

-- Students write and read only under their own <org_id>/<their uid>/ prefix.
create policy work_student_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'student-work'
    and (storage.foldername(name))[1] = wb_org()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'student-work'
    and (storage.foldername(name))[1] = wb_org()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Admins read all work in their organization (grading + review).
create policy work_admin_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-work'
    and wb_is_admin()
    and (storage.foldername(name))[1] = wb_org()::text
  );
