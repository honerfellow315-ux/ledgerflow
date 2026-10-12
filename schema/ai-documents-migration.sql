-- Request counts only. No document images or extracted financial data are stored here.
BEGIN;
CREATE TABLE IF NOT EXISTS ai_document_usage (
  day date NOT NULL,
  actor text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  PRIMARY KEY(day,actor)
);
CREATE OR REPLACE FUNCTION reserve_ai_document_request(actor_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ai-document-quota:' || today::text));
  IF (SELECT coalesce(sum(requests),0) FROM ai_document_usage WHERE day=today) >= 100 THEN
    RAISE EXCEPTION 'Daily AI document limit reached. Try again tomorrow.';
  END IF;
  IF (SELECT requests FROM ai_document_usage WHERE day=today AND actor=actor_id) >= 20 THEN
    RAISE EXCEPTION 'Your daily AI document limit is reached. Try again tomorrow.';
  END IF;
  INSERT INTO ai_document_usage(day,actor,requests) VALUES(today,actor_id,1)
  ON CONFLICT(day,actor) DO UPDATE SET requests=ai_document_usage.requests+1;
END $$;
COMMIT;
