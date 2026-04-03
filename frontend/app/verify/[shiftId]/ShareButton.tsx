"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

export function ShareButton() {
  const [copied, setCopied] = useState(false);

  const handleClick = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-2 px-4 py-2 border border-rim text-muted font-mono text-xs tracking-widest transition-all hover:border-muted hover:text-ink"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-teal" /> : <Share2 className="w-3.5 h-3.5" />}
      {copied ? "COPIED!" : "SHARE THIS PROOF"}
    </button>
  );
}
