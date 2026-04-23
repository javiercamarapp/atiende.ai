'use client';
import { useState, useEffect } from 'react';

interface TypewriterMessageProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
  className?: string;
}

/**
 * Outer component uses `key={text}` to remount the inner component
 * whenever the text prop changes, cleanly resetting animation state
 * without calling setState in effects or accessing refs during render.
 */
export function TypewriterMessage(props: TypewriterMessageProps) {
  return <TypewriterInner key={props.text} {...props} />;
}

function TypewriterInner({ text, speed = 20, onComplete, className = '' }: TypewriterMessageProps) {
  const [charIndex, setCharIndex] = useState(0);

  const done = charIndex >= text.length;

  useEffect(() => {
    if (done) {
      onComplete?.();
      return;
    }

    const timer = setTimeout(() => {
      setCharIndex(prev => prev + 1);
    }, speed);

    return () => clearTimeout(timer);
  }, [charIndex, text.length, speed, done, onComplete]);

  const displayed = text.slice(0, charIndex);

  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {displayed}
      {!done && <span className="inline-block w-[2px] h-[1.1em] bg-zinc-900 ml-0.5 animate-pulse align-text-bottom" />}
    </div>
  );
}
