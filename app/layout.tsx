import './globals.css'

export const metadata = {
  title: 'Music Box - Đặt đồ ăn',
  description: 'Hệ thống đặt đồ ăn trực tuyến cho quán Music Box',
  themeColor: '#06060e',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  )
}