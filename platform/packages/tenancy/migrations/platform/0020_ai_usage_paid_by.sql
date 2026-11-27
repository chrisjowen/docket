-- Which key paid for each AI call (tenancy v2 §5): Docket's, capped per
-- account ('account'), or a space's own provider key ('space'). Only calls on
-- Docket's key count toward the account's monthly cap and its owner warning;
-- every call made for a docket counts toward its space's slice. Every call
-- recorded before this was on Docket's key.
ALTER TABLE platform.ai_usage
  ADD COLUMN paid_by text NOT NULL DEFAULT 'account' CHECK (paid_by IN ('account', 'space'));
