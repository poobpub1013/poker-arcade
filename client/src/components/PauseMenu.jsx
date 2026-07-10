import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TH } from '../i18n/th.js';
import { pauseGame, resumeGame, leaveGame } from '../socket.js';

export default function PauseMenu({ paused }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (paused) setOpen(true);
  }, [paused]);

  const handlePauseClick = () => {
    pauseGame();
    setOpen(true);
  };
  const handleResume = () => {
    resumeGame();
    setOpen(false);
  };
  const handleLeave = () => {
    leaveGame();
    navigate('/');
  };

  return (
    <>
      <button className="btn btn--icon pause-btn" onClick={handlePauseClick} title={TH.table.pause}>
        ⏸
      </button>
      {open && (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <h3>{TH.table.pauseMenuTitle}</h3>
            <div className="btn-stack">
              <button className="btn btn--primary" onClick={handleResume}>
                {TH.table.resume}
              </button>
              <button className="btn btn--danger" onClick={handleLeave}>
                {TH.table.leaveRoom}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
