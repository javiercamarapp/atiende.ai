'use client';
import { useState, useEffect, useRef } from 'react';

interface TypewriterMessageProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
  className?: string;
}

export function TypewriterMessage({ text, speed = 20, onComplete, className = '' }: TypewriterMessageProps) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed('');
    setDone(false);

    const interval = setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(interval);
        onComplete?.();
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, onComplete]);

  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {displayed}
      {!done && <span className="inline-block w-[2px] h-[1.1em] bg-zinc-900 ml-0.5 animate-pulse align-text-bottom" />}
    </div>
  );
}
