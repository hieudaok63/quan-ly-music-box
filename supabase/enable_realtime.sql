-- Bật Realtime cho bảng orders và messages
-- Chạy script này trên Supabase Dashboard → SQL Editor

-- Bật realtime cho bảng orders (để admin nhận đơn hàng mới real-time)
alter publication supabase_realtime add table orders;

-- Bật realtime cho bảng messages (để chat hoạt động real-time)
alter publication supabase_realtime add table messages;
