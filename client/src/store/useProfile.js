import { create } from 'zustand';

const PROFILE_KEY = 'pokergame:profile';
const THEME_KEY = 'pokergame:theme';
const MUTED_KEY = 'pokergame:muted';

function loadProfile() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

const initialProfile = loadProfile();

export const useProfile = create((set, get) => ({
  name: initialProfile?.name || '',
  avatar: initialProfile?.avatar || null,
  theme: localStorage.getItem(THEME_KEY) || 'classic',
  muted: localStorage.getItem(MUTED_KEY) === 'true',

  setName: (name) => set({ name }),
  setAvatar: (avatar) => set({ avatar }),

  saveProfile: () => {
    const { name, avatar } = get();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: trimmedName, avatar }));
    set({ name: trimmedName });
  },

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },

  toggleMuted: () =>
    set((state) => {
      const muted = !state.muted;
      localStorage.setItem(MUTED_KEY, String(muted));
      return { muted };
    }),
}));
