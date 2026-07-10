import { useState, useRef, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore.js';
import { TH } from '../i18n/th.js';
import { sendChatMessage } from '../socket.js';
import QuickChat from './QuickChat.jsx';

const TOAST_DURATION_MS = 6000;
const MAX_TOASTS = 3;

// Multiplayer only (bot-mode rooms have nobody else to talk to) — mirrors
// PauseMenu's floating-icon-button pattern, just parked in the opposite
// corner since PauseMenu never renders alongside this.
export default function Chat() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const chatMessages = useGameStore((s) => s.chatMessages);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const listRef = useRef(null);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [chatMessages, open]);

  // Surface every new message as a briefly-visible bubble even when the full
  // panel is closed, so nobody has to open chat just to see what was said.
  // Each message schedules its own independent expiry timeout (not tied to
  // an effect-cleanup) so a rapid run of messages doesn't cancel each
  // other's timers.
  useEffect(() => {
    const last = chatMessages[chatMessages.length - 1];
    if (!last) return;
    const toastId = `${last.ts}-${last.fromId}`;
    setToasts((prev) => (prev.some((t) => t.id === toastId) ? prev : [...prev, { ...last, id: toastId }].slice(-MAX_TOASTS)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, TOAST_DURATION_MS);
  }, [chatMessages]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendChatMessage(trimmed);
    setText('');
  };

  return (
    <>
      {!open && toasts.length > 0 && (
        <div className="chat-toast-stack">
          {toasts.map((m) => (
            <div key={m.id} className={`chat-toast${m.fromId === myPlayerId ? ' chat-toast--me' : ''}`}>
              <strong>{m.name}:</strong> {m.text}
            </div>
          ))}
        </div>
      )}
      <button className="btn btn--icon chat-toggle-btn" onClick={() => setOpen((v) => !v)} title="แชท">
        💬
      </button>
      {open && (
        <div className="chat-panel">
          <div className="chat-panel__messages" ref={listRef}>
            {chatMessages.map((m, i) => (
              <div key={i} className={`chat-message${m.fromId === myPlayerId ? ' chat-message--me' : ''}`}>
                <strong>{m.name}:</strong> {m.text}
              </div>
            ))}
          </div>
          <QuickChat onPick={sendChatMessage} />
          <div className="chat-panel__input-row">
            <input
              type="text"
              value={text}
              placeholder={TH.chat.placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              maxLength={200}
            />
            <button className="btn btn--primary" onClick={handleSend}>
              {TH.chat.send}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
