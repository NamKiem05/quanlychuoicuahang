-- Public product photos with store-scoped upload and delete permissions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Store members upload product images" on storage.objects;
create policy "Store members upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (select public.has_store_role((storage.foldername(name))[1]::uuid))
);

drop policy if exists "Store members delete product images" on storage.objects;
create policy "Store members delete product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.has_store_role((storage.foldername(name))[1]::uuid))
);
