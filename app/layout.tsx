import './globals.css'

export const metadata = {
  title: 'Music Box - Đặt đồ ăn',
  description: 'Hệ thống đặt đồ ăn trực tuyến cho quán Music Box',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  )
}