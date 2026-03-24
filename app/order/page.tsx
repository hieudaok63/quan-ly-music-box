'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { MenuItem, Order, OrderItem, Message } from '../../lib/types'
import { useCartStore } from '../../lib/store'

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
        setMessages(prev => [...prev, payload.new as Message])
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
          // Auto-hide after 2s
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

  // Load my orders for this room
  useEffect(() => {
    if (!room) return
    supabase.from('orders').select('*')
      .eq('room_id', room)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(async (r) => {
        const orders = r.data || []
        setMyOrders(orders)
        // Load order items for all orders
        if (orders.length > 0) {
          const { data: items } = await supabase
            .from('order_items')
            .select('*, menu_items(*)')
            .in('order_id', orders.filter(o => o.status !== 'cancelled').map(o => o.id))
          setOrderedItems(items || [])
        }
      })

    const ch = supabase.channel(`orders-room-${room}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'orders',
        filter: `room_id=eq.${room}`
      }, async (payload) => {
        if (payload.eventType === 'UPDATE') {
          setMyOrders(prev => prev.map(o => o.id === (payload.new as Order).id ? payload.new as Order : o))
        }
        if (payload.eventType === 'INSERT') {
          setMyOrders(prev => [payload.new as Order, ...prev])
          // Reload items after a short delay
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

    return () => { supabase.removeChannel(ch) }
  }, [room])

  // Auto scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, adminTyping])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // Broadcast typing event
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

  // Debounced typing handler
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
    const { data, error: orderError } = await supabase.from('orders')
      .insert([{ room_id: room, status: 'pending' }]).select().single()

    if (orderError || !data) {
      console.error('Order insert error:', orderError)
      showToast('❌ Lỗi khi gửi đơn hàng!')
      return
    }

    // Try with note column first
    const itemsWithNote = cart.items.map(i => ({
      order_id: data.id,
      menu_item_id: i.id,
      quantity: i.quantity,
      note: i.note || null,
    }))

    let { error: itemsError } = await supabase.from('order_items').insert(itemsWithNote)

    // Fallback: if note column doesn't exist, insert without it
    if (itemsError) {
      console.warn('Insert with note failed, trying without:', itemsError.message)
      const itemsWithoutNote = cart.items.map(i => ({
        order_id: data.id,
        menu_item_id: i.id,
        quantity: i.quantity,
      }))
      const { error: fallbackError } = await supabase.from('order_items').insert(itemsWithoutNote)
      if (fallbackError) {
        console.error('Order items insert error:', fallbackError)
        showToast('⚠️ Đơn hàng đã tạo nhưng lỗi chi tiết!')
        return
      }
    }

    setMyOrders(prev => [data, ...prev])
    cart.clearCart()
    setShowCart(false)
    showToast('✅ Đã gửi đơn hàng thành công!')
  }

  const sendMessage = async () => {
    if (!chatInput.trim() || !room) return
    broadcastStopTyping()
    await supabase.from('messages').insert([{
      room_id: room,
      content: chatInput.trim(),
      sender: 'customer',
    }])
    setChatInput('')
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

  // Aggregate ordered items across all orders
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

      {/* Header */}
      <div className="header">
        <div className="header-logo">🎵 Music Box</div>
        <div className="header-sub">Phòng {room} • Chọn món yêu thích</div>
      </div>

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

      {/* ===== ORDERED ITEMS SUMMARY ===== */}
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
      <div className="menu-grid">
        {menu.map(item => {
          const inCart = cart.items.find(c => c.id === item.id)
          return (
            <div key={item.id} className="menu-item">
              <img
                src={item.image_url || 'https://placehold.co/80x80/1a1a2e/e8e8f0?text=🍽️'}
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
              {/* Typing Indicator */}
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