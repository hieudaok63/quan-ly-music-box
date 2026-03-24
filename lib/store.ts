import { create } from 'zustand';
import { CartItem, MenuItem } from './types';

interface CartStore {
  items: CartItem[];
  addItem: (item: MenuItem) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  updateNote: (id: string, note: string) => void;
  clearCart: () => void;
  totalPrice: () => number;
  totalItems: () => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],

  addItem: (item: MenuItem) => {
    const existing = get().items.find((i) => i.id === item.id);
    if (existing) {
      set({
        items: get().items.map((i) =>
          i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
        ),
      });
    } else {
      set({ items: [...get().items, { ...item, quantity: 1 }] });
    }
  },

  removeItem: (id: string) => {
    set({ items: get().items.filter((i) => i.id !== id) });
  },

  updateQuantity: (id: string, quantity: number) => {
    if (quantity <= 0) {
      set({ items: get().items.filter((i) => i.id !== id) });
    } else {
      set({
        items: get().items.map((i) => (i.id === id ? { ...i, quantity } : i)),
      });
    }
  },

  updateNote: (id: string, note: string) => {
    set({
      items: get().items.map((i) => (i.id === id ? { ...i, note } : i)),
    });
  },

  clearCart: () => set({ items: [] }),

  totalPrice: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),

  totalItems: () => get().items.reduce((s, i) => s + i.quantity, 0),
}));
