"use client";
import { Modal } from "./dialog";

/**
 * SPLIT — one purchase, several buckets.
 *
 * A $120 shop that is half groceries and half household lands entirely in one
 * bucket without this, so one reads over and the other reads untouched. Two
 * wrong numbers from one purchase, on the screen whose whole promise is that
 * the numbers are true.
 *
 * Three ways in, one editor:
 *   photograph it · upload it · type it
 *
 * The camera and the upload only pre-fill the same rows the user could type
 * themselves, and nothing is applied until the lines reconcile to what the bank
 * actually charged. The image is sent, read, and discarded — never stored.
 */

import { Camera, Check, Plus, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { splitDifference, splitIsBalanced, splitTransaction, type SplitLine } from "../../lib/model/decide";
import { formatDate, formatMoney } from "../../lib/model/engine";
import type { Transaction, Workspace } from "../../lib/model/types";
import "./split.css";

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("unreadable"));
    reader.readAsDataURL(file);
  });

export function SplitSheet({
  workspace,
  transaction,
  onClose,
  update,
}: {
  workspace: Workspace;
  transaction: Transaction;
  onClose: () => void;
  update: (next: (current: Workspace) => Workspace) => void;
}) {
  const categories = Array.from(
    new Set(
      workspace.buckets
        .filter((bucket) => bucket.kind === "spend")
        .map((bucket) => bucket.category ?? bucket.name),
    ),
  ).sort();

  const [lines, setLines] = useState<SplitLine[]>(
    transaction.split?.length
      ? transaction.split
      : [{ category: transaction.category, amount: transaction.amount }],
  );
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const difference = splitDifference(transaction.amount, lines);
  const positiveLines = lines.filter((line) => line.amount > 0);
  const balanced = positiveLines.length > 1 && splitIsBalanced(transaction.amount, positiveLines);

  const setLine = (index: number, patch: Partial<SplitLine>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const scan = async (file: File) => {
    setReading(true);
    setNote("");
    try {
      const image = await readAsDataUrl(file);
      const response = await fetch("/api/receipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image, total: transaction.amount, categories }),
      });
      const payload = await response.json();
      if (!payload?.read) {
        setNote(payload?.reason ?? "Couldn't read that one. You can still split it by hand.");
        return;
      }

      // Collapse the receipt's items into one row per category — the buckets
      // are what matter, not every line on the paper.
      const byCategory = new Map<string, number>();
      for (const line of payload.lines as { amount: number; category: string }[]) {
        byCategory.set(line.category, Math.round(((byCategory.get(line.category) ?? 0) + line.amount) * 100) / 100);
      }
      const extracted = [...byCategory].map(([category, amount]) => ({ category, amount }));
      setLines(extracted);

      const gap = splitDifference(transaction.amount, extracted);
      setNote(
        Math.abs(gap) < 0.01
          ? "Read the receipt — check it over before saving."
          : `Read the receipt, but it comes to ${formatMoney(Math.abs(gap))} ${gap > 0 ? "less" : "more"} than the ${formatMoney(transaction.amount)} charge. Adjust before saving.`,
      );
    } catch {
      setNote("Couldn't read that one. You can still split it by hand.");
    } finally {
      setReading(false);
    }
  };

  const save = () => {
    const clean = lines.filter((line) => line.amount > 0);
    if (!splitIsBalanced(transaction.amount, clean)) return;
    update((current) => splitTransaction(current, transaction.id, clean));
    onClose();
  };

  return (
    <Modal className="sp-backdrop" label={`Split ${transaction.merchant}`} onClose={onClose}>
      <div
        className="sp-sheet"


        aria-label={`Split ${transaction.merchant}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{transaction.merchant}</strong>
            <small>
              {formatMoney(transaction.amount)} · {formatDate(transaction.date)}
            </small>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="sp-sources">
          <button onClick={() => cameraRef.current?.click()} disabled={reading}>
            <Camera size={16} /> Photograph it
          </button>
          <button onClick={() => uploadRef.current?.click()} disabled={reading}>
            <Upload size={16} /> Upload
          </button>
          {/* capture opens the camera directly on a phone; the same input takes
              a file on desktop. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void scan(file);
              event.target.value = "";
            }}
          />
          <input
            ref={uploadRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void scan(file);
              event.target.value = "";
            }}
          />
        </div>

        {reading && <p className="sp-note">Reading the receipt…</p>}
        {note && !reading && <p className="sp-note">{note}</p>}

        <div className="sp-lines">
          {lines.map((line, index) => (
            <div className="sp-line" key={index}>
              <select
                value={line.category}
                onChange={(event) => setLine(index, { category: event.target.value })}
                aria-label={`Category for line ${index + 1}`}
              >
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
              <label>
                <span>$</span>
                <input
                  type="number"
                  step="0.01"
                  value={line.amount || ""}
                  onChange={(event) => setLine(index, { amount: Number(event.target.value) })}
                  aria-label={`Amount for line ${index + 1}`}
                />
              </label>
              <button
                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                aria-label={`Remove line ${index + 1}`}
                disabled={lines.length <= 1}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            className="sp-add"
            onClick={() =>
              setLines((current) => [...current, { category: categories[0] ?? "Uncategorized", amount: 0 }])
            }
          >
            <Plus size={15} /> Add a line
          </button>
        </div>

        {/* The bank's charge is the truth. Nothing saves until it reconciles. */}
        <div className={balanced ? "sp-check ok" : "sp-check"}>
          {balanced ? (
            <>
              <Check size={15} /> Adds up to {formatMoney(transaction.amount)}
            </>
          ) : (
            <>
              {difference === 0 ? "Add a second category to create a split" : difference > 0
                ? `${formatMoney(difference)} still to assign`
                : `${formatMoney(-difference)} over the ${formatMoney(transaction.amount)} charge`}
            </>
          )}
        </div>

        <button className="sp-save" onClick={save} disabled={!balanced}>
          Save split
        </button>
      </div>
    </Modal>
  );
}
