-- Chat messages table
create table if not exists chat_messages (
  id uuid default gen_random_uuid() primary key,
  session_id text not null,
  agent text not null,
  role text not null,
  content text not null,
  created_at timestamp with time zone default now()
);

-- User memory table
create table if not exists user_memory (
  id uuid default gen_random_uuid() primary key,
  category text not null,
  fact text not null,
  source_message text,
  created_at timestamp with time zone default now()
);

-- Indexes
create index if not exists idx_chat_session on chat_messages(session_id);
create index if not exists idx_chat_agent on chat_messages(agent);
create index if not exists idx_memory_category on user_memory(category);

-- RLS policies
alter table chat_messages enable row level security;
alter table user_memory enable row level security;

-- Allow all access (public anon key)
drop policy if exists "Allow all for chat_messages" on chat_messages;
create policy "Allow all for chat_messages" on chat_messages for all using (true) with check (true);

drop policy if exists "Allow all for user_memory" on user_memory;
create policy "Allow all for user_memory" on user_memory for all using (true) with check (true);
