"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, FormError, inputClass } from "@/components/ui/Field";
import { deleteCompany, renameCompany } from "@/lib/api/platform";

type CompanyRef = { id: string; name: string } | null;

/** Rename a company (Platform → Users / company page → Edit). */
export function EditCompanyModal({
  company,
  onClose,
  onSaved,
}: {
  company: CompanyRef;
  onClose: () => void;
  onSaved: (id: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(company?.name ?? "");
    setErr(null);
  }, [company]);

  const trimmed = name.trim();
  return (
    <Modal
      open={!!company}
      onClose={onClose}
      title="Edit company"
      description="Change the company name. Users, roles and workspaces stay as they are."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="edit-company-form" variant="primary" disabled={busy || !trimmed || trimmed === company?.name}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        id="edit-company-form"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!company) return;
          setBusy(true);
          setErr(null);
          try {
            const res = await renameCompany(company.id, trimmed);
            onSaved(company.id, res.name);
          } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : "Could not save");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Company name">
          <input id="edit-company-name" required maxLength={200} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <FormError message={err} />
      </form>
    </Modal>
  );
}

/** Confirm and delete a company. Its workspaces are deleted and all its people lose access. */
export function DeleteCompanyModal({
  company,
  onClose,
  onDeleted,
}: {
  company: CompanyRef;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTyped("");
    setErr(null);
  }, [company]);

  const matches = !!company && typed.trim() === company.name;
  return (
    <Modal
      open={!!company}
      onClose={onClose}
      title={`Delete ${company?.name ?? "company"}?`}
      description="All its workspaces are deleted and every user in it loses access straight away. Its records are kept for the audit trail."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="delete-company-form" variant="primary" disabled={busy || !matches}>
            {busy ? "Deleting…" : "Delete company"}
          </Button>
        </>
      }
    >
      <form
        id="delete-company-form"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!company || !matches) return;
          setBusy(true);
          setErr(null);
          try {
            await deleteCompany(company.id);
            onDeleted(company.id);
          } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : "Could not delete the company");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={`Type ${company?.name ?? ""} to confirm`}>
          <input
            id="delete-company-confirm"
            autoComplete="off"
            className={inputClass}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={company?.name}
          />
        </Field>
        <FormError message={err} />
      </form>
    </Modal>
  );
}
