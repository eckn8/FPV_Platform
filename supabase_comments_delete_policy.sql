-- =======================================================
-- 🩹 supabase_comments_delete_policy.sql — Small fix
-- Run it (SQL Editor → New query → paste → Run).
--
-- The `comments` table had no DELETE policy — RLS denies
-- everything by default without an explicit rule, so no one could
-- delete a comment, not even their own. Adds the permission,
-- restricted to the comment's author.
-- =======================================================

create policy "Users can delete their own comments"
  on public.comments for delete
  to authenticated
  using (auth.uid() = user_id);
