-- ============================================
-- MUSIC BOX - SCHEMA V3
-- Session-based orders: mỗi đơn gắn với ca (session)
-- Chạy trên Supabase Dashboard → SQL Editor
-- ============================================

-- Xóa bảng cũ nếu có (theo thứ tự dependency)
drop table if exists daily_reports;
drop table if exists order_items;
drop table if exists orders;
drop table if exists room_sessions;
drop table if exists room_pricing;
drop table if exists messages;
drop table if exists menu_items;

-- Bật UUID
create extension if not exists "uuid-ossp";

-- ========== BẢNG CHÍNH ==========

-- Menu items
create table menu_items (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  price numeric not null,
  image_url text
);

-- Giá phòng theo khung giờ
create table room_pricing (
  id uuid primary key default uuid_generate_v4(),
  room_id text unique not null,
  day_rate numeric default 30000,
  night_rate numeric default 60000,
  day_start_hour int default 10,
  night_start_hour int default 18
);

-- Phiên sử dụng phòng (CA) - mỗi lần mở/đóng phòng = 1 ca
create table room_sessions (
  id uuid primary key default uuid_generate_v4(),
  room_id text not null,
  check_in timestamp not null default now(),
  check_out timestamp,
  total_amount numeric default 0,
  status text default 'active',
  created_at timestamp default now()
);

-- Orders - GẮN VỚI SESSION (CA)
create table orders (
  id uuid primary key default uuid_generate_v4(),
  room_id text not null,
  session_id uuid references room_sessions(id),
  status text default 'pending',
  created_at timestamp default now()
);

-- Order items
create table order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references orders(id),
  menu_item_id uuid references menu_items(id),
  quantity int not null,
  note text
);

-- Messages (chat)
create table messages (
  id uuid primary key default uuid_generate_v4(),
  room_id text,
  content text,
  sender text,
  created_at timestamp default now()
);

-- Lịch sử chốt doanh thu hằng ngày
create table daily_reports (
  id uuid primary key default uuid_generate_v4(),
  report_date date not null,
  total_room_revenue numeric default 0,
  total_order_revenue numeric default 0,
  total_revenue numeric default 0,
  details jsonb,
  created_at timestamp default now()
);

-- ========== DỮ LIỆU MẪU ==========

insert into menu_items (name, price, image_url) values
('Bia Heineken', 35000, 'https://placehold.co/150x150/png?text=Heineken'),
('Trà Đào Cam Sả', 45000, 'https://placehold.co/150x150/png?text=Tra+Dao'),
('Khô Bò Vắt Chanh', 85000, 'https://placehold.co/150x150/png?text=Kho+Bo'),
('Trái Cây Đĩa', 120000, 'https://placehold.co/150x150/png?text=Trai+Cay');

insert into room_pricing (room_id, day_rate, night_rate, day_start_hour, night_start_hour) values
('1', 30000, 60000, 10, 18),
('2', 30000, 60000, 10, 18),
('3', 30000, 60000, 10, 18),
('4', 35000, 70000, 10, 18),
('5', 35000, 70000, 10, 18),
('6', 40000, 80000, 10, 18),
('7', 40000, 80000, 10, 18),
('8', 50000, 100000, 10, 18),
('9', 50000, 100000, 10, 18),
('10', 60000, 120000, 10, 18);

-- Bật Realtime
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table room_sessions;
