export default function Home() {
  return (
    <div className="landing">
      <div className="landing-title">🎵 Music Box</div>
      <p className="landing-subtitle">
        Hệ thống đặt đồ ăn trực tuyến. Quét mã QR tại bàn để bắt đầu đặt món!
      </p>
      <div className="landing-links">
        <a href="/order?room=1" className="btn btn-primary" style={{ fontSize: 16, padding: '14px 32px' }}>
          🍽️ Demo Phòng 1
        </a>
        <a href="/admin" className="btn btn-secondary" style={{ fontSize: 16, padding: '14px 32px' }}>
          ⚙️ Trang Admin
        </a>
      </div>
      <div style={{ marginTop: 40, color: 'var(--text-muted)', fontSize: 13 }}>
        <p>📱 QR code sẽ dẫn đến: /order?room=1 ... /order?room=10</p>
      </div>
    </div>
  )
}