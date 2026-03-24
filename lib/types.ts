export interface MenuItem {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
}

export interface CartItem extends MenuItem {
  quantity: number;
  note?: string;
}

export interface Order {
  id: string;
  room_id: string;
  session_id?: string | null;
  status: 'pending' | 'preparing' | 'done' | 'cancelled';
  created_at: string;
  order_items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  quantity: number;
  note?: string | null;
  menu_items?: MenuItem;
}

export interface Message {
  id: string;
  room_id: string;
  content: string;
  sender: 'customer' | 'admin';
  created_at: string;
}

export interface RoomPricing {
  id: string;
  room_id: string;
  day_rate: number;
  night_rate: number;
  day_start_hour: number;
  night_start_hour: number;
}

export interface RoomSession {
  id: string;
  room_id: string;
  check_in: string;
  check_out: string | null;
  total_amount: number;
  status: 'active' | 'closed';
  created_at: string;
}

export interface DailyReport {
  id: string;
  report_date: string;
  total_room_revenue: number;
  total_order_revenue: number;
  total_revenue: number;
  details: any;
  created_at: string;
}

export interface RoomRevenueDetail {
  room_id: string;
  room_time_revenue: number;
  order_revenue: number;
  total: number;
  sessions: RoomSession[];
  orders: Order[];
}
