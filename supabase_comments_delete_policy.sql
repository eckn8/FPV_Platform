-- =======================================================
-- 🩹 supabase_comments_delete_policy.sql — Petit correctif
-- À exécuter (SQL Editor → New query → coller → Run).
--
-- La table `comments` n'avait pas de policy DELETE — RLS refuse
-- tout par défaut sans règle explicite, donc personne ne pouvait
-- supprimer un commentaire, même le sien. Ajoute la permission
-- réservée à l'auteur du commentaire.
-- =======================================================

create policy "Users can delete their own comments"
  on public.comments for delete
  to authenticated
  using (auth.uid() = user_id);
