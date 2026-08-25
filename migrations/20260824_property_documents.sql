begin;

create table if not exists property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  display_name varchar(160) not null,
  description text,
  document_date date not null default current_date,
  original_name varchar(255) not null,
  mime_type varchar(100) not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  blob_url text not null unique,
  blob_pathname text not null unique,
  uploaded_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_documents_allowed_type check (
    mime_type in ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif')
  )
);

create index if not exists property_documents_property_date_idx
  on property_documents(property_id, document_date desc, created_at desc);

commit;
