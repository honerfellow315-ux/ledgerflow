BEGIN;
-- Staging is private temporary import data. Completed payloads are deleted immediately.
CREATE TABLE IF NOT EXISTS import_jobs (
 id text PRIMARY KEY, actor_id text NOT NULL, kind text NOT NULL,
 scope text NOT NULL, total_chunks integer NOT NULL CHECK(total_chunks BETWEEN 1 AND 100),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_chunks (
 job_id text NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
 chunk_index integer NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(job_id,chunk_index)
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_scope text;
UPDATE invoices i SET billing_scope=coalesce('company:'||c.company_id,'client:'||c.id)
FROM clients c WHERE c.id=i.client_id AND i.billing_scope IS NULL;
-- Fail rather than silently renumber existing duplicate invoices.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_scope_number_uq
ON invoices (billing_scope, lower(btrim(number)));
CREATE OR REPLACE FUNCTION set_invoice_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT coalesce('company:'||company_id,'client:'||id) INTO NEW.billing_scope
 FROM clients WHERE id=NEW.client_id;
 NEW.number := btrim(NEW.number);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoices_set_scope ON invoices;
CREATE TRIGGER invoices_set_scope BEFORE INSERT OR UPDATE OF client_id, number ON invoices
FOR EACH ROW EXECUTE FUNCTION set_invoice_scope();
CREATE OR REPLACE FUNCTION update_client_invoice_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE invoices SET billing_scope=coalesce('company:'||NEW.company_id,'client:'||NEW.id) WHERE client_id=NEW.id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clients_invoice_scope ON clients;
CREATE TRIGGER clients_invoice_scope AFTER UPDATE OF company_id ON clients
FOR EACH ROW EXECUTE FUNCTION update_client_invoice_scope();
COMMIT;
