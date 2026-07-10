import { TH } from '../i18n/th.js';

export default function PotDisplay({ amount = 0 }) {
  return (
    <div className="pot-display">
      <span>{TH.table.pot}</span>
      <span>{amount.toLocaleString()}</span>
    </div>
  );
}
