import { useEffect } from 'react';
import { useProfile } from '../store/useProfile.js';

export default function ThemeProvider({ children }) {
  const theme = useProfile((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return children;
}
