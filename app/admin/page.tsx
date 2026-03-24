'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { MenuItem, Order, OrderItem, Message, RoomPricing, RoomSession, DailyReport } from '../../lib/types'
import { calculateCurrentCost, calculateRoomCost, formatDuration, DEFAULT_PRICING, parseSupabaseTimestamp } from '../../lib/roomUtils'

const ROOMS = Array.from({ length: 10 }, (_, i) => String(i + 1))

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'rooms' | 'orders' | 'menu' | 'chat' | 'revenue' | 'history'>('rooms')

  // Data state
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({})
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedRoom, setSelectedRoom] = useState<string>('1')
  const [chatInput, setChatInput] = useState('')
  const [toast, setToast] = useState('')

  // Menu modal
  const [showMenuModal, setShowMenuModal] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [formData, setFormData] = useState({ name: '', price: '', image_url: '' })

  // Typing
  const [customerTyping, setCustomerTyping] = useState<Record<string, boolean>>({})

  // Room/Revenue state
  const [roomPricing, setRoomPricing] = useState<Record<string, RoomPricing>>({})
  const [roomSessions, setRoomSessions] = useState<RoomSession[]>([])
  const [dailyReports, setDailyReports] = useState<DailyReport[]>([])
  const [timerTick, setTimerTick] = useState(0)
  const [showPricingModal, setShowPricingModal] = useState(false)
  const [pricingRoom, setPricingRoom] = useState('')
  const [pricingForm, setPricingForm] = useState({ day_rate: '', night_rate: '', day_start_hour: '', night_start_hour: '' })
  const [confirmClose, setConfirmClose] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({})
  const typingChannelsRef = useRef<Record<string, any>>({})

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // Timer tick every second for live cost display
  useEffect(() => {
    const interval = setInterval(() => setTimerTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  // ===== LOAD ORDER ITEMS HELPER =====
  const loadOrderItems = async (orderIds: string[]) => {
    if (orderIds.length === 0) return
    const { data: items, error } = await supabase
      .from('order_items')
      .select('*, menu_items(*)')
      .in('order_id', orderIds)

    if (error) {
      console.error('Error loading order items:', error)
      return
    }

    const grouped: Record<string, OrderItem[]> = {}
    items?.forEach((item: any) => {
      if (!grouped[item.order_id]) grouped[item.order_id] = []
      grouped[item.order_id].push(item)
    })
    setOrderItems(prev => ({ ...prev, ...grouped }))
  }

  // ===== LOAD ORDERS =====
  useEffect(() => {
    const loadOrders = async () => {
      const { data } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })

      if (data) {
        setOrders(data)
        await loadOrderItems(data.map(o => o.id))
      }
    }
    loadOrders()

    // Realtime: new orders + updates
    const ch = supabase.channel('admin-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
        const newOrder = payload.new as Order
        setOrders(prev => [newOrder, ...prev])
        // Wait a moment for order_items to be inserted, then load
        setTimeout(async () => {
          await loadOrderItems([newOrder.id])
        }, 500)
        showToast(`🔔 Đơn mới từ Phòng ${newOrder.room_id}!`)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        setOrders(prev => prev.map(o => o.id === (payload.new as Order).id ? payload.new as Order : o))
      })
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [])

  // ===== LOAD MENU =====
  useEffect(() => {
    supabase.from('menu_items').select('*').then(r => setMenuItems(r.data || []))
  }, [])

  // ===== LOAD MESSAGES + REALTIME =====
  useEffect(() => {
    supabase.from('messages').select('*').order('created_at', { ascending: true })
      .then(r => setMessages(r.data || []))

    const ch = supabase.channel('admin-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        payload => setMessages(prev => [...prev, payload.new as Message]))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // ===== LOAD ROOM PRICING =====
  useEffect(() => {
    supabase.from('room_pricing').select('*').then(r => {
      const map: Record<string, RoomPricing> = {}
      r.data?.forEach(p => { map[p.room_id] = p })
      setRoomPricing(map)
    })
  }, [])

  // ===== LOAD ROOM SESSIONS =====
  useEffect(() => {
    const loadSessions = async () => {
      // Load active sessions + today's closed sessions
      const { data } = await supabase
        .from('room_sessions')
        .select('*')
        .or('status.eq.active,created_at.gte.' + new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order('created_at', { ascending: false })
      setRoomSessions(data || [])
    }
    loadSessions()
  }, [])

  // ===== LOAD DAILY REPORTS =====
  useEffect(() => {
    supabase.from('daily_reports').select('*').order('report_date', { ascending: false }).limit(30)
      .then(r => setDailyReports(r.data || []))
  }, [])

  // ===== TYPING CHANNELS =====
  useEffect(() => {
    const channels: any[] = []
    ROOMS.forEach(roomId => {
      const typingCh = supabase.channel(`typing-room-${roomId}`)
        .on('broadcast', { event: 'typing' }, (payload) => {
          if (payload.payload?.sender === 'customer') {
            setCustomerTyping(prev => ({ ...prev, [roomId]: true }))
            if (typingTimeoutsRef.current[roomId]) clearTimeout(typingTimeoutsRef.current[roomId])
            typingTimeoutsRef.current[roomId] = setTimeout(() =>
              setCustomerTyping(prev => ({ ...prev, [roomId]: false })), 2000)
          }
        })
        .on('broadcast', { event: 'stop_typing' }, (payload) => {
          if (payload.payload?.sender === 'customer')
            setCustomerTyping(prev => ({ ...prev, [roomId]: false }))
        })
        .subscribe()
      typingChannelsRef.current[roomId] = typingCh
      channels.push(typingCh)
    })
    return () => {
      channels.forEach(ch => supabase.removeChannel(ch))
      Object.values(typingTimeoutsRef.current).forEach(t => clearTimeout(t))
    }
  }, [])

  // Auto scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, selectedRoom, activeTab, customerTyping])

  // =============== ROOM ACTIONS ===============

  const getActiveSession = (roomId: string) =>
    roomSessions.find(s => s.room_id === roomId && s.status === 'active')

  const getRoomPricing = (roomId: string): RoomPricing =>
    roomPricing[roomId] || { id: '', room_id: roomId, ...DEFAULT_PRICING }

  const checkInRoom = async (roomId: string) => {
    const { data } = await supabase.from('room_sessions')
      .insert([{ room_id: roomId, status: 'active' }]).select().single()
    if (data) {
      setRoomSessions(prev => [data, ...prev])
      showToast(`✅ Phòng ${roomId} đã mở!`)
    }
  }

  const checkOutRoom = async (session: RoomSession) => {
    const pricing = getRoomPricing(session.room_id)
    const totalAmount = calculateRoomCost(parseSupabaseTimestamp(session.check_in), new Date(), pricing)
    const { data } = await supabase.from('room_sessions')
      .update({ check_out: new Date().toISOString(), total_amount: totalAmount, status: 'closed' })
      .eq('id', session.id).select().single()
    if (data) {
      setRoomSessions(prev => prev.map(s => s.id === session.id ? data : s))
      showToast(`🔒 Phòng ${session.room_id} đã đóng! Tổng: ${formatPrice(totalAmount)}`)
    }
  }

  // =============== DAY START CUTOFF ===============

  const getDayStart = (): Date => {
    if (dailyReports.length > 0) {
      return parseSupabaseTimestamp(dailyReports[0].created_at)
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
  }

  // =============== REVENUE ===============

  const getTodayOrderRevenue = (roomId: string) => {
    const dayStart = getDayStart()
    return orders
      .filter(o => o.room_id === roomId && o.status !== 'cancelled' && parseSupabaseTimestamp(o.created_at) >= dayStart)
      .reduce((sum, o) => {
        const items = orderItems[o.id] || []
        return sum + items.reduce((s, i) => s + (i.menu_items?.price || 0) * i.quantity, 0)
      }, 0)
  }

  const getTodayRoomRevenue = (roomId: string) => {
    const dayStart = getDayStart()
    return roomSessions
      .filter(s => s.room_id === roomId && parseSupabaseTimestamp(s.created_at) >= dayStart)
      .reduce((sum, s) => {
        if (s.status === 'closed') return sum + s.total_amount
        return sum + calculateCurrentCost(s.check_in, getRoomPricing(roomId))
      }, 0)
  }

  const currentOrders = orders.filter(o => parseSupabaseTimestamp(o.created_at) >= getDayStart())
  const totalRoomRevenue = ROOMS.reduce((s, r) => s + getTodayRoomRevenue(r), 0)
  const totalOrderRevenue = ROOMS.reduce((s, r) => s + getTodayOrderRevenue(r), 0)
  const totalRevenue = totalRoomRevenue + totalOrderRevenue
  const hasActiveRooms = roomSessions.some(s => s.status === 'active')

  // =============== CLOSE DAY ===============

  const closeDay = async () => {
    // Close all active rooms first
    const activeSessions = roomSessions.filter(s => s.status === 'active')
    for (const session of activeSessions) {
      await checkOutRoom(session)
    }

    const finalRoomRev = ROOMS.reduce((s, r) => s + getTodayRoomRevenue(r), 0)
    const finalOrderRev = ROOMS.reduce((s, r) => s + getTodayOrderRevenue(r), 0)

    const details = ROOMS.map(r => ({
      room_id: r,
      room_revenue: getTodayRoomRevenue(r),
      order_revenue: getTodayOrderRevenue(r),
      total: getTodayRoomRevenue(r) + getTodayOrderRevenue(r),
    }))

    const { data } = await supabase.from('daily_reports').insert([{
      report_date: new Date().toISOString().split('T')[0],
      total_room_revenue: finalRoomRev,
      total_order_revenue: finalOrderRev,
      total_revenue: finalRoomRev + finalOrderRev,
      details,
    }]).select().single()

    if (data) {
      setDailyReports(prev => [data, ...prev])
      setRoomSessions([])
      showToast('✅ Đã chốt doanh thu! Bắt đầu ngày mới.')
      setConfirmClose(false)
    }
  }

  // =============== ORDER STATUS ===============

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('orders').update({ status }).eq('id', id)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: status as any } : o))
  }

  // =============== CHAT ===============

  const broadcastTyping = useCallback(() => {
    typingChannelsRef.current[selectedRoom]?.send({
      type: 'broadcast', event: 'typing',
      payload: { sender: 'admin', room_id: selectedRoom }
    })
  }, [selectedRoom])

  const broadcastStopTyping = useCallback(() => {
    typingChannelsRef.current[selectedRoom]?.send({
      type: 'broadcast', event: 'stop_typing',
      payload: { sender: 'admin', room_id: selectedRoom }
    })
  }, [selectedRoom])

  const handleChatInput = (value: string) => {
    setChatInput(value)
    value.trim() ? broadcastTyping() : broadcastStopTyping()
  }

  const sendMessage = async () => {
    if (!chatInput.trim()) return
    broadcastStopTyping()
    await supabase.from('messages').insert([{
      room_id: selectedRoom, content: chatInput.trim(), sender: 'admin'
    }])
    setChatInput('')
  }

  // =============== MENU CRUD ===============

  const saveMenuItem = async () => {
    if (!formData.name || !formData.price) return
    const item = { name: formData.name, price: Number(formData.price), image_url: formData.image_url || null }
    if (editingItem) {
      await supabase.from('menu_items').update(item).eq('id', editingItem.id)
      setMenuItems(prev => prev.map(m => m.id === editingItem.id ? { ...m, ...item } : m))
      showToast('✅ Đã cập nhật!')
    } else {
      const { data } = await supabase.from('menu_items').insert([item]).select().single()
      if (data) setMenuItems(prev => [...prev, data])
      showToast('✅ Đã thêm món!')
    }
    setShowMenuModal(false)
    setEditingItem(null)
    setFormData({ name: '', price: '', image_url: '' })
  }

  const deleteMenuItem = async (id: string) => {
    await supabase.from('menu_items').delete().eq('id', id)
    setMenuItems(prev => prev.filter(m => m.id !== id))
    showToast('🗑️ Đã xoá!')
  }

  // =============== PRICING MODAL ===============

  const openPricingModal = (roomId: string) => {
    const p = getRoomPricing(roomId)
    setPricingRoom(roomId)
    setPricingForm({
      day_rate: String(p.day_rate), night_rate: String(p.night_rate),
      day_start_hour: String(p.day_start_hour), night_start_hour: String(p.night_start_hour)
    })
    setShowPricingModal(true)
  }

  const savePricing = async () => {
    const item = {
      room_id: pricingRoom,
      day_rate: Number(pricingForm.day_rate), night_rate: Number(pricingForm.night_rate),
      day_start_hour: Number(pricingForm.day_start_hour), night_start_hour: Number(pricingForm.night_start_hour),
    }
    const existing = roomPricing[pricingRoom]
    if (existing) {
      await supabase.from('room_pricing').update(item).eq('id', existing.id)
    } else {
      await supabase.from('room_pricing').insert([item])
    }
    const { data } = await supabase.from('room_pricing').select('*').eq('room_id', pricingRoom).single()
    if (data) setRoomPricing(prev => ({ ...prev, [pricingRoom]: data }))
    setShowPricingModal(false)
    showToast(`✅ Đã cập nhật giá Phòng ${pricingRoom}!`)
  }

  // =============== HELPERS ===============

  const formatPrice = (p: number) => p.toLocaleString('vi-VN') + 'đ'
  const formatTime = (t: string) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const formatDateTime = (t: string) => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  const formatDate = (t: string) => new Date(t).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })

  const pendingByRoom = (roomId: string) =>
    currentOrders.filter(o => o.room_id === roomId && (o.status === 'pending' || o.status === 'preparing')).length

  const roomMessages = messages.filter(m => m.room_id === selectedRoom)

  const getLiveTimer = (session: RoomSession) => { void timerTick; return formatDuration(session.check_in) }
  const getLiveCost = (session: RoomSession) => { void timerTick; return calculateCurrentCost(session.check_in, getRoomPricing(session.room_id)) }

  // =============== RENDER ===============

  return (
    <div className="admin-container">
      {toast && <div className="toast">{toast}</div>}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, background: 'linear-gradient(135deg, var(--accent), var(--accent-gold))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            🎵 Music Box Admin
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Quản lý phòng, đơn hàng & doanh thu</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="admin-tabs" style={{ maxWidth: 700 }}>
        {[
          { key: 'rooms', label: '🏠 Phòng' },
          { key: 'orders', label: `📋 Đơn hàng${currentOrders.filter(o => o.status === 'pending').length > 0 ? ` (${currentOrders.filter(o => o.status === 'pending').length})` : ''}` },
          { key: 'menu', label: '🍽️ Thực đơn' },
          { key: 'revenue', label: '💰 Doanh thu' },
          { key: 'history', label: '📊 Lịch sử' },
          { key: 'chat', label: '💬 Chat' },
        ].map(t => (
          <button key={t.key} className={`tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key as any)}>{t.label}</button>
        ))}
      </div>

      {/* ===================== ROOMS TAB ===================== */}
      {activeTab === 'rooms' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700 }}>Quản lý phòng</h2>
          <div className="room-grid">
            {ROOMS.map(r => {
              const session = getActiveSession(r)
              const pricing = getRoomPricing(r)
              const orderCount = pendingByRoom(r)
              return (
                <div key={r} className={`room-card ${session ? 'has-orders' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="room-card-number">P{r}</div>
                    {orderCount > 0 && <div className="room-card-badge">{orderCount} đơn</div>}
                  </div>
                  {session ? (
                    <>
                      <div className="room-timer">{getLiveTimer(session)}</div>
                      <div className="room-cost-live">~{formatPrice(getLiveCost(session))}</div>
                      <div className="room-card-actions-row">
                        <button className="btn btn-primary btn-sm" onClick={() => checkOutRoom(session)}>🔒 Đóng phòng</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="room-timer inactive">Trống</div>
                      <div className="room-card-actions-row">
                        <button className="btn btn-primary btn-sm" onClick={() => checkInRoom(r)}>▶️ Mở phòng</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => openPricingModal(r)}>⚙️</button>
                      </div>
                    </>
                  )}
                  <div className="room-pricing-info">
                    🌞 {formatPrice(pricing.day_rate)}/h ({pricing.day_start_hour}h-{pricing.night_start_hour}h)<br />
                    🌙 {formatPrice(pricing.night_rate)}/h ({pricing.night_start_hour}h-{pricing.day_start_hour}h)
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ===================== ORDERS TAB ===================== */}
      {activeTab === 'orders' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700 }}>
            Đơn hàng ({currentOrders.filter(o => o.status === 'pending').length} chờ)
          </h2>
          {currentOrders.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-text">Chưa có đơn hàng mới</div>
            </div>
          ) : (
            <div className="order-list">
              {currentOrders.map(o => {
                const items = orderItems[o.id] || []
                const orderTotal = items.reduce((s, i) => s + (i.menu_items?.price || 0) * i.quantity, 0)
                return (
                  <div key={o.id} className="order-card">
                    <div className="order-card-header">
                      <div>
                        <span className="order-card-room">🏠 Phòng {o.room_id}</span>
                        <span className="order-card-time" style={{ marginLeft: 12 }}>{formatDateTime(o.created_at)}</span>
                      </div>
                      <span className={`badge badge-${o.status}`}>{
                        o.status === 'pending' ? 'Chờ xác nhận' :
                        o.status === 'preparing' ? 'Đang làm' :
                        o.status === 'done' ? 'Hoàn thành' : 'Đã huỷ'
                      }</span>
                    </div>

                    {/* Order Items + Notes */}
                    <div className="order-card-items">
                      {items.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '4px 0' }}>
                          Đang tải chi tiết...
                        </div>
                      ) : (
                        items.map((item, idx) => (
                          <div key={idx}>
                            <div className="order-card-item">
                              <span>{item.menu_items?.name || '—'} × {item.quantity}</span>
                              <span style={{ fontWeight: 600 }}>
                                {item.menu_items ? formatPrice(item.menu_items.price * item.quantity) : ''}
                              </span>
                            </div>
                            {item.note && (
                              <div style={{
                                fontSize: 12, color: 'var(--accent-gold)', paddingLeft: 12,
                                marginBottom: 6, fontStyle: 'italic'
                              }}>
                                📝 {item.note}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {/* Order Total */}
                    {items.length > 0 && (
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 0', marginBottom: 8, borderTop: '1px solid var(--border)',
                        fontSize: 14, fontWeight: 700
                      }}>
                        <span>Tổng đơn</span>
                        <span style={{ color: 'var(--accent)' }}>{formatPrice(orderTotal)}</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="order-card-actions">
                      {o.status === 'pending' && (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => updateStatus(o.id, 'preparing')}>
                            🔥 Bắt đầu làm
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => updateStatus(o.id, 'cancelled')}>
                            ❌ Huỷ
                          </button>
                        </>
                      )}
                      {o.status === 'preparing' && (
                        <button className="btn btn-success btn-sm" onClick={() => updateStatus(o.id, 'done')}>
                          ✅ Hoàn thành
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================== MENU TAB ===================== */}
      {activeTab === 'menu' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>Quản lý thực đơn ({menuItems.length} món)</h2>
            <button className="btn btn-primary btn-sm" onClick={() => {
              setEditingItem(null); setFormData({ name: '', price: '', image_url: '' }); setShowMenuModal(true)
            }}>+ Thêm món</button>
          </div>
          <div className="menu-mgmt-grid">
            {menuItems.map(item => (
              <div key={item.id} className="menu-mgmt-card">
                <img src={item.image_url || 'https://placehold.co/260x140/1a1a2e/e8e8f0?text=🍽️'} alt={item.name} className="menu-mgmt-img" />
                <div className="menu-mgmt-name">{item.name}</div>
                <div className="menu-mgmt-price">{formatPrice(item.price)}</div>
                <div className="menu-mgmt-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => {
                    setEditingItem(item); setFormData({ name: item.name, price: String(item.price), image_url: item.image_url || '' }); setShowMenuModal(true)
                  }}>✏️ Sửa</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => deleteMenuItem(item.id)}>🗑️ Xoá</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== REVENUE TAB ===================== */}
      {activeTab === 'revenue' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700 }}>💰 Doanh thu hôm nay</h2>

          {/* Summary Cards */}
          <div className="revenue-summary">
            <div className="revenue-card">
              <div className="revenue-card-label">Tiền phòng hát</div>
              <div className="revenue-card-value">{formatPrice(totalRoomRevenue)}</div>
            </div>
            <div className="revenue-card">
              <div className="revenue-card-label">Đồ ăn & uống</div>
              <div className="revenue-card-value">{formatPrice(totalOrderRevenue)}</div>
            </div>
            <div className="revenue-card">
              <div className="revenue-card-label">Tổng doanh thu</div>
              <div className="revenue-card-value gold">{formatPrice(totalRevenue)}</div>
            </div>
          </div>

          {/* Detail Table */}
          <table className="revenue-table">
            <thead>
              <tr><th>Phòng</th><th>Tiền phòng</th><th>Đồ ăn/uống</th><th>Tổng</th><th>Trạng thái</th></tr>
            </thead>
            <tbody>
              {ROOMS.map(r => {
                const roomRev = getTodayRoomRevenue(r)
                const orderRev = getTodayOrderRevenue(r)
                const session = getActiveSession(r)
                return (
                  <tr key={r}>
                    <td style={{ fontWeight: 600 }}>Phòng {r}</td>
                    <td>{formatPrice(roomRev)}</td>
                    <td>{formatPrice(orderRev)}</td>
                    <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{formatPrice(roomRev + orderRev)}</td>
                    <td>{session ? <span className="badge badge-preparing">Đang mở</span> : <span className="badge badge-done">Trống</span>}</td>
                  </tr>
                )
              })}
              <tr className="total-row">
                <td>TỔNG</td>
                <td>{formatPrice(totalRoomRevenue)}</td>
                <td>{formatPrice(totalOrderRevenue)}</td>
                <td>{formatPrice(totalRevenue)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          {/* Close Day Button */}
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            {hasActiveRooms ? (
              <div>
                <button className="btn-close-day" disabled style={{ opacity: 0.5, cursor: 'not-allowed', transform: 'none' }}>
                  📊 Chốt doanh thu hôm nay
                </button>
                <p style={{ color: 'var(--warning)', fontSize: 13, marginTop: 12 }}>
                  ⚠️ Đóng tất cả phòng trước khi chốt ({roomSessions.filter(s => s.status === 'active').length} phòng đang mở)
                </p>
              </div>
            ) : (
              <button className="btn-close-day" onClick={() => setConfirmClose(true)}>
                📊 Chốt doanh thu hôm nay
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===================== HISTORY TAB ===================== */}
      {activeTab === 'history' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700 }}>📊 Lịch sử doanh thu</h2>
          {dailyReports.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-text">Chưa có báo cáo. Hãy chốt doanh thu cuối ngày.</div>
            </div>
          ) : (
            dailyReports.map(report => (
              <div key={report.id} className="history-card">
                <div className="history-card-header">
                  <div className="history-card-date">📅 {formatDate(report.report_date)}</div>
                  <div className="history-card-total">{formatPrice(report.total_revenue)}</div>
                </div>
                <div className="history-card-details">
                  <span>🏠 Phòng: {formatPrice(report.total_room_revenue)}</span>
                  <span>🍽️ Đồ ăn: {formatPrice(report.total_order_revenue)}</span>
                </div>
                {report.details && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>Xem chi tiết từng phòng</summary>
                    <table className="revenue-table" style={{ marginTop: 8 }}>
                      <thead><tr><th>Phòng</th><th>Tiền phòng</th><th>Đồ ăn</th><th>Tổng</th></tr></thead>
                      <tbody>
                        {(report.details as any[]).filter(d => d.total > 0).map((d: any) => (
                          <tr key={d.room_id}>
                            <td>P{d.room_id}</td>
                            <td>{formatPrice(d.room_revenue)}</td>
                            <td>{formatPrice(d.order_revenue)}</td>
                            <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{formatPrice(d.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================== CHAT TAB ===================== */}
      {activeTab === 'chat' && (
        <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 200px)' }}>
          {/* Room sidebar */}
          <div style={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>PHÒNG</h3>
            {ROOMS.map(r => {
              const count = messages.filter(m => m.room_id === r && m.sender === 'customer').length
              const isTyping = customerTyping[r]
              return (
                <button key={r} className={`chat-room-btn ${selectedRoom === r ? 'active' : ''}`}
                  style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => setSelectedRoom(r)}>
                  <span>Phòng {r}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {isTyping && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', animation: 'pulse 1s infinite' }} />}
                    {count > 0 && <span style={{ opacity: 0.7 }}>{count}</span>}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Chat panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div className="chat-header">
              <h3>💬 Phòng {selectedRoom}</h3>
              {customerTyping[selectedRoom] && (
                <span style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', animation: 'pulse 1s infinite' }} />
                  Khách đang nhập...
                </span>
              )}
            </div>
            <div className="chat-messages" style={{ flex: 1 }}>
              {roomMessages.length === 0 && !customerTyping[selectedRoom] && (
                <div className="empty-state" style={{ padding: 30 }}>
                  <div className="empty-state-icon">💬</div>
                  <div className="empty-state-text">Chưa có tin nhắn</div>
                </div>
              )}
              {roomMessages.map(m => (
                <div key={m.id} className={`chat-msg ${m.sender}`}>
                  <div>{m.content}</div>
                  <div className="chat-msg-time">{formatTime(m.created_at)}</div>
                </div>
              ))}
              {customerTyping[selectedRoom] && (
                <div className="typing-indicator">
                  <span className="typing-indicator-label">Khách</span>
                  <div className="typing-dots">
                    <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-row">
              <input className="chat-input" placeholder="Nhập tin nhắn..." value={chatInput}
                onChange={e => handleChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()} />
              <button className="chat-send" onClick={sendMessage}>➤</button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODALS ===================== */}

      {/* Menu Modal */}
      {showMenuModal && (
        <div className="modal-overlay" onClick={() => setShowMenuModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editingItem ? '✏️ Sửa món' : '➕ Thêm món mới'}</h3>
            <div className="form-group">
              <label className="form-label">Tên món</label>
              <input className="form-input" placeholder="VD: Trà sữa trân châu"
                value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Giá (VNĐ)</label>
              <input className="form-input" type="number" placeholder="VD: 45000"
                value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">URL hình ảnh</label>
              <input className="form-input" placeholder="https://..."
                value={formData.image_url} onChange={e => setFormData({ ...formData, image_url: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveMenuItem}>
                {editingItem ? 'Cập nhật' : 'Thêm món'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowMenuModal(false)}>Huỷ</button>
            </div>
          </div>
        </div>
      )}

      {/* Pricing Modal */}
      {showPricingModal && (
        <div className="modal-overlay" onClick={() => setShowPricingModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">⚙️ Giá Phòng {pricingRoom}</h3>
            <div className="pricing-grid">
              <div className="form-group">
                <label className="form-label">🌞 Giá ngày (VNĐ/h)</label>
                <input className="form-input" type="number" value={pricingForm.day_rate}
                  onChange={e => setPricingForm({ ...pricingForm, day_rate: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">🌙 Giá đêm (VNĐ/h)</label>
                <input className="form-input" type="number" value={pricingForm.night_rate}
                  onChange={e => setPricingForm({ ...pricingForm, night_rate: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Bắt đầu ngày (giờ)</label>
                <input className="form-input" type="number" min="0" max="23" value={pricingForm.day_start_hour}
                  onChange={e => setPricingForm({ ...pricingForm, day_start_hour: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Bắt đầu đêm (giờ)</label>
                <input className="form-input" type="number" min="0" max="23" value={pricingForm.night_start_hour}
                  onChange={e => setPricingForm({ ...pricingForm, night_start_hour: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={savePricing}>Lưu giá</button>
              <button className="btn btn-secondary" onClick={() => setShowPricingModal(false)}>Huỷ</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Close Day Modal */}
      {confirmClose && (
        <div className="modal-overlay" onClick={() => setConfirmClose(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">📊 Xác nhận chốt doanh thu</h3>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 2 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 12, textAlign: 'center' }}>
                {formatPrice(totalRevenue)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>🏠 Tiền phòng:</span><span style={{ fontWeight: 600 }}>{formatPrice(totalRoomRevenue)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>🍽️ Đồ ăn/uống:</span><span style={{ fontWeight: 600 }}>{formatPrice(totalOrderRevenue)}</span>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                • Dữ liệu lưu vào lịch sử<br />
                • Đơn hàng & phòng sẽ được reset<br />
                • Bắt đầu ngày kinh doanh mới
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-close-day" style={{ flex: 1, justifyContent: 'center' }} onClick={closeDay}>
                ✅ Xác nhận chốt
              </button>
              <button className="btn btn-secondary" onClick={() => setConfirmClose(false)}>Huỷ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}