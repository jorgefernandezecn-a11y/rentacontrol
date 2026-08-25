begin;

create table if not exists insurance_documents (
  id uuid primary key default gen_random_uuid(),
  insurance_policy_id uuid not null references insurance_policies(id) on delete cascade,
  display_name varchar(160) not null,
  description text,
  document_date date not null default current_date,
  original_name varchar(255) not null,
  mime_type varchar(100) not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 4194304),
  blob_url text not null unique,
  blob_pathname text not null unique,
  uploaded_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint insurance_documents_allowed_type check (
    mime_type in (
      'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/rtf','text/rtf','text/plain','text/csv',
      'application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet'
    )
  )
);

create index if not exists insurance_documents_policy_date_idx
  on insurance_documents(insurance_policy_id, document_date desc, created_at desc);

commit;
