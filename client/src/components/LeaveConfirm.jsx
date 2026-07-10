import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TH } from '../i18n/th.js';
import { forfeitLeaveGame } from '../socket.js';

// Multiplayer's stand-in for PauseMenu: there's no real "pause" once other
// humans are seated (their clocks can't stop just because one player wants
// to think), so this is only ever a leave-confirmation prompt — the "stop"
// button is fake in that sense, it never freezes the table.
export default function LeaveConfirm() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleConfirm = async () => {
    await forfeitLeaveGame();
    navigate('/');
  };

  return (
    <>
      <button className="btn btn--icon stop-btn" onClick={() => setOpen(true)} title={TH.table.stop}>
        ⏹
      </button>
      {open && (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <h3>{TH.table.leaveConfirmTitle}</h3>
            <p style={{ color: 'var(--text-muted)' }}>{TH.table.leaveConfirmBody}</p>
            <div className="btn-stack">
              <button className="btn" onClick={() => setOpen(false)}>
                {TH.table.leaveConfirmNo}
              </button>
              <button className="btn btn--danger" onClick={handleConfirm}>
                {TH.table.leaveConfirmYes}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
