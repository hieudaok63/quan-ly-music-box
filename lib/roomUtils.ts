import { RoomPricing } from './types';

/**
 * Parse timestamp từ Supabase (UTC) thành Date object đúng timezone.
 * Supabase trả về dạng "2026-03-24T08:00:00" (không có timezone suffix),
 * nên cần thêm "Z" để JavaScript hiểu đúng là UTC.
 */
function parseSupabaseTimestamp(ts: string): Date {
  // Nếu đã có timezone info (Z hoặc +/-) thì parse bình thường
  if (ts.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(ts)) {
    return new Date(ts);
  }
  // Supabase timestamp without timezone → UTC
  return new Date(ts + 'Z');
}

/**
 * Tính tiền phòng dựa trên thời gian check-in/check-out và bảng giá.
 * Logic: chia thời gian thành từng phút, check mỗi phút thuộc khung giờ nào → cộng giá tương ứng.
 */
export function calculateRoomCost(
  checkIn: Date,
  checkOut: Date,
  pricing: RoomPricing
): number {
  const { day_rate, night_rate, day_start_hour, night_start_hour } = pricing;

  const totalMinutes = Math.max(0, Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000));

  if (totalMinutes === 0) return 0;

  let totalCost = 0;
  const perMinuteDay = day_rate / 60;
  const perMinuteNight = night_rate / 60;

  for (let i = 0; i < totalMinutes; i++) {
    const currentTime = new Date(checkIn.getTime() + i * 60000);
    const hour = currentTime.getHours();

    const isDayTime = hour >= day_start_hour && hour < night_start_hour;

    if (isDayTime) {
      totalCost += perMinuteDay;
    } else {
      totalCost += perMinuteNight;
    }
  }

  return Math.round(totalCost);
}

/**
 * Tính tiền phòng realtime (check-out = now)
 */
export function calculateCurrentCost(
  checkIn: string,
  pricing: RoomPricing
): number {
  return calculateRoomCost(parseSupabaseTimestamp(checkIn), new Date(), pricing);
}

/**
 * Format thời gian sử dụng thành chuỗi dễ đọc
 */
export function formatDuration(checkIn: string, checkOut?: string | null): string {
  const start = parseSupabaseTimestamp(checkIn);
  const end = checkOut ? parseSupabaseTimestamp(checkOut) : new Date();
  const diffMs = end.getTime() - start.getTime();

  if (diffMs < 0) return '0 phút';

  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);

  if (hours === 0) return `${minutes} phút`;
  return `${hours}h ${minutes}p`;
}

/**
 * Default pricing nếu chưa có trong DB
 */
export const DEFAULT_PRICING: Omit<RoomPricing, 'id' | 'room_id'> = {
  day_rate: 30000,
  night_rate: 60000,
  day_start_hour: 10,
  night_start_hour: 18,
};

export { parseSupabaseTimestamp };
