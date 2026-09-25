-- wyrkbook: textbook pages in transit from a phone
--
-- A browser on a Mac cannot always see the teacher's iPhone as a camera
-- (Chrome does not list Continuity Camera), so the outline generator shows a QR
-- code instead. The phone opens a page that uploads each photo here, and the
-- desktop editor pulls them down and deletes them — the same moment it would
-- otherwise have read them from a file picker. Nothing is meant to stay: the
-- desktop removes each page as it takes it and empties the folder when it stops
-- listening (panel closed, outline generated, page left or closed). Anything a
-- crashed tab strands is pruned after an hour, the next time the folder is read.
--
-- Path convention: <org_id>/<teacher uid>/<curriculum_resource id>/<ms>-<rand>.jpg.
-- The uid segment keeps two teachers editing one resource from feeding each
-- other's screens; the millisecond prefix is the page order.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('outline-pages', 'outline-pages', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create policy outline_pages_own on storage.objects
  for all to authenticated
  using (
    bucket_id = 'outline-pages'
    and wb_is_admin()
    and (storage.foldername(name))[1] = wb_org()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'outline-pages'
    and wb_is_admin()
    and (storage.foldername(name))[1] = wb_org()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ------------------------------------------------ telling the desktop

/*
 * The desktop hears about each new page on a private Realtime broadcast channel,
 * `outline-pages:<teacher uid>:<resource id>`, rather than by polling storage.
 * The server calls this right after an upload. The topic is built from
 * auth.uid() here, not passed in, so a teacher can only ever announce into their
 * own channel. The payload is just the file name; the photo itself is fetched
 * through the app, under the storage policy above.
 */
create or replace function wb_outline_page_ready(p_resource uuid, p_name text) returns void
	language plpgsql security definer set search_path = public, pg_temp as $$
begin
	if not wb_is_admin() then
		raise exception 'not allowed' using errcode = '42501';
	end if;
	perform realtime.send(
		jsonb_build_object('name', p_name),
		'page',
		'outline-pages:' || auth.uid()::text || ':' || p_resource::text,
		true
	);
end;
$$;

revoke execute on function wb_outline_page_ready(uuid, text) from public;
grant  execute on function wb_outline_page_ready(uuid, text) to authenticated;

-- Listening only, and only on your own channels. No insert policy: browsers
-- never broadcast here, only the function above does.
create policy outline_pages_listen on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and split_part((select realtime.topic()), ':', 1) = 'outline-pages'
    and split_part((select realtime.topic()), ':', 2) = auth.uid()::text
    and wb_is_admin()
  );
