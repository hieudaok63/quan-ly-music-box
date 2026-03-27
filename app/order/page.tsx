'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { MenuItem, Order, OrderItem, Message } from '../../lib/types'
import { useCartStore } from '../../lib/store'

// ===== SPIN WHEEL DATA =====
type WheelItem = { emoji: string; label: string; type: string; color: string }
const ALL_WHEEL_ITEMS: WheelItem[] = [
  { emoji: '🎁', label: 'Giảm 10% đồ uống', type: 'reward', color: '#ff6b35' },
  { emoji: '🎤', label: 'Hát bài vui nhất bạn biết!', type: 'challenge', color: '#4361ee' },
  { emoji: '💃', label: 'Múa 1 điệu cho cả nhóm!', type: 'punishment', color: '#e91e63' },
  { emoji: '🍻', label: 'Bao nước cả nhóm!', type: 'upsale', color: '#2d6a4f' },
  { emoji: '🎁', label: 'Tặng 1 đĩa snack miễn phí', type: 'reward', color: '#f9a825' },
  { emoji: '🎤', label: 'Hát 1 bài giọng opera', type: 'challenge', color: '#00b4d8' },
  { emoji: '🎲', label: 'Oẳn tù tì: thua hát solo', type: 'game', color: '#9c27b0' },
  { emoji: '🍻', label: 'Đặt thêm combo snack!', type: 'upsale', color: '#ff6b35' },
  { emoji: '💃', label: 'Làm mặt hài, nhóm chấm điểm', type: 'punishment', color: '#e67e22' },
  { emoji: '🎤', label: 'Song ca với người bên cạnh', type: 'challenge', color: '#4361ee' },
  { emoji: '🎁', label: 'Mua 2 tặng 1 đồ uống', type: 'reward', color: '#2d6a4f' },
  { emoji: '🎲', label: 'Kể chuyện hài 30 giây', type: 'game', color: '#00b4d8' },
  { emoji: '💃', label: 'Nhảy TikTok trending!', type: 'punishment', color: '#e91e63' },
  { emoji: '🍻', label: 'Mời người bên phải 1 ly', type: 'upsale', color: '#f9a825' },
  { emoji: '🎤', label: 'Hát chỉ dùng nguyên âm', type: 'challenge', color: '#9c27b0' },
  { emoji: '🎁', label: 'Thêm 15 phút hát miễn phí', type: 'reward', color: '#ff6b35' },
  { emoji: '🎲', label: 'Bắt chước giọng ca sĩ', type: 'game', color: '#4361ee' },
  { emoji: '💃', label: 'Diễn lại cảnh phim nổi tiếng', type: 'punishment', color: '#e67e22' },
  { emoji: '🎤', label: 'Hát rap về cả nhóm!', type: 'challenge', color: '#2d6a4f' },
  { emoji: '⭐', label: 'JACKPOT: Giảm 20% tổng bill!', type: 'jackpot', color: '#ff6b35' },
]

export default function OrderPage() {
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [chatInput, setChatInput] = useState('')
  const [myOrders, setMyOrders] = useState<Order[]>([])
  const [orderedItems, setOrderedItems] = useState<OrderItem[]>([])
  const [toast, setToast] = useState('')
  const [room, setRoom] = useState<string | null>(null)
  const [adminTyping, setAdminTyping] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'order' | 'game'>('order')

  // Game state
  const [isSpinning, setIsSpinning] = useState(false)
  const [wheelRotation, setWheelRotation] = useState(0)
  const [remainingItems, setRemainingItems] = useState<WheelItem[]>([...ALL_WHEEL_ITEMS])
  const [gameResult, setGameResult] = useState<WheelItem | null>(null)
  const [spinHistory, setSpinHistory] = useState<{ item: WheelItem; time: string }[]>([])
  const [showConfetti, setShowConfetti] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)

  const cart = useCartStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const typingChannelRef = useRef<any>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setRoom(params.get('room'))
  }, [])

  // Load menu
  useEffect(() => {
    supabase.from('menu_items').select('*').then(r => setMenu(r.data || []))
  }, [])

  // Load messages for room + realtime
  useEffect(() => {
    if (!room) return
    supabase.from('messages').select('*')
      .eq('room_id', room)
      .order('created_at', { ascending: true })
      .then(r => setMessages(r.data || []))

    const ch = supabase.channel(`chat-room-${room}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `room_id=eq.${room}`
      }, payload => {
        const newMsg = payload.new as Message
        setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
      })
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [room])

  // Typing indicator channel (broadcast)
  useEffect(() => {
    if (!room) return

    const typingCh = supabase.channel(`typing-room-${room}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.sender === 'admin') {
          setAdminTyping(true)
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = setTimeout(() => setAdminTyping(false), 2000)
        }
      })
      .on('broadcast', { event: 'stop_typing' }, (payload) => {
        if (payload.payload?.sender === 'admin') {
          setAdminTyping(false)
        }
      })
      .subscribe()

    typingChannelRef.current = typingCh

    return () => {
      supabase.removeChannel(typingCh)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    }
  }, [room])

  // Load my orders for this room + active session
  useEffect(() => {
    if (!room) return

    const loadSessionOrders = async () => {
      const { data: sessions } = await supabase
        .from('room_sessions')
        .select('*')
        .eq('room_id', room)
        .eq('status', 'active')
        .limit(1)

      const activeSessionId = sessions?.[0]?.id || null

      if (activeSessionId) {
        const { data: ordersData } = await supabase.from('orders').select('*')
          .eq('room_id', room).eq('session_id', activeSessionId)
          .order('created_at', { ascending: false }).limit(20)
        const orders = ordersData || []
        setMyOrders(orders)

        const nonCancelled = orders.filter(o => o.status !== 'cancelled')
        if (nonCancelled.length > 0) {
          const { data: items } = await supabase
            .from('order_items')
            .select('*, menu_items(*)')
            .in('order_id', nonCancelled.map(o => o.id))
          setOrderedItems(items || [])
        } else {
          setOrderedItems([])
        }
      } else {
        setMyOrders([])
        setOrderedItems([])
      }
    }

    loadSessionOrders()

    const orderCh = supabase.channel(`orders-room-${room}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'orders',
        filter: `room_id=eq.${room}`
      }, async (payload) => {
        if (payload.eventType === 'UPDATE') {
          setMyOrders(prev => prev.map(o => o.id === (payload.new as Order).id ? payload.new as Order : o))
        }
        if (payload.eventType === 'INSERT') {
          setMyOrders(prev => [payload.new as Order, ...prev])
          setTimeout(async () => {
            const { data: items } = await supabase
              .from('order_items')
              .select('*, menu_items(*)')
              .eq('order_id', (payload.new as Order).id)
            if (items) setOrderedItems(prev => [...prev, ...items])
          }, 500)
        }
      })
      .subscribe()

    const sessionCh = supabase.channel(`session-room-${room}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'room_sessions',
        filter: `room_id=eq.${room}`
      }, (payload) => {
        if (payload.eventType === 'UPDATE' && (payload.new as any).status === 'closed') {
          cart.clearCart()
          setShowCart(false)
          showToast('🔒 Phòng đã đóng! Cảm ơn quý khách.')
          // Reset game state on room close
          setRemainingItems([...ALL_WHEEL_ITEMS])
          setSpinHistory([])
        }
        if (payload.eventType === 'DELETE') {
          cart.clearCart()
          setShowCart(false)
          setMyOrders([])
          setOrderedItems([])
          setMessages([])
          setRemainingItems([...ALL_WHEEL_ITEMS])
          setSpinHistory([])
          showToast('📊 Ngày mới đã bắt đầu!')
        }
        loadSessionOrders()
        supabase.from('messages').select('*').eq('room_id', room)
          .order('created_at', { ascending: true })
          .then(r => setMessages(r.data || []))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(orderCh)
      supabase.removeChannel(sessionCh)
    }
  }, [room])

  // Auto scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, adminTyping])

  // Draw wheel on canvas (redraws when items change)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || remainingItems.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 320
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = size + 'px'
    canvas.style.height = size + 'px'
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const r = size / 2 - 4
    const sliceAngle = (2 * Math.PI) / remainingItems.length

    remainingItems.forEach((item, i) => {
      const startAngle = i * sliceAngle - Math.PI / 2
      const endAngle = startAngle + sliceAngle

      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, r, startAngle, endAngle)
      ctx.closePath()
      ctx.fillStyle = i % 2 === 0 ? item.color : adjustColor(item.color, 30)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Draw emoji (bigger when fewer items)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(startAngle + sliceAngle / 2)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const fontSize = remainingItems.length <= 5 ? 28 : remainingItems.length <= 10 ? 22 : 18
      ctx.font = `${fontSize}px serif`
      ctx.fillText(item.emoji, r * 0.65, 0)
      ctx.restore()
    })

    // Center circle
    ctx.beginPath()
    ctx.arc(cx, cy, 32, 0, 2 * Math.PI)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'
    ctx.lineWidth = 2
    ctx.stroke()
  }, [activeTab, remainingItems])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const broadcastTyping = useCallback(() => {
    if (typingChannelRef.current) {
      typingChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { sender: 'customer', room_id: room }
      })
    }
  }, [room])

  const broadcastStopTyping = useCallback(() => {
    if (typingChannelRef.current) {
      typingChannelRef.current.send({
        type: 'broadcast',
        event: 'stop_typing',
        payload: { sender: 'customer', room_id: room }
      })
    }
  }, [room])

  const handleInputChange = (value: string) => {
    setChatInput(value)
    if (value.trim()) {
      broadcastTyping()
    } else {
      broadcastStopTyping()
    }
  }

  const submitOrder = async () => {
    if (cart.items.length === 0) return

    const { data: sessions } = await supabase
      .from('room_sessions')
      .select('id')
      .eq('room_id', room)
      .eq('status', 'active')
      .limit(1)

    const sessionId = sessions?.[0]?.id || null

    const { data, error: orderError } = await supabase.from('orders')
      .insert([{ room_id: room, session_id: sessionId, status: 'pending' }]).select().single()

    if (orderError || !data) {
      console.error('Order insert error:', orderError)
      showToast('❌ Lỗi khi gửi đơn hàng!')
      return
    }

    const itemsData = cart.items.map(i => ({
      order_id: data.id,
      menu_item_id: i.id,
      quantity: i.quantity,
      note: i.note || null,
    }))

    const { error: itemsError } = await supabase.from('order_items').insert(itemsData)

    if (itemsError) {
      const itemsNoNote = cart.items.map(i => ({
        order_id: data.id, menu_item_id: i.id, quantity: i.quantity,
      }))
      await supabase.from('order_items').insert(itemsNoNote)
    }

    setMyOrders(prev => [data, ...prev])
    cart.clearCart()
    setShowCart(false)
    showToast('✅ Đã gửi đơn hàng thành công!')
  }

  const sendMessage = async () => {
    if (!chatInput.trim() || !room) return
    broadcastStopTyping()
    const msgContent = chatInput.trim()
    setChatInput('')
    const { data } = await supabase.from('messages').insert([{
      room_id: room,
      content: msgContent,
      sender: 'customer',
    }]).select().single()
    if (data) setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data])
  }

  // ===== SPIN WHEEL LOGIC =====
  const spinWheel = () => {
    if (isSpinning || remainingItems.length === 0) return

    setIsSpinning(true)
    const winIndex = Math.floor(Math.random() * remainingItems.length)
    const sliceAngle = 360 / remainingItems.length
    const targetAngle = 360 - (winIndex * sliceAngle + sliceAngle / 2)
    const fullSpins = 5 + Math.floor(Math.random() * 3)
    const finalRotation = wheelRotation + fullSpins * 360 + targetAngle - (wheelRotation % 360)
    setWheelRotation(finalRotation)

    const wonItem = remainingItems[winIndex]
    setTimeout(() => {
      setIsSpinning(false)
      setGameResult(wonItem)
      setSpinHistory(prev => [{
        item: wonItem,
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      }, ...prev])
      // Remove won item from remaining
      setRemainingItems(prev => prev.filter((_, i) => i !== winIndex))
      // Reset wheel rotation for clean redraw
      setWheelRotation(0)
      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 3000)
    }, 5000)
  }

  const formatPrice = (p: number) => p.toLocaleString('vi-VN') + 'đ'
  const formatTime = (t: string) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

  const getStatusLabel = (s: string) => {
    switch (s) {
      case 'pending': return '⏳ Chờ xác nhận'
      case 'preparing': return '🔥 Đang pha chế'
      case 'done': return '✅ Hoàn thành'
      case 'cancelled': return '❌ Đã huỷ'
      default: return s
    }
  }

  const aggregatedItems = orderedItems.reduce<Record<string, { name: string; quantity: number; price: number; note?: string[] }>>((acc, item) => {
    const name = item.menu_items?.name || 'Unknown'
    const price = item.menu_items?.price || 0
    if (!acc[name]) {
      acc[name] = { name, quantity: 0, price, note: [] }
    }
    acc[name].quantity += item.quantity
    if (item.note) acc[name].note!.push(item.note)
    return acc
  }, {})
  const aggregatedList = Object.values(aggregatedItems)
  const totalOrdered = aggregatedList.reduce((s, i) => s + i.price * i.quantity, 0)

  if (!room) return <div className="page-container"><p>Đang tải...</p></div>

  return (
    <div className="page-container" style={{ paddingBottom: cart.totalItems() > 0 ? 80 : 20 }}>
      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Confetti */}
      {showConfetti && (
        <div className="confetti-container">
          {Array.from({ length: 50 }).map((_, i) => (
            <div
              key={i}
              className="confetti"
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 1}s`,
                animationDuration: `${2 + Math.random() * 2}s`,
                backgroundColor: ['#ff6b35', '#f9a825', '#4361ee', '#e91e63', '#2d6a4f', '#00b4d8'][Math.floor(Math.random() * 6)],
                borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                width: `${6 + Math.random() * 8}px`,
                height: `${6 + Math.random() * 8}px`,
              }}
            />
          ))}
        </div>
      )}

      {/* Header */}
      <div className="header">
        <div className="header-logo">🎵 Music Box</div>
        <div className="header-sub">Phòng {room} • Chọn món yêu thích</div>
      </div>

      {/* Customer Tabs */}
      <div className="customer-tabs">
        <button className={`customer-tab ${activeTab === 'order' ? 'active' : ''}`} onClick={() => setActiveTab('order')}>
          🍽️ Đặt món
        </button>
        <button className={`customer-tab ${activeTab === 'game' ? 'active' : ''}`} onClick={() => setActiveTab('game')}>
          🎰 Trò chơi
        </button>
      </div>

      {/* ===== ORDER TAB ===== */}
      {activeTab === 'order' && (
        <>
          {/* Active Orders */}
          {myOrders.filter(o => o.status !== 'done' && o.status !== 'cancelled').length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {myOrders.filter(o => o.status !== 'done' && o.status !== 'cancelled').map(o => (
                <div key={o.id} className="order-status-bar">
                  <div className="order-status-title">Đơn hàng #{o.id.slice(0, 8)}</div>
                  <div className="status-steps">
                    <div className={`status-step ${['pending', 'preparing', 'done'].includes(o.status) ? 'active' : ''}`} />
                    <div className={`status-step ${['preparing', 'done'].includes(o.status) ? 'active' : ''}`} />
                    <div className={`status-step ${o.status === 'done' ? 'done' : ''}`} />
                  </div>
                  <div className="status-label">{getStatusLabel(o.status)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Ordered Items Summary */}
          {aggregatedList.length > 0 && (
            <div className="ordered-summary">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                📋 Đã đặt
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>({orderedItems.reduce((s, i) => s + i.quantity, 0)} món)</span>
              </h3>
              <div className="ordered-items-list">
                {aggregatedList.map((item, idx) => (
                  <div key={idx} className="ordered-item-row">
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600 }}>{item.name}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>×{item.quantity}</span>
                      {item.note && item.note.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--accent-gold)', fontStyle: 'italic', marginTop: 2 }}>
                          📝 {item.note.join(', ')}
                        </div>
                      )}
                    </div>
                    <span style={{ fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}>{formatPrice(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="ordered-total-row">
                <span>Tổng đã đặt</span>
                <span>{formatPrice(totalOrdered)}</span>
              </div>
            </div>
          )}

          {/* Menu */}
          <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700 }}>📋 Thực đơn</h2>
          <div className="search-bar">
            <input
              placeholder="Tìm kiếm món..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="menu-grid">
            {menu.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase())).map(item => {
              const inCart = cart.items.find(c => c.id === item.id)
              return (
                <div key={item.id} className="menu-item">
                  <img
                    src={item.image_url || 'https://placehold.co/80x80/16162a/e8e8f0?text=🍽️'}
                    alt={item.name}
                    className="menu-item-img"
                  />
                  <div className="menu-item-info">
                    <div className="menu-item-name">{item.name}</div>
                    <div className="menu-item-price">{formatPrice(item.price)}</div>
                  </div>
                  <div className="menu-item-actions">
                    {inCart ? (
                      <div className="qty-control">
                        <button className="btn-icon" onClick={() => cart.updateQuantity(item.id, inCart.quantity - 1)}>−</button>
                        <span className="qty-value">{inCart.quantity}</span>
                        <button className="btn-icon accent" onClick={() => cart.updateQuantity(item.id, inCart.quantity + 1)}>+</button>
                      </div>
                    ) : (
                      <button className="btn-icon accent" onClick={() => cart.addItem(item)}>+</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ===== GAME TAB ===== */}
      {activeTab === 'game' && (
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🎰 Vòng Quay May Mắn</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
            Quay để nhận phần quà hoặc thử thách vui nhộn!
          </p>

          {/* Items remaining */}
          <div style={{ marginBottom: 20 }}>
            <div className="spins-remaining">
              🎯 Còn <span className="count">{remainingItems.length}</span> / {ALL_WHEEL_ITEMS.length} thử thách
            </div>
          </div>

          {/* Wheel */}
          {remainingItems.length > 0 ? (
            <div className="wheel-container">
              <div className="wheel-pointer">📍</div>
              <canvas
                ref={canvasRef}
                className={`wheel-canvas ${isSpinning ? 'spinning' : ''}`}
                style={{ transform: `rotate(${wheelRotation}deg)` }}
              />
              <button
                className="wheel-center-btn"
                onClick={spinWheel}
                disabled={isSpinning}
              >
                {isSpinning ? '...' : 'QUAY!'}
              </button>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: 'var(--accent)' }}>Hết thử thách!</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Cả nhóm đã hoàn thành tất cả {ALL_WHEEL_ITEMS.length} thử thách!<br />
                Hãy thực hiện và đặt thêm đồ ngon nhé! 🍹
              </div>
            </div>
          )}

          {/* Spin History */}
          {spinHistory.length > 0 && (
            <div className="spin-history">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, textAlign: 'left' }}>📜 Kết quả ({spinHistory.length}/{ALL_WHEEL_ITEMS.length})</h3>
              {spinHistory.map((entry, idx) => (
                <div key={idx} className="spin-history-item">
                  <span className="spin-history-emoji">{entry.item.emoji}</span>
                  <span className="spin-history-text">{entry.item.label}</span>
                  <span className="spin-history-time">{entry.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Game Result Popup */}
      {gameResult && (
        <div className="game-result-overlay" onClick={() => setGameResult(null)}>
          <div className="game-result-card" onClick={e => e.stopPropagation()}>
            <div className="game-result-emoji">{gameResult.emoji}</div>
            <div className="game-result-title">
              {gameResult.type === 'jackpot' ? '🎉 JACKPOT!' :
               gameResult.type === 'reward' ? '🎁 Phần Quà!' :
               gameResult.type === 'upsale' ? '🍻 Thử Thách Nhóm!' :
               gameResult.type === 'challenge' ? '🎤 Thử Thách!' :
               gameResult.type === 'game' ? '🎲 Trò Chơi!' :
               '💃 Hình Phạt!'}
            </div>
            <div className="game-result-desc">{gameResult.label}</div>
            <button
              className="btn btn-primary btn-block"
              style={{ padding: '14px 24px', fontSize: 16 }}
              onClick={() => setGameResult(null)}
            >
              OK, hiểu rồi! 🔥
            </button>
          </div>
        </div>
      )}

      {/* Cart Bar */}
      {cart.totalItems() > 0 && (
        <div className="cart-bar" onClick={() => setShowCart(true)}>
          <div className="cart-bar-info">
            <span className="cart-bar-count">🛒 {cart.totalItems()} món</span>
            <span className="cart-bar-total">{formatPrice(cart.totalPrice())}</span>
          </div>
          <button className="btn btn-primary">Xem giỏ hàng</button>
        </div>
      )}

      {/* Cart Sheet */}
      {showCart && (
        <>
          <div className="cart-overlay" onClick={() => setShowCart(false)} />
          <div className="cart-sheet">
            <div className="cart-sheet-header">
              <span className="cart-sheet-title">🛒 Giỏ hàng</span>
              <button className="btn-icon" onClick={() => setShowCart(false)}>✕</button>
            </div>
            <div className="cart-sheet-body">
              {cart.items.map(item => (
                <div key={item.id} className="cart-item">
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.name}</div>
                    <div className="cart-item-price">{formatPrice(item.price * item.quantity)}</div>
                    <textarea
                      className="cart-item-note"
                      placeholder="Ghi chú (ít đá, nhiều đường...)"
                      rows={1}
                      value={item.note || ''}
                      onChange={e => cart.updateNote(item.id, e.target.value)}
                    />
                  </div>
                  <div className="qty-control">
                    <button className="btn-icon" onClick={() => cart.updateQuantity(item.id, item.quantity - 1)}>−</button>
                    <span className="qty-value">{item.quantity}</span>
                    <button className="btn-icon" onClick={() => cart.updateQuantity(item.id, item.quantity + 1)}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="cart-sheet-footer">
              <div className="cart-total-row">
                <span>Tổng cộng</span>
                <span className="cart-total-price">{formatPrice(cart.totalPrice())}</span>
              </div>
              <button className="btn btn-primary btn-block" style={{ padding: '14px', fontSize: 16 }} onClick={submitOrder}>
                Gửi đơn hàng
              </button>
            </div>
          </div>
        </>
      )}

      {/* Chat Toggle */}
      <button
        className="chat-toggle"
        style={{ bottom: cart.totalItems() > 0 ? 80 : 20 }}
        onClick={() => setShowChat(!showChat)}
      >
        💬
      </button>

      {/* Chat Panel */}
      {showChat && (
        <>
          <div className="cart-overlay" onClick={() => setShowChat(false)} />
          <div className="chat-panel">
            <div className="chat-header">
              <h3>💬 Chat với quán</h3>
              <button className="btn-icon" onClick={() => setShowChat(false)}>✕</button>
            </div>
            <div className="chat-messages">
              {messages.length === 0 && !adminTyping && (
                <div className="empty-state" style={{ padding: 30 }}>
                  <div className="empty-state-icon">💬</div>
                  <div className="empty-state-text">Gửi tin nhắn để liên hệ quán</div>
                </div>
              )}
              {messages.map(m => (
                <div key={m.id} className={`chat-msg ${m.sender}`}>
                  <div>{m.content}</div>
                  <div className="chat-msg-time">{formatTime(m.created_at)}</div>
                </div>
              ))}
              {adminTyping && (
                <div className="typing-indicator">
                  <span className="typing-indicator-label">Admin</span>
                  <div className="typing-dots">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-row">
              <input
                className="chat-input"
                placeholder="Nhập tin nhắn..."
                value={chatInput}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
              />
              <button className="chat-send" onClick={sendMessage}>➤</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Helper: lighten/darken color
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, ((num >> 16) & 0xff) + amount)
  const g = Math.min(255, ((num >> 8) & 0xff) + amount)
  const b = Math.min(255, (num & 0xff) + amount)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}