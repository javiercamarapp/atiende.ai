'use client';

import { useState } from 'react';
import { BotPreviewFAB, BotPreview } from '@/components/dashboard/bot-preview-drawer';

// Client-side pair of FAB + Drawer with shared open state, so a server
// component page can mount a single element and get both the floating
// trigger and the sheet.
export function BotPreviewLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <BotPreviewFAB onClick={() => setOpen(true)} />
      <BotPreview open={open} onOpenChange={setOpen} />
    </>
  );
}
