"use client";

import { useEffect, useState } from "react";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, FormError, FormNotice, inputClass } from "@/components/ui/Field";
import { getOffer, saveOfferProducts, type OfferItem } from "@/lib/api/settings";

const EMPTY_ITEM: OfferItem = { name: "", description: "", proofPoints: "", bestFor: "" };
const MAX_ITEMS = 15;

/**
 * Settings → Offer: our own company and the products/services we sell. Stakeholder briefs rank
 * these per decision maker (lead with / support with / hold in reserve), so names should be short
 * and descriptions should say what the buyer gets.
 */
export function OfferProductsCard({ workspaceId }: { workspaceId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [company, setCompany] = useState("");
  const [items, setItems] = useState<OfferItem[]>([]);
  const [saved, setSaved] = useState<{ company: string; items: OfferItem[] }>({ company: "", items: [] });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getOffer(workspaceId)
      .then(({ offer }) => {
        const c = offer?.sellerCompany ?? "";
        const it = offer?.offerItems ?? [];
        setCompany(c);
        setItems(it);
        setSaved({ company: c, items: it });
        setEditing(!it.length);
        setLoaded(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load products"));
  }, [workspaceId]);

  const update = (i: number, k: keyof OfferItem, v: string) =>
    setItems((list) => list.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  async function save() {
    setError(null);
    setNotice(null);
    const clean = items
      .map((i) => ({
        name: i.name.trim(),
        description: i.description.trim(),
        proofPoints: i.proofPoints?.trim() || undefined,
        bestFor: i.bestFor?.trim() || undefined,
      }))
      .filter((i) => i.name || i.description);
    const incomplete = clean.findIndex((i) => !i.name || !i.description);
    if (incomplete >= 0) {
      setError(`Product ${incomplete + 1} needs both a name and a description`);
      return;
    }
    setBusy(true);
    try {
      const res = await saveOfferProducts(workspaceId, { sellerCompany: company.trim() || null, offerItems: clean });
      setCompany(res.sellerCompany ?? "");
      setItems(res.offerItems);
      setSaved({ company: res.sellerCompany ?? "", items: res.offerItems });
      setEditing(false);
      setNotice("Products saved. New stakeholder briefs will use them.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save products");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand)]">
            <Package size={20} strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">Your company &amp; products</h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              Stakeholder briefs rank these for each decision maker: what to lead with, what to support with and what to
              hold back.
            </p>
          </div>
        </div>
        {loaded && !editing ? (
          <Button
            aria-label="Edit products"
            onClick={() => {
              setNotice(null);
              setEditing(true);
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Pencil size={15} aria-hidden /> Edit
            </span>
          </Button>
        ) : null}
      </div>

      {!loaded ? (
        error ? <div className="mt-4"><FormError message={error} /></div> : <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p>
      ) : !editing ? (
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <p className="text-sm">
            <span className="text-[var(--muted)]">Company: </span>
            <span className="font-semibold">{saved.company || "Not set"}</span>
          </p>
          {saved.items.length ? (
            <ul className="mt-3 grid gap-3 md:grid-cols-2">
              {saved.items.map((it) => (
                <li key={it.name} className="rounded-[10px] border border-[var(--line)] p-3.5 text-sm">
                  <p className="font-semibold">{it.name}</p>
                  <p className="mt-1 text-[var(--muted)]">{it.description}</p>
                  {it.bestFor ? <p className="mt-1.5 text-xs"><span className="font-semibold">Best for:</span> {it.bestFor}</p> : null}
                  {it.proofPoints ? <p className="mt-1 text-xs"><span className="font-semibold">Proof:</span> {it.proofPoints}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">No products yet.</p>
          )}
          <div className="mt-3">
            <FormNotice message={notice} />
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4 border-t border-[var(--line)] pt-5">
          <Field label="Your company name">
            <input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Coterie" maxLength={120} />
          </Field>
          {items.map((it, i) => (
            <div key={i} className="rounded-[10px] border border-[var(--line)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Product {i + 1}</p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--brand)]"
                  onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} aria-hidden /> Remove
                </button>
              </div>
              <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                <Field label="Name *">
                  <input
                    className={inputClass}
                    value={it.name}
                    maxLength={80}
                    onChange={(e) => update(i, "name", e.target.value)}
                    placeholder="e.g. Buyer-specific meeting preparation"
                  />
                </Field>
                <Field label="Best for" hint="Which situation or buyer it fits">
                  <input
                    className={inputClass}
                    value={it.bestFor ?? ""}
                    maxLength={300}
                    onChange={(e) => update(i, "bestFor", e.target.value)}
                    placeholder="e.g. Partner sellers moving into infrastructure deals"
                  />
                </Field>
                <Field label="What it is *" className="md:col-span-2">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={it.description}
                    maxLength={500}
                    onChange={(e) => update(i, "description", e.target.value)}
                    placeholder="e.g. Overnight meeting packs: account context, stakeholder priorities, objections and a role-play scenario"
                  />
                </Field>
                <Field label="Proof points" hint="Results, clients or numbers" className="md:col-span-2">
                  <input
                    className={inputClass}
                    value={it.proofPoints ?? ""}
                    maxLength={300}
                    onChange={(e) => update(i, "proofPoints", e.target.value)}
                    placeholder="e.g. 24-hour turnaround; used by 3 channel partners"
                  />
                </Field>
              </div>
            </div>
          ))}
          {items.length < MAX_ITEMS ? (
            <Button onClick={() => setItems((list) => [...list, { ...EMPTY_ITEM }])}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={15} aria-hidden /> Add product or service
              </span>
            </Button>
          ) : null}
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save products"}
            </Button>
            {saved.items.length || saved.company ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setCompany(saved.company);
                  setItems(saved.items);
                  setError(null);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}
