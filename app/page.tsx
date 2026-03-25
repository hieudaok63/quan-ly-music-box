export default function Home() {
  return (
    <div className="landing">
      <div className="landing-title">🎵 Music Box</div>
      <p className="landing-subtitle">
        Hệ thống đặt đồ ăn & thức uống trực tuyến. Quét mã QR tại phòng để bắt đầu đặt món!
      </p>
      <div className="landing-links">
        <a href="/order?room=1" className="btn btn-primary" style={{ fontSize: 16, padding: '14px 36px' }}>
          🍽️ Demo Phòng 1
        </a>
        <a href="/admin" className="btn btn-secondary" style={{ fontSize: 16, padding: '14px 36px' }}>
          ⚙️ Trang Admin
        </a>
      </div>
      <div className="landing-features">
        <div className="landing-feature-card">
          <div className="landing-feature-icon">📱</div>
          <div className="landing-feature-text">Quét QR & đặt món</div>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon">💬</div>
          <div className="landing-feature-text">Chat trực tiếp</div>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon">⚡</div>
          <div className="landing-feature-text">Realtime cập nhật</div>
        </div>
      </div>
      <div style={{ marginTop: 50, color: 'var(--text-muted)', fontSize: 12 }}>
        <p>📱 QR code sẽ dẫn đến: /order?room=1 ... /order?room=10</p>
      </div>
    </div>
  )
}