import { useState, useCallback, useRef } from 'react';
import Cropper from 'react-easy-crop';
import DefaultAvatar from './DefaultAvatar.jsx';
import { TH } from '../i18n/th.js';

const OUTPUT_SIZE = 256;

function createImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.src = url;
  });
}

async function getCroppedDataUrl(imageSrc, croppedAreaPixels) {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  );
  return canvas.toDataURL('image/jpeg', 0.85);
}

// Lets the player pick a photo, crop it to a square with pan/zoom, and stores
// the result as a small JPEG data URL (localStorage + socket friendly size).
export default function AvatarUpload({ name, avatar, onChange }) {
  const fileInputRef = useRef(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropComplete = useCallback((_, pixels) => setCroppedAreaPixels(pixels), []);

  const handleConfirm = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    const dataUrl = await getCroppedDataUrl(imageSrc, croppedAreaPixels);
    onChange(dataUrl);
    setImageSrc(null);
  };

  return (
    <div>
      <div className="avatar-circle" onClick={() => fileInputRef.current?.click()}>
        {avatar ? <img src={avatar} alt="โปรไฟล์" /> : <DefaultAvatar seed={name} />}
        <div className="avatar-circle__hint">{avatar ? TH.home.changePhoto : TH.home.uploadPhoto}</div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />

      {imageSrc && (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <h3>{TH.avatarCrop.title}</h3>
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 280,
                background: '#111',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="rect"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
            </div>
            <div className="field">
              <label>{TH.avatarCrop.zoom}</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setImageSrc(null)}>
                {TH.avatarCrop.cancel}
              </button>
              <button className="btn btn--primary" onClick={handleConfirm}>
                {TH.avatarCrop.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
