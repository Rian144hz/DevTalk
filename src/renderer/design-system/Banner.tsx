import { useEffect, useState } from 'react';
import { firstFrame } from '../lib/image-browser';
import { usePlayAnimations } from '../lib/motion';

/**
 * A profile banner at 3:1, cropped to fill from the centre. Animated banners move only while "Play animated banners"
 * is on and the system does not ask to reduce motion; otherwise their first frame is shown, still. Without a
 * banner, a plain band in the rail colour keeps the layout.
 */
export function Banner({ src }: { src: string | null }) {
  const play = usePlayAnimations();
  const [still, setStill] = useState<{ of: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!src || play || still?.of === src) return;
    let alive = true;
    // If the first frame cannot be decoded, nothing is drawn rather than letting it move.
    firstFrame(src).then(
      (url) => alive && setStill({ of: src, url }),
      () => alive && setStill({ of: src, url: null }),
    );
    return () => {
      alive = false;
    };
  }, [src, play, still]);

  if (!src) return <div className="banner banner-empty" aria-hidden="true" />;
  const shown = play ? src : still?.of === src ? still.url : null;
  return <div className="banner" aria-hidden="true">{shown && <img src={shown} alt="" />}</div>;
}
