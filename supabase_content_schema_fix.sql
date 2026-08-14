-- =======================================================
-- 🩹 supabase_content_schema_fix.sql — Petit correctif
-- À exécuter juste après supabase_content_schema.sql (SQL Editor
-- → New query → coller → Run).
--
-- Ajoute le pseudo dénormalisé sur `requests` (oublié dans le
-- script initial — models et comments l'ont déjà) pour afficher
-- "Demandé par : X" sans jointure, et relie proprement
-- resolved_by_model_id à models maintenant que la table existe.
-- =======================================================

alter table public.requests
  add column creator_username text not null default '';

alter table public.requests
  add constraint requests_resolved_by_model_id_fkey
  foreign key (resolved_by_model_id) references public.models(id);
