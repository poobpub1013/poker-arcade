import { useEffect, useState } from 'react';

// Seats sit on the perimeter of the felt ellipse. On a wide desktop felt the
// full-width radius looks best, but on a narrow phone the same percentages
// push the left/right seats out past the felt's rail (a fixed-width seat is a
// much larger share of a small felt). Pulling the radius in on narrow screens
// keeps every seat's card/label inside the felt without shrinking the seats
// themselves into illegibility. Shared by Hold'em/PLO (Table.jsx) and Doubt
// Poker (DoubtPokerTable.jsx) so both stay in sync.
export function useSeatPosition() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 680
  );

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= 680);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (index, total) => {
    const angle = Math.PI / 2 - (index * (2 * Math.PI)) / total;
    const rx = narrow ? 38 : 44;
    // Pull the top/bottom seats well inward on a phone: the bottom (own) seat
    // is tall (cards above the avatar, then name/chips/blind badge below it),
    // so a large ry both crowds its cards into the center pot and pushes its
    // blind chip down under the action bar.
    const ry = narrow ? 35 : 40;
    const left = 50 + rx * Math.cos(angle);
    const top = 50 + ry * Math.sin(angle);
    return { left: `${left}%`, top: `${top}%` };
  };
}
