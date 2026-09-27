"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, inputClass } from "./ui";

// Customer signs with a finger; saved as a PNG with the typed name.
export function SignaturePad({ jobId, onSaved }: { jobId: string; onSaved: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ratio = useRef(1);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [inked, setInked] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Size the canvas to its box at device pixel ratio so strokes stay sharp.
  useEffect(() => {
    const canvas = canvasRef.current!;
    ratio.current = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio.current);
    canvas.height = Math.round(rect.height * ratio.current);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio.current, ratio.current);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  // Finger position in drawing units. The canvas keeps the size it had at setup; if the
  // phone rotates, CSS stretches it, so scale by the box's current size.
  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / ratio.current / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / ratio.current / rect.height,
    };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = e.currentTarget.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = "#0f172a";
    ctx.fill();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const p = point(e);
    const ctx = e.currentTarget.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!inked) setInked(true);
  }

  function up() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setInked(false);
  }

  async function save() {
    if (!name.trim()) return setError("Enter the customer's name.");
    if (!inked) return setError("Ask the customer to sign in the box.");
    setSaving(true);
    setError(null);
    try {
      const canvas = canvasRef.current!;
      // White background so the PNG reads well anywhere.
      const out = document.createElement("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, 0, 0);
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      if (!blob) throw new Error("Couldn't save the signature.");
      const form = new FormData();
      form.set("name", name.trim());
      form.set("signature", blob, "signature.png");
      const res = await fetch(`/api/jobs/${jobId}/signature`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Saving failed.");
      onSaved();
    } catch (e) {
      setError(e instanceof TypeError ? "No internet connection. Try again when you have signal." : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Customer's name"
        aria-label="Customer's name"
        maxLength={120}
        className={inputClass}
      />
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Signature box"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-slate-300 bg-white"
        />
        {!inked && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Customer signs here
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={clear} className={buttonClass("secondary")}>
          Clear
        </button>
        <button type="button" onClick={save} disabled={saving} className={buttonClass("primary", "md", "flex-1")}>
          {saving ? "Saving…" : "Save signature"}
        </button>
      </div>
    </div>
  );
}
