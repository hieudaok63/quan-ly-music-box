'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../../lib/supabase'
import { MenuItem, Order, OrderItem, Message, RoomPricing, RoomSession, DailyReport } from '../../lib/types'
import { calculateCurrentCost, calculateRoomCost, formatDuration, DEFAULT_PRICING, parseSupabaseTimestamp } from '../../lib/roomUtils'

const ROOMS = Array.from({ length: 10 }, (_, i) => String(i + 1))
const ADMIN_PASSWORD = 'musicbox2024'

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')

  const [activeTab, setActiveTab] = useState<'rooms' | 'orders' | 'menu' | 'chat' | 'revenue' | 'history' | 'qr'>('rooms')
  const [baseUrl, setBaseUrl] = useState('')

  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({})
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedRoom, setSelectedRoom] = useState<string>('1')
  const [chatInput, setChatInput] = useState('')
  const [toast, setToast] = useState('')

  const [showMenuModal, setShowMenuModal] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [formData, setFormData] = useState({ name: '', price: '', image_url: '' })

  const [customerTyping, setCustomerTyping] = useState<Record<string, boolean>>({})
  const [unreadRooms, setUnreadRooms] = useState<Record<string, number>>({})

  const [roomPricing, setRoomPricing] = useState<Record<string, RoomPricing>>({})
  const [roomSessions, setRoomSessions] = useState<RoomSession[]>([])
  const [dailyReports, setDailyReports] = useState<DailyReport[]>([])
  const [timerTick, setTimerTick] = useState(0)
  const [showPricingModal, setShowPricingModal] = useState(false)
  const [pricingRoom, setPricingRoom] = useState('')
  const [pricingForm, setPricingForm] = useState({ day_rate: '', night_rate: '', day_start_hour: '', night_start_hour: '' })
  const [confirmClose, setConfirmClose] = useState(false)
  const [expandedRooms, setExpandedRooms] = useState<Record<string, boolean>>({})

  // Invoice/checkout modal states
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [checkoutSession, setCheckoutSession] = useState<RoomSession | null>(null)
  const [discountPercent, setDiscountPercent] = useState(0)
  const [invoicePrinted, setInvoicePrinted] = useState<Record<string, boolean>>({})

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({})
  const typingChannelsRef = useRef<Record<string, any>>({})

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // Check sessionStorage for existing auth
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('admin_authenticated') === 'true') {
      setIsAuthenticated(true)
    }
  }, [])

  const handleLogin = () => {
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true)
      setPasswordError('')
      sessionStorage.setItem('admin_authenticated', 'true')
    } else {
      setPasswordError('Mật khẩu không đúng!')
    }
  }

  const handleLogout = () => {
    setIsAuthenticated(false)
    setPassword('')
    sessionStorage.removeItem('admin_authenticated')
  }

  useEffect(() => {
    const interval = setInterval(() => setTimerTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  // ===== LOAD ORDER ITEMS =====
  const loadOrderItems = async (orderIds: string[]) => {
    if (orderIds.length === 0) return
    const { data: items } = await supabase.from('order_items').select('*, menu_items(*)').in('order_id', orderIds)
    const grouped: Record<string, OrderItem[]> = {}
    items?.forEach((item: any) => {
      if (!grouped[item.order_id]) grouped[item.order_id] = []
      grouped[item.order_id].push(item)
    })
    setOrderItems(prev => ({ ...prev, ...grouped }))
  }

  // ===== LOAD ORDERS =====
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false })
      if (data) {
        setOrders(data)
        await loadOrderItems(data.map(o => o.id))
      }
    }
    load()
    const ch = supabase.channel('admin-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
        const newOrder = payload.new as Order
        setOrders(prev => [newOrder, ...prev])
        setTimeout(() => loadOrderItems([newOrder.id]), 500)
        showToast(`🔔 Đơn mới từ Phòng ${newOrder.room_id}!`)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        setOrders(prev => prev.map(o => o.id === (payload.new as Order).id ? payload.new as Order : o))
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  useEffect(() => { supabase.from('menu_items').select('*').then(r => setMenuItems(r.data || [])) }, [])

  useEffect(() => {
    supabase.from('messages').select('*').order('created_at', { ascending: true }).then(r => setMessages(r.data || []))
    const ch = supabase.channel('admin-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
        const newMsg = p.new as Message
        setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
        // Track unread + notify for customer messages
        if (newMsg.sender === 'customer') {
          setUnreadRooms(prev => ({ ...prev, [newMsg.room_id]: (prev[newMsg.room_id] || 0) + 1 }))
          showToast(`💬 Phòng ${newMsg.room_id}: "${newMsg.content.length > 30 ? newMsg.content.slice(0, 30) + '...' : newMsg.content}"`)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  useEffect(() => {
    supabase.from('room_pricing').select('*').then(r => {
      const map: Record<string, RoomPricing> = {}
      r.data?.forEach(p => { map[p.room_id] = p })
      setRoomPricing(map)
    })
  }, [])

  useEffect(() => {
    supabase.from('room_sessions').select('*')
      .or('status.eq.active,created_at.gte.' + new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .order('created_at', { ascending: false })
      .then(r => setRoomSessions(r.data || []))
  }, [])

  useEffect(() => {
    supabase.from('daily_reports').select('*').order('report_date', { ascending: false }).limit(30)
      .then(r => setDailyReports(r.data || []))
  }, [])

  useEffect(() => {
    const channels: any[] = []
    ROOMS.forEach(roomId => {
      const ch = supabase.channel(`typing-room-${roomId}`)
        .on('broadcast', { event: 'typing' }, (p) => {
          if (p.payload?.sender === 'customer') {
            setCustomerTyping(prev => ({ ...prev, [roomId]: true }))
            if (typingTimeoutsRef.current[roomId]) clearTimeout(typingTimeoutsRef.current[roomId])
            typingTimeoutsRef.current[roomId] = setTimeout(() => setCustomerTyping(prev => ({ ...prev, [roomId]: false })), 2000)
          }
        })
        .on('broadcast', { event: 'stop_typing' }, (p) => {
          if (p.payload?.sender === 'customer') setCustomerTyping(prev => ({ ...prev, [roomId]: false }))
        })
        .subscribe()
      typingChannelsRef.current[roomId] = ch
      channels.push(ch)
    })
    return () => { channels.forEach(ch => supabase.removeChannel(ch)) }
  }, [])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, selectedRoom, activeTab])

  // =============== ROOM ACTIONS ===============
  const getActiveSession = (roomId: string) => roomSessions.find(s => s.room_id === roomId && s.status === 'active')
  const getRoomPricing = (roomId: string): RoomPricing => roomPricing[roomId] || { id: '', room_id: roomId, ...DEFAULT_PRICING }

  const checkInRoom = async (roomId: string) => {
    // Clear old chat for this room
    await supabase.from('messages').delete().eq('room_id', roomId)
    setMessages(prev => prev.filter(m => m.room_id !== roomId))
    setUnreadRooms(prev => { const next = { ...prev }; delete next[roomId]; return next })

    const { data } = await supabase.from('room_sessions').insert([{ room_id: roomId, status: 'active' }]).select().single()
    if (data) { setRoomSessions(prev => [data, ...prev]); showToast(`✅ Phòng ${roomId} đã mở!`) }
  }

  const checkOutRoom = async (session: RoomSession) => {
    const pricing = getRoomPricing(session.room_id)
    const totalAmount = calculateRoomCost(parseSupabaseTimestamp(session.check_in), new Date(), pricing)

    // Auto-complete all pending/preparing orders for this session
    const sessionOrders = orders.filter(o => o.session_id === session.id && (o.status === 'pending' || o.status === 'preparing'))
    for (const order of sessionOrders) {
      await supabase.from('orders').update({ status: 'done' }).eq('id', order.id)
    }
    if (sessionOrders.length > 0) {
      setOrders(prev => prev.map(o => o.session_id === session.id && (o.status === 'pending' || o.status === 'preparing') ? { ...o, status: 'done' as const } : o))
    }

    // Clear chat for this room
    await supabase.from('messages').delete().eq('room_id', session.room_id)
    setMessages(prev => prev.filter(m => m.room_id !== session.room_id))
    setUnreadRooms(prev => { const next = { ...prev }; delete next[session.room_id]; return next })

    const { data } = await supabase.from('room_sessions')
      .update({ check_out: new Date().toISOString(), total_amount: totalAmount, status: 'closed' })
      .eq('id', session.id).select().single()
    if (data) { setRoomSessions(prev => prev.map(s => s.id === session.id ? data : s)); showToast(`🔒 Phòng ${session.room_id} đã đóng! Tổng: ${formatPrice(totalAmount)}`) }
  }

  // =============== SESSION-BASED REVENUE ===============
  const getDayStart = (): Date => {
    if (dailyReports.length > 0) return parseSupabaseTimestamp(dailyReports[0].created_at)
    const today = new Date(); today.setHours(0, 0, 0, 0); return today
  }

  // Get sessions for a room today
  const getRoomSessions = (roomId: string) => {
    const dayStart = getDayStart()
    return roomSessions.filter(s => s.room_id === roomId && parseSupabaseTimestamp(s.created_at) >= dayStart)
  }

  // Get orders for a specific session
  const getSessionOrders = (sessionId: string) => orders.filter(o => o.session_id === sessionId && o.status !== 'cancelled')

  // Calculate food revenue for a session
  const getSessionOrderRevenue = (sessionId: string) => {
    return getSessionOrders(sessionId).reduce((sum, o) => {
      const items = orderItems[o.id] || []
      return sum + items.reduce((s, i) => s + (i.menu_items?.price || 0) * i.quantity, 0)
    }, 0)
  }

  // Calculate room revenue for a session
  const getSessionRoomRevenue = (session: RoomSession) => {
    if (session.status === 'closed') return session.total_amount
    return calculateCurrentCost(session.check_in, getRoomPricing(session.room_id))
  }

  // Total revenue for a room today
  const getRoomTotalRevenue = (roomId: string) => {
    return getRoomSessions(roomId).reduce((sum, s) => {
      return sum + getSessionRoomRevenue(s) + getSessionOrderRevenue(s.id)
    }, 0)
  }

  // Orders not linked to any session (for today)
  const currentOrders = orders.filter(o => parseSupabaseTimestamp(o.created_at) >= getDayStart())
  const totalRoomRevenue = ROOMS.reduce((s, r) => s + getRoomSessions(r).reduce((sum, sess) => sum + getSessionRoomRevenue(sess), 0), 0)
  const totalOrderRevenue = ROOMS.reduce((s, r) => s + getRoomSessions(r).reduce((sum, sess) => sum + getSessionOrderRevenue(sess.id), 0), 0)
  const totalRevenue = totalRoomRevenue + totalOrderRevenue
  const hasActiveRooms = roomSessions.some(s => s.status === 'active')

  // =============== CLOSE DAY ===============
  const todayStr = new Date().toISOString().split('T')[0]
  // Check if there's any new activity (sessions or orders) to close
  const hasNewActivity = roomSessions.length > 0 || currentOrders.length > 0
  const canCloseDay = hasNewActivity && !hasActiveRooms

  const closeDay = async () => {
    if (!hasNewActivity) {
      showToast('⚠️ Không có dữ liệu mới để chốt!')
      setConfirmClose(false)
      return
    }

    // Close all active rooms first
    for (const session of roomSessions.filter(s => s.status === 'active')) await checkOutRoom(session)

    const details = ROOMS.map(r => {
      const sessions = getRoomSessions(r)
      return {
        room_id: r,
        sessions: sessions.map(s => ({
          check_in: s.check_in,
          check_out: s.check_out,
          room_revenue: getSessionRoomRevenue(s),
          order_revenue: getSessionOrderRevenue(s.id),
          total: getSessionRoomRevenue(s) + getSessionOrderRevenue(s.id),
        })),
        room_revenue: sessions.reduce((sum, s) => sum + getSessionRoomRevenue(s), 0),
        order_revenue: sessions.reduce((sum, s) => sum + getSessionOrderRevenue(s.id), 0),
        total: sessions.reduce((sum, s) => sum + getSessionRoomRevenue(s) + getSessionOrderRevenue(s.id), 0),
      }
    })

    const finalRoomRev = details.reduce((s, d) => s + d.room_revenue, 0)
    const finalOrderRev = details.reduce((s, d) => s + d.order_revenue, 0)

    // 1. Save daily report (History)
    const { data } = await supabase.from('daily_reports').insert([{
      report_date: todayStr,
      total_room_revenue: finalRoomRev, total_order_revenue: finalOrderRev,
      total_revenue: finalRoomRev + finalOrderRev, details,
    }]).select().single()

    if (!data) {
      showToast('❌ Lỗi khi lưu báo cáo!')
      return
    }

    // 2. Get ALL order IDs to delete order_items (including any leftover from previous days)
    const allOrderIds = orders.map(o => o.id)

    // 3. Delete ALL order_items → orders → sessions → messages (clean slate)
    if (allOrderIds.length > 0) {
      await supabase.from('order_items').delete().in('order_id', allOrderIds)
      await supabase.from('orders').delete().in('id', allOrderIds)
    }
    // Also delete any orphaned order_items/orders not in local state
    await supabase.from('order_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    // Delete all sessions (including any leftover from previous days)
    await supabase.from('room_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    // Delete all remaining messages
    await supabase.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    // 4. Reset ALL state for new day
    setDailyReports(prev => [data, ...prev])
    setOrders([])
    setOrderItems({})
    setRoomSessions([])
    setMessages([])
    setUnreadRooms({})
    setCustomerTyping({})
    showToast('✅ Đã chốt doanh thu! Dữ liệu đã reset — bắt đầu ngày mới.')
    setConfirmClose(false)
  }

  // =============== ORDER/CHAT/MENU ===============
  const updateStatus = async (id: string, status: string) => {
    await supabase.from('orders').update({ status }).eq('id', id)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: status as any } : o))
  }

  const broadcastTyping = useCallback(() => {
    typingChannelsRef.current[selectedRoom]?.send({ type: 'broadcast', event: 'typing', payload: { sender: 'admin', room_id: selectedRoom } })
  }, [selectedRoom])
  const broadcastStopTyping = useCallback(() => {
    typingChannelsRef.current[selectedRoom]?.send({ type: 'broadcast', event: 'stop_typing', payload: { sender: 'admin', room_id: selectedRoom } })
  }, [selectedRoom])
  const handleChatInput = (value: string) => { setChatInput(value); value.trim() ? broadcastTyping() : broadcastStopTyping() }
  const sendMessage = async () => {
    if (!chatInput.trim()) return; broadcastStopTyping()
    await supabase.from('messages').insert([{ room_id: selectedRoom, content: chatInput.trim(), sender: 'admin' }])
    setChatInput('')
  }
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
    setShowMenuModal(false); setEditingItem(null); setFormData({ name: '', price: '', image_url: '' })
  }
  const deleteMenuItem = async (id: string) => {
    await supabase.from('menu_items').delete().eq('id', id)
    setMenuItems(prev => prev.filter(m => m.id !== id)); showToast('🗑️ Đã xoá!')
  }

  const openPricingModal = (roomId: string) => {
    const p = getRoomPricing(roomId)
    setPricingRoom(roomId)
    setPricingForm({ day_rate: String(p.day_rate), night_rate: String(p.night_rate), day_start_hour: String(p.day_start_hour), night_start_hour: String(p.night_start_hour) })
    setShowPricingModal(true)
  }
  const savePricing = async () => {
    const item = { room_id: pricingRoom, day_rate: Number(pricingForm.day_rate), night_rate: Number(pricingForm.night_rate), day_start_hour: Number(pricingForm.day_start_hour), night_start_hour: Number(pricingForm.night_start_hour) }
    const existing = roomPricing[pricingRoom]
    if (existing) await supabase.from('room_pricing').update(item).eq('id', existing.id)
    else await supabase.from('room_pricing').insert([item])
    const { data } = await supabase.from('room_pricing').select('*').eq('room_id', pricingRoom).single()
    if (data) setRoomPricing(prev => ({ ...prev, [pricingRoom]: data }))
    setShowPricingModal(false); showToast(`✅ Đã cập nhật giá Phòng ${pricingRoom}!`)
  }

  // =============== HELPERS ===============
  const formatPrice = (p: number) => p.toLocaleString('vi-VN') + 'đ'
  const formatTime = (t: string) => parseSupabaseTimestamp(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const formatDateTime = (t: string) => parseSupabaseTimestamp(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  const formatDate = (t: string) => new Date(t).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
  const pendingByRoom = (roomId: string) => currentOrders.filter(o => o.room_id === roomId && (o.status === 'pending' || o.status === 'preparing')).length
  const roomMessages = messages.filter(m => m.room_id === selectedRoom)
  const getLiveTimer = (session: RoomSession) => { void timerTick; return formatDuration(session.check_in) }
  const getLiveCost = (session: RoomSession) => { void timerTick; return calculateCurrentCost(session.check_in, getRoomPricing(session.room_id)) }
  const toggleRoom = (roomId: string) => setExpandedRooms(prev => ({ ...prev, [roomId]: !prev[roomId] }))
  const totalUnread = Object.values(unreadRooms).reduce((s, n) => s + n, 0)
  const selectChatRoom = (roomId: string) => { setSelectedRoom(roomId); setUnreadRooms(prev => { const next = { ...prev }; delete next[roomId]; return next }) }

  // =============== RENDER ===============
  // =============== LOGIN SCREEN ===============
  if (!isAuthenticated) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-main)',
        padding: 20,
      }}>
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg, 16px)',
          padding: '48px 36px',
          width: '100%',
          maxWidth: 400,
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          border: '1px solid var(--border)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎵</div>
          <h1 style={{
            fontSize: 26,
            fontWeight: 800,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-gold))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: 6,
          }}>Music Box Admin</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>Nhập mật khẩu để tiếp tục</p>

          <div style={{ textAlign: 'left' }}>
            <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>🔒 Mật khẩu</label>
            <input
              className="form-input"
              type="password"
              placeholder="Nhập mật khẩu admin..."
              value={password}
              onChange={e => { setPassword(e.target.value); setPasswordError('') }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
              style={{ width: '100%', marginBottom: 8, fontSize: 15 }}
            />
            {passwordError && (
              <div style={{
                color: '#e94560',
                fontSize: 13,
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                ⚠️ {passwordError}
              </div>
            )}
          </div>

          <button
            className="btn btn-primary"
            onClick={handleLogin}
            style={{
              width: '100%',
              padding: '14px 24px',
              fontSize: 16,
              fontWeight: 700,
              marginTop: 12,
              borderRadius: 'var(--radius-md, 12px)',
            }}
          >
            Đăng nhập
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-container">
      {toast && <div className="toast">{toast}</div>}

      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, background: 'linear-gradient(135deg, var(--accent), var(--accent-gold))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>🎵 Music Box Admin</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Quản lý phòng, đơn hàng & doanh thu</p>
        </div>
        <button
          onClick={handleLogout}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm, 8px)',
            padding: '8px 16px',
            fontSize: 13,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          🚪 Đăng xuất
        </button>
      </div>

      <div className="admin-tabs" style={{ maxWidth: 900 }}>
        {[
          { key: 'rooms', label: '🏠 Phòng' },
          { key: 'orders', label: `📋 Đơn hàng${currentOrders.filter(o => o.status === 'pending').length > 0 ? ` (${currentOrders.filter(o => o.status === 'pending').length})` : ''}` },
          { key: 'menu', label: '🍽️ Thực đơn' },
          { key: 'revenue', label: '💰 Doanh thu' },
          { key: 'history', label: '📊 Lịch sử' },
          { key: 'chat', label: `💬 Chat${totalUnread > 0 ? ` (${totalUnread})` : ''}` },
          { key: 'qr', label: '📱 QR Code' },
        ].map(t => (
          <button key={t.key} className={`tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key as any)}>{t.label}</button>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="admin-stats">
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(0,214,143,0.12)' }}>🏠</div>
          <div className="admin-stat-info">
            <div className="admin-stat-label">Phòng đang mở</div>
            <div className="admin-stat-value" style={{ color: 'var(--success)' }}>{roomSessions.filter(s => s.status === 'active').length}</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(255,170,0,0.12)' }}>📋</div>
          <div className="admin-stat-info">
            <div className="admin-stat-label">Đơn chờ xử lý</div>
            <div className="admin-stat-value" style={{ color: 'var(--warning)' }}>{currentOrders.filter(o => o.status === 'pending').length}</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(233,69,96,0.12)' }}>💰</div>
          <div className="admin-stat-info">
            <div className="admin-stat-label">Doanh thu hôm nay</div>
            <div className="admin-stat-value" style={{ color: 'var(--accent)' }}>{formatPrice(totalRevenue)}</div>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(77,166,255,0.12)' }}>💬</div>
          <div className="admin-stat-info">
            <div className="admin-stat-label">Tin nhắn chưa đọc</div>
            <div className="admin-stat-value" style={{ color: 'var(--info)' }}>{totalUnread}</div>
          </div>
        </div>
      </div>

      {/* ===================== ROOMS ===================== */}
      {activeTab === 'rooms' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700 }}>Quản lý phòng</h2>
          <div className="room-grid">
            {ROOMS.map(r => {
              const session = getActiveSession(r)
              const pricing = getRoomPricing(r)
              const orderCount = pendingByRoom(r)
              const roomUnread = unreadRooms[r] || 0
              const isTyping = customerTyping[r]
              return (
                <div key={r} className={`room-card ${session ? 'has-orders' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="room-card-number">P{r}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {roomUnread > 0 && (
                        <div style={{ background: 'var(--info)', color: '#fff', borderRadius: 'var(--radius-full)', padding: '2px 8px', fontSize: 11, fontWeight: 700, animation: 'pulse 2s infinite', display: 'flex', alignItems: 'center', gap: 4 }}>
                          💬 {roomUnread}
                        </div>
                      )}
                      {isTyping && (
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', animation: 'pulse 1s infinite' }} title="Khách đang nhập..." />
                      )}
                      {orderCount > 0 && <div className="room-card-badge">{orderCount} đơn</div>}
                    </div>
                  </div>
                  {session ? (
                    <>
                      <div className="room-timer">{getLiveTimer(session)}</div>
                      <div className="room-cost-live">~{formatPrice(getLiveCost(session))}</div>
                      <div className="room-card-actions-row">
                        <button className="btn btn-primary btn-sm" onClick={() => { setCheckoutSession(session); setDiscountPercent(0); setShowInvoiceModal(true) }}>🔒 Đóng phòng</button>
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

      {/* ===================== ORDERS ===================== */}
      {activeTab === 'orders' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700 }}>Đơn hàng ({currentOrders.filter(o => o.status === 'pending').length} chờ)</h2>
          {currentOrders.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">📭</div><div className="empty-state-text">Chưa có đơn hàng mới</div></div>
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
                        o.status === 'pending' ? 'Chờ xác nhận' : o.status === 'preparing' ? 'Đang làm' : o.status === 'done' ? 'Hoàn thành' : 'Đã huỷ'
                      }</span>
                    </div>
                    <div className="order-card-items">
                      {items.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '4px 0' }}>Đang tải...</div>
                      ) : items.map((item: any, idx: number) => (
                        <div key={idx}>
                          <div className="order-card-item">
                            <span>{item.menu_items?.name || '—'} × {item.quantity}</span>
                            <span style={{ fontWeight: 600 }}>{item.menu_items ? formatPrice(item.menu_items.price * item.quantity) : ''}</span>
                          </div>
                          {item.note && <div style={{ fontSize: 12, color: 'var(--accent-gold)', paddingLeft: 12, marginBottom: 6, fontStyle: 'italic' }}>📝 {item.note}</div>}
                        </div>
                      ))}
                    </div>
                    {items.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', marginBottom: 8, borderTop: '1px solid var(--border)', fontSize: 14, fontWeight: 700 }}>
                        <span>Tổng đơn</span><span style={{ color: 'var(--accent)' }}>{formatPrice(orderTotal)}</span>
                      </div>
                    )}
                    <div className="order-card-actions">
                      {o.status === 'pending' && (<>
                        <button className="btn btn-primary btn-sm" onClick={() => updateStatus(o.id, 'preparing')}>🔥 Bắt đầu làm</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => updateStatus(o.id, 'cancelled')}>❌ Huỷ</button>
                      </>)}
                      {o.status === 'preparing' && <button className="btn btn-success btn-sm" onClick={() => updateStatus(o.id, 'done')}>✅ Hoàn thành</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================== MENU ===================== */}
      {activeTab === 'menu' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>Quản lý thực đơn ({menuItems.length} món)</h2>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setFormData({ name: '', price: '', image_url: '' }); setShowMenuModal(true) }}>+ Thêm món</button>
          </div>
          <div className="menu-mgmt-grid">
            {menuItems.map(item => (
              <div key={item.id} className="menu-mgmt-card">
                <img src={item.image_url || 'https://placehold.co/260x140/1a1a2e/e8e8f0?text=🍽️'} alt={item.name} className="menu-mgmt-img" />
                <div className="menu-mgmt-name">{item.name}</div>
                <div className="menu-mgmt-price">{formatPrice(item.price)}</div>
                <div className="menu-mgmt-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditingItem(item); setFormData({ name: item.name, price: String(item.price), image_url: item.image_url || '' }); setShowMenuModal(true) }}>✏️ Sửa</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => deleteMenuItem(item.id)}>🗑️ Xoá</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== REVENUE (SESSION-BASED) ===================== */}
      {activeTab === 'revenue' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700 }}>💰 Doanh thu hôm nay</h2>

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

          {/* Per-Room Expandable */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ROOMS.map(r => {
              const sessions = getRoomSessions(r)
              const roomTotal = getRoomTotalRevenue(r)
              const isExpanded = expandedRooms[r]
              const activeSession = getActiveSession(r)

              return (
                <div key={r} className="revenue-room-card">
                  <div className="revenue-room-header" onClick={() => toggleRoom(r)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 16, fontWeight: 700 }}>Phòng {r}</span>
                      {activeSession && <span className="badge badge-preparing">Đang mở</span>}
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>({sessions.length} ca)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontWeight: 700, color: roomTotal > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{formatPrice(roomTotal)}</span>
                      <span style={{ color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>▼</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="revenue-room-details">
                      {sessions.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 12, textAlign: 'center' }}>Chưa có ca nào hôm nay</div>
                      ) : (
                        sessions.map((s, idx) => {
                          const roomRev = getSessionRoomRevenue(s)
                          const orderRev = getSessionOrderRevenue(s.id)
                          const sessionOrders = getSessionOrders(s.id)
                          return (
                            <div key={s.id} className="session-card">
                              <div className="session-header">
                                <div>
                                  <span style={{ fontWeight: 600 }}>Ca {sessions.length - idx}</span>
                                  <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 13 }}>
                                    {formatTime(s.check_in)} → {s.check_out ? formatTime(s.check_out) : '...'}
                                  </span>
                                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                                    ({s.status === 'active' ? getLiveTimer(s) : formatDuration(s.check_in, s.check_out)})
                                  </span>
                                </div>
                                <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{formatPrice(roomRev + orderRev)}</span>
                              </div>
                              <div className="session-detail-grid">
                                <div className="session-detail-item">
                                  <span className="session-detail-label">🏠 Tiền phòng</span>
                                  <span>{formatPrice(roomRev)}</span>
                                </div>
                                <div className="session-detail-item">
                                  <span className="session-detail-label">🍽️ Đồ ăn/uống</span>
                                  <span>{formatPrice(orderRev)}</span>
                                </div>
                              </div>
                              {s.status === 'closed' && invoicePrinted[s.id] === false && (
                                <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                  ⚠️ Không in hoá đơn
                                </div>
                              )}
                              {s.status === 'closed' && invoicePrinted[s.id] === true && (
                                <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                  ✅ Đã in hoá đơn
                                </div>
                              )}
                              {/* Orders in this session */}
                              {sessionOrders.length > 0 && (
                                <div className="session-orders">
                                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Chi tiết đơn hàng:</div>
                                  {sessionOrders.map(o => (
                                    <div key={o.id} style={{ fontSize: 13, padding: '4px 0' }}>
                                      {(orderItems[o.id] || []).map((item: any, i: number) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                                          <span>{item.menu_items?.name} ×{item.quantity}</span>
                                          <span style={{ color: 'var(--text-secondary)' }}>{item.menu_items ? formatPrice(item.menu_items.price * item.quantity) : ''}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Total summary row */}
          <div className="revenue-total-bar">
            <span>TỔNG DOANH THU</span>
            <span>{formatPrice(totalRevenue)}</span>
          </div>

          {/* Close Day */}
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            {!hasNewActivity ? (
              <div>
                <button className="btn-close-day" disabled style={{ opacity: 0.5, cursor: 'not-allowed', transform: 'none' }}>📊 Chốt doanh thu</button>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 12 }}>Chưa có hoạt động nào. Mở phòng để bắt đầu.</p>
              </div>
            ) : hasActiveRooms ? (
              <div>
                <button className="btn-close-day" disabled style={{ opacity: 0.5, cursor: 'not-allowed', transform: 'none' }}>📊 Chốt doanh thu</button>
                <p style={{ color: 'var(--warning)', fontSize: 13, marginTop: 12 }}>⚠️ Đóng tất cả phòng trước khi chốt ({roomSessions.filter(s => s.status === 'active').length} phòng đang mở)</p>
              </div>
            ) : (
              <button className="btn-close-day" onClick={() => setConfirmClose(true)}>📊 Chốt doanh thu hôm nay</button>
            )}
          </div>
        </div>
      )}

      {/* ===================== HISTORY ===================== */}
      {activeTab === 'history' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 20, fontWeight: 700 }}>📊 Lịch sử doanh thu</h2>
          {dailyReports.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">📊</div><div className="empty-state-text">Chưa có báo cáo. Hãy chốt doanh thu cuối ngày.</div></div>
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
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(report.details as any[]).filter(d => d.total > 0).map((d: any) => (
                        <div key={d.room_id} style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', padding: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginBottom: 6 }}>
                            <span>Phòng {d.room_id}</span>
                            <span style={{ color: 'var(--accent)' }}>{formatPrice(d.total)}</span>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 16 }}>
                            <span>🏠 {formatPrice(d.room_revenue)}</span>
                            <span>🍽️ {formatPrice(d.order_revenue)}</span>
                          </div>
                          {/* Session details if available */}
                          {d.sessions && d.sessions.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 12 }}>
                              {d.sessions.map((sess: any, i: number) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--text-muted)' }}>
                                  <span>Ca {d.sessions.length - i}: {formatTime(sess.check_in)} → {sess.check_out ? formatTime(sess.check_out) : '—'}</span>
                                  <span>{formatPrice(sess.total)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================== CHAT ===================== */}
      {activeTab === 'chat' && (
        <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 200px)' }}>
          <div style={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>PHÒNG</h3>
            {ROOMS.map(r => {
              const unread = unreadRooms[r] || 0
              return (
                <button key={r} className={`chat-room-btn ${selectedRoom === r ? 'active' : ''}`}
                  style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => selectChatRoom(r)}>
                  <span>Phòng {r}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {unread > 0 && <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{unread}</span>}
                    {customerTyping[r] && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', animation: 'pulse 1s infinite' }} />}
                  </span>
                </button>
              )
            })}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div className="chat-header">
              <h3>💬 Phòng {selectedRoom}</h3>
              {customerTyping[selectedRoom] && <span style={{ fontSize: 12, color: 'var(--success)' }}>Khách đang nhập...</span>}
            </div>
            <div className="chat-messages" style={{ flex: 1 }}>
              {roomMessages.length === 0 && <div className="empty-state" style={{ padding: 30 }}><div className="empty-state-icon">💬</div><div className="empty-state-text">Chưa có tin nhắn</div></div>}
              {roomMessages.map(m => (
                <div key={m.id} className={`chat-msg ${m.sender}`}>
                  <div>{m.content}</div>
                  <div className="chat-msg-time">{formatTime(m.created_at)}</div>
                </div>
              ))}
              {customerTyping[selectedRoom] && (
                <div className="typing-indicator">
                  <span className="typing-indicator-label">Khách</span>
                  <div className="typing-dots"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-row">
              <input className="chat-input" placeholder="Nhập tin nhắn..." value={chatInput}
                onChange={e => handleChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} />
              <button className="chat-send" onClick={sendMessage}>➤</button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== QR CODES ===================== */}
      {activeTab === 'qr' && (
        <div>
          <h2 style={{ marginBottom: 8, fontSize: 20, fontWeight: 700 }}>📱 Mã QR cho từng phòng</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>Khách quét QR → mở trang đặt món tương ứng với phòng</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
            <label style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>🌐 Tên miền:</label>
            <input
              className="form-input"
              style={{ maxWidth: 400 }}
              placeholder="https://your-domain.com"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
            />
            <button className="btn btn-secondary btn-sm" onClick={() => setBaseUrl(typeof window !== 'undefined' ? window.location.origin : '')}>Tự phát hiện</button>
          </div>
          <div className="qr-grid">
            {ROOMS.map(r => {
              const url = `${baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')}/order?room=${r}`
              return (
                <div key={r} className="qr-card">
                  <div className="qr-card-label">Phòng {r}</div>
                  <div className="qr-card-code">
                    <QRCodeSVG
                      value={url}
                      size={180}
                      bgColor="#ffffff"
                      fgColor="#0a0a0f"
                      level="M"
                      includeMargin
                    />
                  </div>
                  <div className="qr-card-url">{url}</div>
                </div>
              )
            })}
          </div>
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <button className="btn btn-primary" style={{ padding: '12px 40px', fontSize: 15 }} onClick={() => {
              const printContent = ROOMS.map(r => {
                const url = `${baseUrl || window.location.origin}/order?room=${r}`
                return `<div style="display:inline-block;text-align:center;padding:20px;border:2px solid #000;border-radius:12px;margin:10px;page-break-inside:avoid"><h2 style="margin:0 0 10px;font-size:20px">🎵 Music Box</h2><h3 style="margin:0 0 15px;font-size:24px">Phòng ${r}</h3><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}" style="width:200px;height:200px" /><p style="margin:10px 0 0;font-size:10px;color:#666;word-break:break-all">${url}</p></div>`
              }).join('')
              const w = window.open('', '_blank')
              if (w) {
                w.document.write(`<html><head><title>QR Codes - Music Box</title><style>body{font-family:Arial;text-align:center;padding:20px}@media print{button{display:none!important}}</style></head><body><h1>🎵 Music Box - Mã QR</h1><div style="display:flex;flex-wrap:wrap;justify-content:center">${printContent}</div><br/><button onclick="window.print()" style="padding:12px 40px;font-size:16px;cursor:pointer">🖨️ In</button></body></html>`)
                w.document.close()
              }
            }}>🖨️ In tất cả QR</button>
          </div>
        </div>
      )}

      {/* ===================== INVOICE MODAL ===================== */}
      {showInvoiceModal && checkoutSession && (() => {
        const sess = checkoutSession
        const pricing = getRoomPricing(sess.room_id)
        const checkInTime = parseSupabaseTimestamp(sess.check_in)
        const checkOutTime = new Date()
        const roomCost = calculateRoomCost(checkInTime, checkOutTime, pricing)
        const sessOrders = orders.filter(o => o.session_id === sess.id && o.status !== 'cancelled')
        const foodItems: { name: string; qty: number; price: number; total: number }[] = []
        sessOrders.forEach(o => {
          (orderItems[o.id] || []).forEach((item: any) => {
            foodItems.push({
              name: item.menu_items?.name || '—',
              qty: item.quantity,
              price: item.menu_items?.price || 0,
              total: (item.menu_items?.price || 0) * item.quantity,
            })
          })
        })
        const foodTotal = foodItems.reduce((s, i) => s + i.total, 0)
        const subtotal = roomCost + foodTotal
        const discountAmount = Math.round(subtotal * discountPercent / 100)
        const finalTotal = subtotal - discountAmount
        const durationMs = checkOutTime.getTime() - checkInTime.getTime()
        const hours = Math.floor(durationMs / 3600000)
        const minutes = Math.floor((durationMs % 3600000) / 60000)
        const durationStr = hours > 0 ? `${hours} giờ ${minutes} phút` : `${minutes} phút`
        const timeFormat = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        const dateFormat = (d: Date) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

        const printInvoice = () => {
          const foodRowsHtml = foodItems.map(i =>
            `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${i.name}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${i.price.toLocaleString('vi-VN')}đ</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${i.total.toLocaleString('vi-VN')}đ</td></tr>`
          ).join('')
          const w = window.open('', '_blank')
          if (w) {
            w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hoá đơn - Music Box</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;max-width:380px;margin:20px auto;padding:20px;color:#333;font-size:14px}
  .header{text-align:center;border-bottom:2px dashed #ccc;padding-bottom:16px;margin-bottom:16px}
  .header h1{font-size:22px;margin:0 0 4px;color:#ce7a58}
  .header p{margin:4px 0;color:#888;font-size:12px}
  .info-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}
  .info-row .label{color:#888}
  .info-row .value{font-weight:600}
  .section-title{font-weight:700;font-size:14px;margin:16px 0 8px;color:#ce7a58}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:6px 8px;border-bottom:2px solid #ce7a58;font-size:12px;color:#888;text-transform:uppercase}
  .total-section{border-top:2px dashed #ccc;margin-top:16px;padding-top:12px}
  .total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:14px}
  .total-row.final{font-size:20px;font-weight:800;color:#ce7a58;padding:8px 0;border-top:2px solid #ce7a58;margin-top:8px}
  .discount-row{color:#e94560}
  .footer{text-align:center;margin-top:24px;padding-top:16px;border-top:2px dashed #ccc}
  .footer .thanks{font-size:16px;font-weight:700;color:#ce7a58;margin-bottom:4px}
  .footer .msg{font-size:12px;color:#888;line-height:1.6}
  @media print{.no-print{display:none!important}body{margin:0;padding:10px}}
</style></head><body>
<div class="header">
  <h1>🎵 Music Box</h1>
  <p>HÓA ĐƠN THANH TOÁN</p>
  <p>${dateFormat(checkOutTime)}</p>
</div>
<div class="info-row"><span class="label">Phòng</span><span class="value">Phòng ${sess.room_id}</span></div>
<div class="info-row"><span class="label">Giờ vào</span><span class="value">${timeFormat(checkInTime)}</span></div>
<div class="info-row"><span class="label">Giờ ra</span><span class="value">${timeFormat(checkOutTime)}</span></div>
<div class="info-row"><span class="label">Thời gian hát</span><span class="value">${durationStr}</span></div>
<div class="info-row"><span class="label">Đơn giá</span><span class="value">${(checkInTime.getHours() >= pricing.night_start_hour || checkInTime.getHours() < pricing.day_start_hour ? pricing.night_rate : pricing.day_rate).toLocaleString('vi-VN')}đ/h (${checkInTime.getHours() >= pricing.night_start_hour || checkInTime.getHours() < pricing.day_start_hour ? 'Ban đêm' : 'Ban ngày'})</span></div>
<div class="section-title">🏠 Tiền phòng</div>
<div class="info-row"><span class="label">Phòng ${sess.room_id} (${durationStr})</span><span class="value">${roomCost.toLocaleString('vi-VN')}đ</span></div>
${foodItems.length > 0 ? `
<div class="section-title">🍽️ Đồ ăn & uống</div>
<table><thead><tr><th>Món</th><th style="text-align:center">SL</th><th style="text-align:right">Đơn giá</th><th style="text-align:right">T.Tiền</th></tr></thead><tbody>${foodRowsHtml}</tbody></table>
` : ''}
<div class="total-section">
  <div class="total-row"><span>Tiền phòng</span><span>${roomCost.toLocaleString('vi-VN')}đ</span></div>
  ${foodTotal > 0 ? `<div class="total-row"><span>Đồ ăn/uống</span><span>${foodTotal.toLocaleString('vi-VN')}đ</span></div>` : ''}
  <div class="total-row" style="font-weight:600"><span>Tạm tính</span><span>${subtotal.toLocaleString('vi-VN')}đ</span></div>
  ${discountPercent > 0 ? `<div class="total-row discount-row"><span>Giảm giá (${discountPercent}%)</span><span>-${discountAmount.toLocaleString('vi-VN')}đ</span></div>` : ''}
  <div class="total-row final"><span>TỔNG THANH TOÁN</span><span>${finalTotal.toLocaleString('vi-VN')}đ</span></div>
</div>
<div class="footer">
  <div class="thanks">Cảm ơn quý khách! 💖</div>
  <div class="msg">Hẹn gặp lại quý khách tại Music Box!<br/>Chúc quý khách một ngày tốt lành 🎶</div>
</div>
<div class="no-print" style="text-align:center;margin-top:20px">
  <button onclick="window.print()" style="padding:12px 40px;font-size:15px;cursor:pointer;background:#ce7a58;color:#fff;border:none;border-radius:8px;font-weight:600">🖨️ In hoá đơn</button>
</div>
</body></html>`)
            w.document.close()
          }
        }

        return (
          <div className="modal-overlay" onClick={() => setShowInvoiceModal(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 className="modal-title">🧾 Hoá đơn Phòng {sess.room_id}</h3>

              {/* Room Info */}
              <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 8px)', padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
                  <span style={{ color: 'var(--text-muted)' }}>⏰ Giờ vào</span>
                  <span style={{ fontWeight: 600 }}>{timeFormat(checkInTime)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
                  <span style={{ color: 'var(--text-muted)' }}>⏰ Giờ ra</span>
                  <span style={{ fontWeight: 600 }}>{timeFormat(checkOutTime)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
                  <span style={{ color: 'var(--text-muted)' }}>⏱️ Thời gian</span>
                  <span style={{ fontWeight: 600 }}>{durationStr}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', borderTop: '1px solid var(--border)', marginTop: 8, fontSize: 15, fontWeight: 700 }}>
                  <span>🏠 Tiền phòng</span>
                  <span style={{ color: 'var(--accent)' }}>{formatPrice(roomCost)}</span>
                </div>
              </div>

              {/* Food Orders */}
              {foodItems.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🍽️ Đồ ăn & uống</div>
                  <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 8px)', padding: 12 }}>
                    {foodItems.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                        <span>{item.name} × {item.qty}</span>
                        <span style={{ fontWeight: 600 }}>{formatPrice(item.total)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', borderTop: '1px solid var(--border)', marginTop: 8, fontSize: 14, fontWeight: 700 }}>
                      <span>Tổng đồ ăn</span>
                      <span style={{ color: 'var(--accent)' }}>{formatPrice(foodTotal)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Discount */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🏷️ Mã giảm giá</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="0"
                    value={discountPercent || ''}
                    onChange={e => setDiscountPercent(Math.min(100, Math.max(0, Number(e.target.value))))}
                    style={{ width: 80, textAlign: 'center', fontSize: 16, fontWeight: 700 }}
                  />
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-secondary)' }}>%</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {[5, 10, 15, 20].map(p => (
                      <button
                        key={p}
                        className={`btn btn-sm ${discountPercent === p ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setDiscountPercent(p)}
                        style={{ fontSize: 12, padding: '4px 10px' }}
                      >{p}%</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 8px)', padding: 16, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
                  <span>Tiền phòng</span>
                  <span>{formatPrice(roomCost)}</span>
                </div>
                {foodTotal > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
                    <span>Đồ ăn/uống</span>
                    <span>{formatPrice(foodTotal)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14, fontWeight: 600 }}>
                  <span>Tạm tính</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                {discountPercent > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14, color: '#e94560' }}>
                    <span>Giảm giá ({discountPercent}%)</span>
                    <span>-{formatPrice(discountAmount)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', borderTop: '2px solid var(--border)', marginTop: 8, fontSize: 20, fontWeight: 800 }}>
                  <span>TỔNG</span>
                  <span style={{ color: 'var(--accent)' }}>{formatPrice(finalTotal)}</span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '12px 16px', fontSize: 15 }}
                  onClick={() => { printInvoice(); setInvoicePrinted(prev => ({ ...prev, [sess.id]: true })); checkOutRoom(sess); setShowInvoiceModal(false) }}
                >🖨️ In hoá đơn & Đóng phòng</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => { setInvoicePrinted(prev => ({ ...prev, [sess.id]: false })); checkOutRoom(sess); setShowInvoiceModal(false) }}
                >🔒 Đóng phòng (không in)</button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowInvoiceModal(false)}
                >Huỷ</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ===================== MODALS ===================== */}
      {showMenuModal && (
        <div className="modal-overlay" onClick={() => setShowMenuModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editingItem ? '✏️ Sửa món' : '➕ Thêm món mới'}</h3>
            <div className="form-group"><label className="form-label">Tên món</label><input className="form-input" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Giá (VNĐ)</label><input className="form-input" type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">URL hình ảnh</label><input className="form-input" value={formData.image_url} onChange={e => setFormData({ ...formData, image_url: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveMenuItem}>{editingItem ? 'Cập nhật' : 'Thêm món'}</button>
              <button className="btn btn-secondary" onClick={() => setShowMenuModal(false)}>Huỷ</button>
            </div>
          </div>
        </div>
      )}

      {showPricingModal && (
        <div className="modal-overlay" onClick={() => setShowPricingModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">⚙️ Giá Phòng {pricingRoom}</h3>
            <div className="pricing-grid">
              <div className="form-group"><label className="form-label">🌞 Giá ngày (VNĐ/h)</label><input className="form-input" type="number" value={pricingForm.day_rate} onChange={e => setPricingForm({ ...pricingForm, day_rate: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">🌙 Giá đêm (VNĐ/h)</label><input className="form-input" type="number" value={pricingForm.night_rate} onChange={e => setPricingForm({ ...pricingForm, night_rate: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">Bắt đầu ngày (giờ)</label><input className="form-input" type="number" min="0" max="23" value={pricingForm.day_start_hour} onChange={e => setPricingForm({ ...pricingForm, day_start_hour: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">Bắt đầu đêm (giờ)</label><input className="form-input" type="number" min="0" max="23" value={pricingForm.night_start_hour} onChange={e => setPricingForm({ ...pricingForm, night_start_hour: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={savePricing}>Lưu giá</button>
              <button className="btn btn-secondary" onClick={() => setShowPricingModal(false)}>Huỷ</button>
            </div>
          </div>
        </div>
      )}

      {confirmClose && (
        <div className="modal-overlay" onClick={() => setConfirmClose(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">📊 Xác nhận chốt doanh thu</h3>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 2 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 12, textAlign: 'center' }}>{formatPrice(totalRevenue)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>🏠 Tiền phòng:</span><span style={{ fontWeight: 600 }}>{formatPrice(totalRoomRevenue)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>🍽️ Đồ ăn/uống:</span><span style={{ fontWeight: 600 }}>{formatPrice(totalOrderRevenue)}</span></div>
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                • Dữ liệu lưu vào lịch sử<br />• Đơn hàng & phòng sẽ được reset<br />• Bắt đầu ngày kinh doanh mới
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-close-day" style={{ flex: 1, justifyContent: 'center' }} onClick={closeDay}>✅ Xác nhận chốt</button>
              <button className="btn btn-secondary" onClick={() => setConfirmClose(false)}>Huỷ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}